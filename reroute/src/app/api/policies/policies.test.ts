import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import type * as NextServer from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/lib/rights/policies/tottenham-international-window.sample.json";
import { SCRYPT_SALT_BYTES, SESSION_COOKIE, hashPasscode, signIn, type ReviewerCredential } from "@/lib/server/auth";
import { resetRateLimitsForTests } from "@/lib/server/rate-limit";
import { resetRepositoriesForTests, useMemoryRepositoriesForTests } from "@/lib/server/repositories/testing";
import type { Repositories } from "@/lib/server/repositories/types";
import { proxy } from "@/proxy";
import { GET as getPackage } from "./[id]/route";
import { GET as list, POST as upload } from "./route";
import { GET as downloadSample } from "./sample/route";
import { POST as select } from "./select/route";

// Route handlers call next/server `connection()`, which needs a Next request scope.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof NextServer>()), connection: async () => {} }));

/** Policy Center API, fully mocked: in-memory repositories, no network, no Supabase. */

const ORIGIN = "http://localhost:3000";
const PASSCODE = "ed-personal-passcode-1234";
let reviewersEnv: string;
let repos: Repositories;

beforeAll(async () => {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const scryptHash = (await hashPasscode(PASSCODE, salt)).toString("base64url");
  const creds: ReviewerCredential[] = [{ id: "ed", displayName: "Ed Smith", scryptHash, salt: salt.toString("base64url") }];
  reviewersEnv = JSON.stringify(creds);
});
beforeEach(() => {
  vi.stubEnv("REROUTE_REVIEWERS", reviewersEnv);
  vi.stubEnv("REROUTE_SESSION_SECRET", "k".repeat(48));
  repos = useMemoryRepositoriesForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetRepositoriesForTests();
  resetRateLimitsForTests();
});

const cookie = async () => (await signIn("ed", PASSCODE)).cookie.value;

function req(path: string, init: { method?: string; body?: BodyInit; type?: string; session?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", origin: init.origin ?? ORIGIN };
  if (init.type) headers["content-type"] = init.type;
  if (init.session) headers.cookie = `${SESSION_COOKIE}=${init.session}`;
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body });
}

function multipart(name: string, content: string, type: string, session?: string) {
  const form = new FormData();
  form.set("file", new File([content], name, { type }));
  return new NextRequest(`${ORIGIN}/api/policies`, {
    method: "POST",
    headers: { host: "localhost:3000", origin: ORIGIN, ...(session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}) },
    body: form,
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/policies", () => {
  it("lists presets and the sample mapping with the workspace default marked; ?club= filters", async () => {
    const res = await list(req("/api/policies"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadsAvailable).toBe(true);
    expect(body.policies.map((p: { id: string; isDefault: boolean }) => [p.id, p.isDefault])).toEqual([
      ["demo-spurs-fr-sponsored", true],
      ["demo-tottenham-pl", true],
      ["demo-tottenham-commercial", false],
      ["demo-tottenham-international", false],
    ]);
    const spurs = await (await list(req("/api/policies?club=spurs"))).json();
    expect(spurs.policies.map((p: { id: string }) => p.id)).toEqual(["demo-spurs-fr-sponsored"]);
  });

  it("GET /api/policies/[id] → summary + plain-language rules; unknown → 404", async () => {
    const body = await (await getPackage(req("/api/policies/demo-tottenham-commercial"), ctx("demo-tottenham-commercial"))).json();
    expect(body.policy).toMatchObject({ id: "demo-tottenham-commercial", isDefault: false, partners: ["AIA", "Nike", "Kraken"] });
    expect(body.rules).toHaveLength(16);
    expect(body.rules[0]).toMatchObject({ id: "THFC-C1-competition", effect: "PERMIT", topics: ["Competition"] });
    expect((await getPackage(req("/api/policies/nope"), ctx("nope"))).status).toBe(404);
  });

  it("serves the upload sample as a download", async () => {
    const res = downloadSample();
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="tottenham-international-window\.sample\.json"/);
    expect((await res.json()).id).toBe("demo-tottenham-international");
  });
});

describe("POST /api/policies (upload)", () => {
  it("requires a same-origin request and a reviewer session", async () => {
    expect((await proxy(req("/api/policies", { method: "POST", origin: "https://evil.example", type: "application/json", body: "{}" }))).status).toBe(403);
    const anonymous = await upload(req("/api/policies", { method: "POST", type: "application/json", body: JSON.stringify(sample) }));
    expect(anonymous.status).toBe(403);
    expect(await anonymous.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(await repos.policyPackages.list()).toEqual([]);
  });

  it("imports a JSON file (multipart) as an unverified DEMO package and records who uploaded it", async () => {
    const res = await upload(multipart("window.json", JSON.stringify({ ...sample, kind: "VERIFIED" }), "application/json", await cookie()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.package).toMatchObject({ id: "demo-tottenham-international", kind: "DEMO", verified: false, sourceType: "UPLOADED_JSON", fileName: "window.json", uploadedBy: "Ed Smith" });
    expect(body.notes[0]).toMatch(/stored as DEMO/);
    const listed = await (await list(req("/api/policies?club=tottenham"))).json();
    expect(listed.policies.map((p: { id: string }) => p.id)).toContain("demo-tottenham-international");
  });

  it("accepts a raw JSON body; invalid documents are 400", async () => {
    const session = await cookie();
    expect((await upload(req("/api/policies", { method: "POST", type: "application/json", body: JSON.stringify(sample), session }))).status).toBe(201);
    const bad = await upload(req("/api/policies", { method: "POST", type: "application/json", body: '{"id":"x"}', session }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each([
    ["contract.pdf", "application/pdf"],
    ["contract.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["terms.txt", "text/plain"],
  ])("does not extract rules from %s (422)", async (name, type) => {
    const res = await upload(multipart(name, "Licensed territories: worldwide", type, await cookie()));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "Only JSON rule packages can be imported. Contract (PDF) extraction is not supported in this build.",
      code: "BAD_REQUEST",
    });
    expect(await repos.policyPackages.list()).toEqual([]);
  });
});

describe("POST /api/policies/select", () => {
  it("requires a reviewer, then sets and persists the workspace default", async () => {
    const body = JSON.stringify({ club: "tottenham", packageId: "demo-tottenham-commercial" });
    expect((await select(req("/api/policies/select", { method: "POST", type: "application/json", body }))).status).toBe(403);
    const res = await select(req("/api/policies/select", { method: "POST", type: "application/json", body, session: await cookie() }));
    expect(res.status).toBe(200);
    expect((await res.json()).selection).toMatchObject({ club: "tottenham", packageId: "demo-tottenham-commercial", selectedBy: "Ed Smith" });
    const listed = await (await list(req("/api/policies?club=tottenham"))).json();
    expect(listed.policies.find((p: { isDefault: boolean }) => p.isDefault).id).toBe("demo-tottenham-commercial");
    expect(await repos.events.list("policy_selection", "tottenham")).toMatchObject([{ type: "POLICY_SELECTED", actor: "Ed Smith" }]);
  });
});
