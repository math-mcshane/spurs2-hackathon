import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Decision, EditPlan, PublishIntent } from "@/lib/contracts";
import { toErrorResponse } from "@/lib/errors";
import {
  SCRYPT_SALT_BYTES,
  SESSION_COOKIE,
  SIGN_IN_FAILURE_DELAY_MS,
  SIGN_IN_MAX_FAILURES,
  SIGN_IN_WINDOW_MS,
  hashPasscode,
  resetSignInThrottleForTests,
  signIn,
  type ReviewerCredential,
} from "@/lib/server/auth";
import { resetRateLimitsForTests } from "@/lib/server/rate-limit";
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

const PASSCODES = { ed: "ed-personal-passcode-1234", jo: "jo-personal-passcode-5678" } as const;
let reviewersEnv: string;
beforeAll(async () => {
  const creds: ReviewerCredential[] = [];
  for (const [id, displayName] of [["ed", "Ed Smith"], ["jo", "Jo Lee"]] as const) {
    const salt = randomBytes(SCRYPT_SALT_BYTES);
    const scryptHash = (await hashPasscode(PASSCODES[id], salt)).toString("base64url");
    creds.push({ id, displayName, scryptHash, salt: salt.toString("base64url") });
  }
  reviewersEnv = JSON.stringify(creds);
});

function request(
  path: string,
  init: { method?: string; body?: unknown; origin?: string | null; cookie?: string; ip?: string } = {},
) {
  const headers: Record<string, string> = { host: "localhost:3000", "content-type": "application/json" };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.cookie) headers.cookie = `${SESSION_COOKIE}=${init.cookie}`;
  if (init.ip) headers["x-real-ip"] = init.ip;
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const reviewerCookie = async (id: keyof typeof PASSCODES = "ed") => (await signIn(id, PASSCODES[id])).cookie.value;
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
  vi.stubEnv("REROUTE_REVIEWERS", reviewersEnv);
  vi.stubEnv("REROUTE_SESSION_SECRET", "k".repeat(48));
  repos = useMemoryRepositoriesForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetRepositoriesForTests();
  vi.useRealTimers();
  resetSignInThrottleForTests();
  resetRateLimitsForTests();
});

describe("proxy", () => {
  it("blocks cross-origin and origin-less mutations, lets same-origin and reads through", async () => {
    expect((await proxy(request("/api/decide", { origin: "https://evil.example" }))).status).toBe(403);
    expect((await proxy(request("/api/decide", { origin: null }))).status).toBe(403);
    expect(passed(await proxy(request("/api/decide")))).toBe(true);
    expect(passed(await proxy(request("/api/receipts/r1", { method: "GET", origin: "https://evil.example" })))).toBe(true);
  });

  it.each([
    ["POST", "/api/receipts"],
    ["POST", "/api/receipts/r1/review"],
    ["POST", "/api/decide"],
    ["POST", "/api/resolve"],
    ["POST", "/api/access"],
    ["POST", "/api/observations"],
    ["POST", "/api/writeback"],
    ["POST", "/api/render"],
    ["POST", "/api/auth/session"],
    ["DELETE", "/api/auth/session"],
    ["POST", "/api/pulse/goal"],
    ["POST", "/api/pulse/opportunities"],
    ["POST", "/api/pulse/refresh"],
    ["POST", "/api/pulse/handoff"],
  ])("every mutating route requires same-origin: %s %s", async (method, path) => {
    const res = await proxy(request(path, { method, origin: "https://evil.example", body: { action: "run" } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it.each(["/api/receipts/r1/review", "/api/observations", "/api/writeback", "/api/render"])(
    "requires a reviewer session for POST %s",
    async (path) => {
      const denied = await proxy(request(path));
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ code: "FORBIDDEN" });
      expect((await proxy(request(path, { cookie: "forged.token" }))).status).toBe(403);
      expect(passed(await proxy(request(path, { cookie: await reviewerCookie() })))).toBe(true);
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

describe("proxy rate limits (per IP, fixed window)", () => {
  async function hit(times: number, make: () => NextRequest): Promise<Response[]> {
    const out: Response[] = [];
    for (let i = 0; i < times; i++) out.push(await proxy(make()));
    return out;
  }

  it("goal runs: 10/min → 429 RATE_LIMITED + Retry-After, other IPs and other actions unaffected, resets after the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T20:00:00.000Z"));
    const run = (ip = "203.0.113.7") => request("/api/pulse/goal", { body: { action: "run", goal: "Sell jerseys" }, ip });
    expect((await hit(10, run)).every(passed)).toBe(true);
    const limited = await proxy(run());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(limited.headers.get("retry-after"))).toBeLessThanOrEqual(60);

    expect(passed(await proxy(run("198.51.100.1")))).toBe(true);
    expect(passed(await proxy(request("/api/pulse/goal", { body: { action: "select", id: "g", key: "k", expectedVersion: 1 }, ip: "203.0.113.7" })))).toBe(true);

    vi.advanceTimersByTime(60_000);
    expect(passed(await proxy(run()))).toBe(true);
  });

  it("other goal actions: 60/min", async () => {
    const select = () => request("/api/pulse/goal", { body: { action: "select" }, ip: "203.0.113.8" });
    expect((await hit(60, select)).every(passed)).toBe(true);
    expect((await proxy(select())).status).toBe(429);
  });

  it.each(["/api/resolve", "/api/decide", "/api/access"])("%s: 20/min", async (path) => {
    const make = () => request(path, { body: {}, ip: "203.0.113.9" });
    expect((await hit(20, make)).every(passed)).toBe(true);
    expect((await proxy(make())).status).toBe(429);
  });

  it("GET /api/assets/[id] (triggers analysis): 30/min; the search list is not limited", async () => {
    const asset = () => request("/api/assets/101", { method: "GET", ip: "203.0.113.10" });
    expect((await hit(30, asset)).every(passed)).toBe(true);
    expect((await proxy(asset())).status).toBe(429);
    expect(passed(await proxy(request("/api/assets?q=spurs", { method: "GET", ip: "203.0.113.10" })))).toBe(true);
  });

  it("POST /api/auth/session: 5/min", async () => {
    const attempt = () => request("/api/auth/session", { body: { reviewer: "ed", passcode: "x" }, ip: "203.0.113.11" });
    expect((await hit(5, attempt)).every(passed)).toBe(true);
    expect((await proxy(attempt())).status).toBe(429);
  });

  it("cross-origin requests are refused before they count against the limit", async () => {
    const evil = () => request("/api/decide", { body: {}, ip: "203.0.113.12", origin: "https://evil.example" });
    expect((await hit(25, evil)).every((r) => r.status === 403)).toBe(true);
    expect(passed(await proxy(request("/api/decide", { body: {}, ip: "203.0.113.12" })))).toBe(true);
  });
});

describe("POST /api/receipts/[id]/review", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("rejects an anonymous review even when the body names a reviewer", async () => {
    const receipt = await createReceipt({ edit, intent, decision: decision("NEEDS_REVIEW") });
    const res = await postReview(request(`/api/receipts/${receipt.id}/review`, { body: { status: "APPROVED", reviewer: "Ed Smith" } }), ctx(receipt.id));
    expect(res.status).toBe(403);
    expect((await repos.receipts.load(receipt.id)).receipt.humanReviewStatus).toBe("PENDING");
  });

  it("records the configured session reviewer, ignoring any reviewer in the body, and audits it", async () => {
    const receipt = await createReceipt({ edit, intent, decision: decision("NEEDS_REVIEW") });
    const res = await postReview(
      request(`/api/receipts/${receipt.id}/review`, { body: { status: "APPROVED", reviewer: "Mallory" }, cookie: await reviewerCookie("ed") }),
      ctx(receipt.id),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ humanReviewStatus: "APPROVED", reviews: [{ status: "APPROVED", reviewer: "Ed Smith" }] });
    const audit = await repos.events.list("receipt", receipt.id);
    expect(audit.map((e) => [e.type, e.actor])).toEqual([
      ["RECEIPT_CREATED", "system"],
      ["REVIEW_RECORDED", "Ed Smith"],
    ]);
    expect(audit[1].prevHash).toBe(audit[0].hash);
  });

  it("never approves a BLOCKED decision", async () => {
    const receipt = await createReceipt({ edit, intent, decision: decision("BLOCKED") });
    const res = await postReview(request(`/api/receipts/${receipt.id}/review`, { body: { status: "APPROVED" }, cookie: await reviewerCookie() }), ctx(receipt.id));
    expect(res.status).toBe(403);
    expect(await repos.receipts.listReviews(receipt.id)).toEqual([]);
  });

  it("reviews are final: a second review is a CONFLICT (409)", async () => {
    const receipt = await createReceipt({ edit, intent, decision: decision("NEEDS_REVIEW") });
    const review = async (status: string, id: keyof typeof PASSCODES) =>
      postReview(request(`/api/receipts/${receipt.id}/review`, { body: { status }, cookie: await reviewerCookie(id) }), ctx(receipt.id));
    expect((await review("REJECTED", "jo")).status).toBe(200);
    const again = await review("APPROVED", "ed");
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "CONFLICT" });
    expect((await repos.receipts.listReviews(receipt.id)).map((r) => r.reviewer)).toEqual(["Jo Lee"]);
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
    const res = await postObservation(request("/api/observations", { body, cookie: await reviewerCookie("ed") }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ evidence: { source: "HUMAN", origin: "HUMAN" } });
    expect((await repos.events.list("media", "101")).map((e) => e.actor)).toEqual(["Ed Smith"]);
  });
});

describe("/api/auth/session", () => {
  /** Wrong passcodes are answered after a fixed delay; fake timers skip it deterministically. */
  async function wrongAttempt(ip = "203.0.113.7"): Promise<Response> {
    const pending = signInRoute(request("/api/auth/session", { body: { reviewer: "ed", passcode: "guess" }, ip }));
    await vi.advanceTimersByTimeAsync(SIGN_IN_FAILURE_DELAY_MS);
    return pending;
  }

  it("answers a wrong passcode only after the fixed delay", async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = signInRoute(request("/api/auth/session", { body: { reviewer: "ed", passcode: "guess" } })).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(SIGN_IN_FAILURE_DELAY_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(403);
  });

  it("locks an address out after repeated failures (429 + Retry-After), even for the right passcode", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < SIGN_IN_MAX_FAILURES; i++) expect((await wrongAttempt()).status).toBe(403);
    const limited = await wrongAttempt();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    const right = request("/api/auth/session", { body: { reviewer: "ed", passcode: PASSCODES.ed }, ip: "203.0.113.7" });
    expect((await signInRoute(right)).status).toBe(429);
    // Another address is unaffected; the window expires.
    expect((await wrongAttempt("198.51.100.1")).status).toBe(403);
    vi.advanceTimersByTime(SIGN_IN_WINDOW_MS);
    expect((await wrongAttempt()).status).toBe(403);
  });

  it("signs in with the reviewer's own passcode (HttpOnly, SameSite=Strict, 4 h) and refuses a wrong one", async () => {
    vi.useFakeTimers();
    const wrong = await wrongAttempt();
    expect(wrong.status).toBe(403);
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const ok = await signInRoute(request("/api/auth/session", { body: { reviewer: "ed", passcode: PASSCODES.ed } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ enabled: true, reviewer: { id: "ed", name: "Ed Smith" } });
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).toMatch(/Max-Age=14400/);
  });

  it("impersonation is impossible: a name in the body is ignored and another reviewer's id needs their passcode", async () => {
    const ok = await signInRoute(request("/api/auth/session", { body: { reviewer: "ed", passcode: PASSCODES.ed, name: "Jo Lee" } }));
    expect(await ok.json()).toMatchObject({ reviewer: { id: "ed", name: "Ed Smith" } });

    vi.useFakeTimers();
    const pending = signInRoute(request("/api/auth/session", { body: { reviewer: "jo", passcode: PASSCODES.ed } }));
    await vi.advanceTimersByTimeAsync(SIGN_IN_FAILURE_DELAY_MS);
    const asJo = await pending;
    expect(asJo.status).toBe(403);
    expect(asJo.headers.get("set-cookie")).toBeNull();

    // The legacy free-text body (name + shared passcode) no longer signs anyone in.
    expect((await signInRoute(request("/api/auth/session", { body: { name: "Ed Smith", passcode: PASSCODES.ed } }))).status).toBe(400);
  });

  it("signs out by expiring the cookie", async () => {
    const res = await signOut();
    expect(await res.json()).toMatchObject({ enabled: true, reviewer: null });
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("is NOT_CONFIGURED (closed) without REROUTE_REVIEWERS, even with a legacy shared passcode set", async () => {
    vi.stubEnv("REROUTE_REVIEWERS", "");
    vi.stubEnv("REROUTE_REVIEWER_PASSCODE", PASSCODES.ed);
    const res = await signInRoute(request("/api/auth/session", { body: { reviewer: "ed", passcode: "" } }));
    expect(res.status).toBe(400); // empty passcode fails validation before anything else
    const res2 = await signInRoute(request("/api/auth/session", { body: { reviewer: "ed", passcode: PASSCODES.ed } }));
    expect(res2.status).toBe(503);
    expect(await res2.json()).toMatchObject({ code: "NOT_CONFIGURED" });
  });
});
