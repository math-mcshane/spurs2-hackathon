import type * as NodeCrypto from "node:crypto";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCRYPT_SALT_BYTES,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  credVersion,
  getSession,
  hashPasscode,
  isSameOrigin,
  parseReviewers,
  requireReviewer,
  signIn,
  signSession,
  verifySession,
  type ReviewerCredential,
} from "./auth";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET = "s".repeat(48);
const NOW = new Date("2026-10-22T20:00:00.000Z");
const nowSec = Math.floor(NOW.getTime() / 1000);
const ED_PASS = "ed-personal-passcode-1234";
const JO_PASS = "jo-personal-passcode-5678";

async function credential(id: string, displayName: string, passcode: string): Promise<ReviewerCredential> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  return { id, displayName, salt: salt.toString("base64url"), scryptHash: (await hashPasscode(passcode, salt)).toString("base64url") };
}
const compact = (cs: ReviewerCredential[]) => cs.map((c) => `${c.id}:${c.displayName}:${c.scryptHash}:${c.salt}`).join(";");

let ed: ReviewerCredential;
let jo: ReviewerCredential;
beforeAll(async () => {
  [ed, jo] = await Promise.all([credential("ed", "Ed Smith", ED_PASS), credential("jo", "Jo Lee", JO_PASS)]);
});

const withCookie = (value: string) => new Request("http://localhost:3000/api/x", { headers: { cookie: `other=1; ${SESSION_COOKIE}=${value}` } });

beforeEach(() => {
  vi.stubEnv("REROUTE_REVIEWERS", compact([ed, jo]));
  vi.stubEnv("REROUTE_SESSION_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks(); // console spies only (vitest ≥ 3 leaves vi.fn mocks alone)
});

describe("session token", () => {
  const token = { sub: "ed", ver: "v1", iat: nowSec, exp: nowSec + SESSION_TTL_SECONDS };

  it("round-trips a signed token", () => {
    expect(verifySession(signSession(token, SECRET), SECRET, nowSec + 10)).toEqual(token);
  });

  it("rejects a tampered payload or signature", () => {
    const signed = signSession(token, SECRET);
    const [body, sig] = signed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...token, sub: "jo" })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, SECRET, nowSec)).toBeNull();
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(verifySession(`${body}.${flipped}`, SECRET, nowSec)).toBeNull();
    expect(verifySession(`${body}.`, SECRET, nowSec)).toBeNull();
    expect(verifySession(`${body}.${sig}.extra`, SECRET, nowSec)).toBeNull();
    expect(verifySession(signed, "x".repeat(48), nowSec)).toBeNull();
  });

  it("rejects expired, future-issued and over-long (> 4 h) sessions", () => {
    expect(SESSION_TTL_SECONDS).toBe(4 * 3600);
    expect(verifySession(signSession(token, SECRET), SECRET, token.exp)).toBeNull();
    expect(verifySession(signSession({ ...token, iat: nowSec + 3600, exp: nowSec + 7200 }, SECRET), SECRET, nowSec)).toBeNull();
    expect(verifySession(signSession({ ...token, exp: nowSec + SESSION_TTL_SECONDS + 1 }, SECRET), SECRET, nowSec)).toBeNull();
  });
});

describe("REROUTE_REVIEWERS", () => {
  it("accepts the compact and the JSON form", () => {
    expect(parseReviewers(compact([ed, jo])).map((r) => r.id)).toEqual(["ed", "jo"]);
    expect(parseReviewers(JSON.stringify([ed, jo])).map((r) => r.displayName)).toEqual(["Ed Smith", "Jo Lee"]);
  });

  it.each([
    ["empty list", ";"],
    ["a plaintext-looking entry", "ed:Ed Smith:hunter2"],
    ["a bad hash", () => compact([{ ...ed, scryptHash: "short" }])],
    ["a bad id", () => compact([{ ...ed, id: "Ed Smith" }])],
    ["duplicate ids", () => compact([ed, { ...jo, id: "ed" }])],
    ["a display name that is another reviewer's id", () => compact([ed, { ...jo, displayName: "ED" }])],
    ["broken JSON", "[{"],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseReviewers(typeof raw === "function" ? raw() : raw)).toThrow();
  });
});

describe("sign-in and reviewer requirement", () => {
  it("issues an HttpOnly, SameSite=Strict, 4-hour cookie for the reviewer's own passcode", async () => {
    const { session, cookie } = await signIn("ed", ED_PASS, NOW);
    expect(session).toEqual({ reviewerId: "ed", reviewer: "Ed Smith", iat: nowSec, exp: nowSec + 4 * 3600 });
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/", maxAge: 4 * 3600, secure: false });
    expect(await getSession(withCookie(cookie.value), NOW)).toEqual(session);
    expect(await getSession(withCookie(cookie.value), new Date(NOW.getTime() + 4 * 3600 * 1000))).toBeNull();
  });

  it("accepts the display name (any case) as the login; identity is always the configured one", async () => {
    expect((await signIn("  ed smith ", ED_PASS, NOW)).session).toMatchObject({ reviewerId: "ed", reviewer: "Ed Smith" });
    expect((await signIn("JO", JO_PASS, NOW)).session).toMatchObject({ reviewerId: "jo", reviewer: "Jo Lee" });
  });

  it("refuses another reviewer's passcode, a wrong one and an unknown reviewer — all FORBIDDEN", async () => {
    await expect(signIn("ed", JO_PASS)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(signIn("ed", `${ED_PASS}x`)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(signIn("mallory", ED_PASS)).rejects.toMatchObject({ code: "FORBIDDEN", message: "Wrong reviewer or passcode" });
  });

  it("compares derived keys in constant time, even for an unknown reviewer", async () => {
    vi.mocked(timingSafeEqual).mockClear();
    await expect(signIn("mallory", "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(timingSafeEqual).toHaveBeenCalledWith(expect.objectContaining({ length: 32 }), expect.objectContaining({ length: 32 }));
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await signIn("ed", ED_PASS)).cookie.options.secure).toBe(true);
  });

  it("requireReviewer returns the configured identity, FORBIDDEN without a valid cookie", async () => {
    const { cookie } = await signIn("ed", ED_PASS);
    await expect(requireReviewer(withCookie(cookie.value))).resolves.toEqual({ reviewer: "Ed Smith", reviewerId: "ed" });
    await expect(requireReviewer(new Request("http://localhost/api/x"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireReviewer(withCookie("garbage"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a validly signed token for an unknown reviewer or stale credVersion is rejected", async () => {
    const token = (sub: string, ver: string) => signSession({ sub, ver, iat: nowSec, exp: nowSec + 60 }, SECRET);
    expect(await getSession(withCookie(token("ed", credVersion(ed))), NOW)).toMatchObject({ reviewer: "Ed Smith" });
    expect(await getSession(withCookie(token("mallory", credVersion(ed))), NOW)).toBeNull();
    expect(await getSession(withCookie(token("ed", credVersion(jo))), NOW)).toBeNull();
  });

  it("rotating a reviewer's hash invalidates their sessions; other reviewers stay signed in", async () => {
    const edCookie = (await signIn("ed", ED_PASS, NOW)).cookie.value;
    const joCookie = (await signIn("jo", JO_PASS, NOW)).cookie.value;
    const rotated = await credential("ed", "Ed Smith", "ed-new-passcode-abcdefgh");
    vi.stubEnv("REROUTE_REVIEWERS", compact([rotated, jo]));
    expect(await getSession(withCookie(edCookie), NOW)).toBeNull();
    await expect(requireReviewer(withCookie(edCookie))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await getSession(withCookie(joCookie), NOW)).toMatchObject({ reviewerId: "jo" });
    await expect(signIn("ed", ED_PASS)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await signIn("ed", "ed-new-passcode-abcdefgh")).session.reviewer).toBe("Ed Smith");
  });

  it("removing a reviewer invalidates their sessions", async () => {
    const edCookie = (await signIn("ed", ED_PASS, NOW)).cookie.value;
    vi.stubEnv("REROUTE_REVIEWERS", compact([jo]));
    expect(await getSession(withCookie(edCookie), NOW)).toBeNull();
  });

  it.each([
    ["reviewers missing", "REROUTE_REVIEWERS", ""],
    ["reviewers invalid", "REROUTE_REVIEWERS", "ed:Ed:not-a-hash:salt"],
    ["legacy shared passcode only", "REROUTE_REVIEWERS", ""],
    ["secret missing", "REROUTE_SESSION_SECRET", ""],
    ["secret too short", "REROUTE_SESSION_SECRET", "short-secret"],
  ])("is disabled, never open, when %s", async (label, name, value) => {
    const { cookie } = await signIn("ed", ED_PASS);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv(name, value);
    if (label.startsWith("legacy")) vi.stubEnv("REROUTE_REVIEWER_PASSCODE", ED_PASS);
    await expect(signIn("ed", ED_PASS)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(requireReviewer(withCookie(cookie.value))).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await getSession(withCookie(cookie.value))).toBeNull();
  });

  it("never logs configured values when the reviewer list is invalid", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("REROUTE_REVIEWERS", `ed:Ed Smith:${ed.scryptHash}:x`);
    await expect(signIn("ed", ED_PASS)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(ed.scryptHash);
  });
});

describe("same-origin check", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers });

  it("accepts same-origin browser requests", () => {
    expect(isSameOrigin(req({ host: "localhost:3000", origin: "http://localhost:3000" }))).toBe(true);
    expect(isSameOrigin(req({ host: "localhost:3000", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOrigin(req({ host: "internal:3000", "x-forwarded-host": "reroute.vercel.app", origin: "https://reroute.vercel.app" }))).toBe(true);
  });

  it("rejects cross-site, opaque and header-less requests", () => {
    expect(isSameOrigin(req({ host: "localhost:3000", origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(req({ host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(req({ host: "localhost:3000", "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isSameOrigin(req({ host: "localhost:3000", origin: "null" }))).toBe(false);
    expect(isSameOrigin(req({ host: "localhost:3000" }))).toBe(false);
  });
});
