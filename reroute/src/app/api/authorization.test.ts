import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Decision, EditPlan, PublishIntent } from "@/lib/contracts";
import { toErrorResponse } from "@/lib/errors";
import {
  SESSION_COOKIE,
  SIGN_IN_FAILURE_DELAY_MS,
  SIGN_IN_MAX_FAILURES,
  SIGN_IN_WINDOW_MS,
  resetSignInThrottleForTests,
  signIn,
} from "@/lib/server/auth";
import { resetRepositoriesForTests, useMemoryRepositoriesForTests } from "@/lib/server/repositories/testing";
import type { Repositories } from "@/lib/server/repositories/types";
import { createReceipt } from "@/lib/server/store";
import { proxy } from "@/proxy";
import { POST as postObservation } from "./observations/route";
import { POST as postReview } from "./receipts/[id]/review/route";
import { DELETE as signOut, POST as signInRoute } from "./auth/session/route";

/** Authorization of mutating routes, fully mocked: in-memory repositories, no network, no Supabase. */

const ORIGIN = "http://localhost:3000";
let repos: Repositories;

function request(path: string, init: { method?: string; body?: unknown; origin?: string | null; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", "content-type": "application/json" };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.cookie) headers.cookie = `${SESSION_COOKIE}=${init.cookie}`;
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const reviewerCookie = (name = "Ed") => signIn("spurs-demo-review", name).cookie.value;
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

const intent: PublishIntent = { territory: "GB", platform: "instagram", usage: "ORGANIC", competition: "Premier League", publishAt: "2026-10-25T12:00:00.000Z" };
const edit: EditPlan = { id: "edit-1", title: "Spurs", segments: [{ scoreplayMediaId: "101", start: 0, end: 5 }], derived: false };
const decision = (verdict: Decision["verdict"]): Decision => ({
  verdict,
  reasons: [],
  missingFacts: [],
  evidence: [],
  policyVersion: "1",
  policyId: "demo",
  policyFictional: true,
  clearance: verdict === "ALLOWED" ? "DEMO" : "NONE",
  evaluatedAt: "2026-10-22T20:00:00.000Z",
});

beforeEach(() => {
  vi.stubEnv("REROUTE_REVIEWER_PASSCODE", "spurs-demo-review");
  vi.stubEnv("REROUTE_SESSION_SECRET", "k".repeat(48));
  repos = useMemoryRepositoriesForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetRepositoriesForTests();
  vi.useRealTimers();
  resetSignInThrottleForTests();
});

describe("proxy", () => {
  it("blocks cross-origin and origin-less mutations, lets same-origin and reads through", async () => {
    expect((await proxy(request("/api/decide", { origin: "https://evil.example" }))).status).toBe(403);
    expect((await proxy(request("/api/decide", { origin: null }))).status).toBe(403);
    expect(passed(await proxy(request("/api/decide")))).toBe(true);
    expect(passed(await proxy(request("/api/receipts/r1", { method: "GET", origin: "https://evil.example" })))).toBe(true);
  });

  it.each(["/api/receipts/r1/review", "/api/observations", "/api/writeback", "/api/render"])(
    "requires a reviewer session for POST %s",
    async (path) => {
      const denied = await proxy(request(path));
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ code: "FORBIDDEN" });
      expect((await proxy(request(path, { cookie: "forged.token" }))).status).toBe(403);
      expect(passed(await proxy(request(path, { cookie: reviewerCookie() })))).toBe(true);
    },
  );

  it("does not require a reviewer for ordinary mutations or sign-in", async () => {
    expect(passed(await proxy(request("/api/receipts")))).toBe(true);
    expect(passed(await proxy(request("/api/auth/session")))).toBe(true);
  });

  it("reviewer-only routes are unavailable (503), not open, when auth env is missing", async () => {
    vi.stubEnv("REROUTE_SESSION_SECRET", "");
    const res = await proxy(request("/api/writeback"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("POST /api/receipts/[id]/review", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("rejects an anonymous review even when the body names a reviewer", async () => {
    const receipt = await createReceipt({ edit, intent, decision: decision("NEEDS_REVIEW") });
    const res = await postReview(request(`/api/receipts/${receipt.id}/review`, { body: { status: "APPROVED", reviewer: "Ed" } }), ctx(receipt.id));
    expect(res.status).toBe(403);
    expect((await repos.receipts.load(receipt.id)).receipt.humanReviewStatus).toBe("PENDING");
  });

  it("records the session reviewer, ignoring any reviewer in the body, and audits it", async () => {
    const receipt = await createReceipt({ edit, intent, decision: decision("NEEDS_REVIEW") });
    const res = await postReview(
      request(`/api/receipts/${receipt.id}/review`, { body: { status: "APPROVED", reviewer: "Mallory" }, cookie: reviewerCookie("Ed") }),
      ctx(receipt.id),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ humanReviewStatus: "APPROVED", reviews: [{ status: "APPROVED", reviewer: "Ed" }] });
    const audit = await repos.events.list("receipt", receipt.id);
    expect(audit.map((e) => [e.type, e.actor])).toEqual([
      ["RECEIPT_CREATED", "system"],
      ["REVIEW_RECORDED", "Ed"],
    ]);
    expect(audit[1].prevHash).toBe(audit[0].hash);
  });

  it("never approves a BLOCKED decision", async () => {
    const receipt = await createReceipt({ edit, intent, decision: decision("BLOCKED") });
    const res = await postReview(request(`/api/receipts/${receipt.id}/review`, { body: { status: "APPROVED" }, cookie: reviewerCookie() }), ctx(receipt.id));
    expect(res.status).toBe(403);
    expect(await repos.receipts.listReviews(receipt.id)).toEqual([]);
  });

  it("reviews are final: a second review is a CONFLICT (409)", async () => {
    const receipt = await createReceipt({ edit, intent, decision: decision("NEEDS_REVIEW") });
    const review = (status: string, name: string) =>
      postReview(request(`/api/receipts/${receipt.id}/review`, { body: { status }, cookie: reviewerCookie(name) }), ctx(receipt.id));
    expect((await review("REJECTED", "Jo")).status).toBe(200);
    const again = await review("APPROVED", "Ed");
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "CONFLICT" });
    expect((await repos.receipts.listReviews(receipt.id)).map((r) => r.reviewer)).toEqual(["Jo"]);
  });
});

describe("error bodies", () => {
  it("never echo unexpected error text to the client", async () => {
    const res = toErrorResponse(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error", code: "INTERNAL" });
  });
});

describe("POST /api/observations", () => {
  const body = { scoreplayMediaId: "101", start: 1, end: 3, observation: "Sponsor board visible", source: "TWELVELABS", origin: "LIVE" };

  it("requires a reviewer and records them as the audit actor", async () => {
    expect((await postObservation(request("/api/observations", { body }))).status).toBe(403);
    const res = await postObservation(request("/api/observations", { body, cookie: reviewerCookie("Ed") }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ evidence: { source: "HUMAN", origin: "HUMAN" } });
    expect((await repos.events.list("media", "101")).map((e) => e.actor)).toEqual(["Ed"]);
  });
});

describe("/api/auth/session", () => {
  /** Wrong passcodes are answered after a fixed delay; fake timers skip it deterministically. */
  async function wrongAttempt(ip = "203.0.113.7"): Promise<Response> {
    const req = request("/api/auth/session", { body: { passcode: "guess", name: "Ed" } });
    req.headers.set("x-real-ip", ip);
    const pending = signInRoute(req);
    await vi.advanceTimersByTimeAsync(SIGN_IN_FAILURE_DELAY_MS);
    return pending;
  }

  it("answers a wrong passcode only after the fixed delay", async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = signInRoute(request("/api/auth/session", { body: { passcode: "guess", name: "Ed" } })).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(SIGN_IN_FAILURE_DELAY_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(403);
  });

  it("rate-limits an address after repeated failures (429 + Retry-After), even for the right passcode", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < SIGN_IN_MAX_FAILURES; i++) expect((await wrongAttempt()).status).toBe(403);
    const limited = await wrongAttempt();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    const right = request("/api/auth/session", { body: { passcode: "spurs-demo-review", name: "Ed" } });
    right.headers.set("x-real-ip", "203.0.113.7");
    expect((await signInRoute(right)).status).toBe(429);
    // Another address is unaffected; the window expires.
    expect((await wrongAttempt("198.51.100.1")).status).toBe(403);
    vi.advanceTimersByTime(SIGN_IN_WINDOW_MS);
    expect((await wrongAttempt()).status).toBe(403);
  });

  it("is disabled in production with a short passcode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REROUTE_REVIEWER_PASSCODE", "short-pass");
    const res = await signInRoute(request("/api/auth/session", { body: { passcode: "short-pass", name: "Ed" } }));
    expect(res.status).toBe(503);
  });

  it("signs in with the passcode (HttpOnly cookie) and refuses a wrong one", async () => {
    vi.useFakeTimers();
    const wrong = await wrongAttempt();
    expect(wrong.status).toBe(403);
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const ok = await signInRoute(request("/api/auth/session", { body: { passcode: "spurs-demo-review", name: "Ed" } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ enabled: true, reviewer: { name: "Ed" } });
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=28800/);
  });

  it("signs out by expiring the cookie", async () => {
    const res = await signOut();
    expect(await res.json()).toEqual({ enabled: true, reviewer: null });
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("is NOT_CONFIGURED when the passcode env is missing", async () => {
    vi.stubEnv("REROUTE_REVIEWER_PASSCODE", "");
    const res = await signInRoute(request("/api/auth/session", { body: { passcode: "", name: "Ed" } }));
    expect(res.status).toBe(400); // empty passcode fails validation before anything else
    const res2 = await signInRoute(request("/api/auth/session", { body: { passcode: "spurs-demo-review", name: "Ed" } }));
    expect(res2.status).toBe(503);
  });
});
