import type * as NodeCrypto from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  getSession,
  isSameOrigin,
  passcodeMatches,
  requireReviewer,
  signIn,
  signSession,
  verifySession,
} from "./auth";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET = "s".repeat(48);
const NOW = new Date("2026-10-22T20:00:00.000Z");
const nowSec = Math.floor(NOW.getTime() / 1000);

const withCookie = (value: string) => new Request("http://localhost:3000/api/x", { headers: { cookie: `other=1; ${SESSION_COOKIE}=${value}` } });

beforeEach(() => {
  vi.stubEnv("REROUTE_REVIEWER_PASSCODE", "spurs-demo-review");
  vi.stubEnv("REROUTE_SESSION_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("session token", () => {
  const session = { reviewer: "Ed", iat: nowSec, exp: nowSec + SESSION_TTL_SECONDS };

  it("round-trips a signed session", () => {
    expect(verifySession(signSession(session, SECRET), SECRET, nowSec + 10)).toEqual(session);
  });

  it("rejects a tampered payload or signature", () => {
    const token = signSession(session, SECRET);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...session, reviewer: "Mallory" })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, SECRET, nowSec)).toBeNull();
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(verifySession(`${body}.${flipped}`, SECRET, nowSec)).toBeNull();
    expect(verifySession(`${body}.`, SECRET, nowSec)).toBeNull();
    expect(verifySession(`${body}.${sig}.extra`, SECRET, nowSec)).toBeNull();
    expect(verifySession(token, "x".repeat(48), nowSec)).toBeNull();
  });

  it("rejects expired, future-issued and over-long sessions", () => {
    const token = signSession(session, SECRET);
    expect(verifySession(token, SECRET, session.exp)).toBeNull();
    expect(verifySession(signSession({ ...session, iat: nowSec + 3600, exp: nowSec + 7200 }, SECRET), SECRET, nowSec)).toBeNull();
    expect(verifySession(signSession({ ...session, exp: nowSec + SESSION_TTL_SECONDS + 1 }, SECRET), SECRET, nowSec)).toBeNull();
  });
});

describe("passcode", () => {
  it("matches only the exact passcode, regardless of length", () => {
    expect(passcodeMatches("spurs-demo-review", "spurs-demo-review")).toBe(true);
    expect(passcodeMatches("spurs-demo-revieW", "spurs-demo-review")).toBe(false);
    expect(passcodeMatches("", "spurs-demo-review")).toBe(false);
    expect(passcodeMatches("spurs-demo-review-and-more", "spurs-demo-review")).toBe(false);
  });

  it("compares in constant time (hashes both sides, then timingSafeEqual)", () => {
    vi.mocked(timingSafeEqual).mockClear();
    passcodeMatches("short", "spurs-demo-review");
    // Same-length digests are compared even when the inputs differ in length.
    expect(timingSafeEqual).toHaveBeenCalledWith(expect.objectContaining({ length: 32 }), expect.objectContaining({ length: 32 }));
  });
});

describe("sign-in and reviewer requirement", () => {
  it("issues an HttpOnly, SameSite=Lax, 8-hour cookie for the right passcode", async () => {
    const { session, cookie } = signIn("spurs-demo-review", "  Ed  ", NOW);
    expect(session).toEqual({ reviewer: "Ed", iat: nowSec, exp: nowSec + 8 * 3600 });
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 8 * 3600 });
    expect(await getSession(withCookie(cookie.value), NOW)).toEqual(session);
    expect(await getSession(withCookie(cookie.value), new Date(NOW.getTime() + 8 * 3600 * 1000))).toBeNull();
  });

  it("marks the cookie Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(signIn("spurs-demo-review", "Ed").cookie.options.secure).toBe(true);
  });

  it("refuses a wrong passcode (FORBIDDEN) and a bad name (BAD_REQUEST)", () => {
    expect(() => signIn("nope", "Ed")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => signIn("spurs-demo-review", "   ")).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    expect(() => signIn("spurs-demo-review", "Ed\u0007")).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("requireReviewer returns the session name, FORBIDDEN without a valid cookie", async () => {
    const { cookie } = signIn("spurs-demo-review", "Ed");
    await expect(requireReviewer(withCookie(cookie.value))).resolves.toEqual({ reviewer: "Ed" });
    await expect(requireReviewer(new Request("http://localhost/api/x"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireReviewer(withCookie("garbage"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each([
    ["passcode missing", "REROUTE_REVIEWER_PASSCODE", ""],
    ["secret missing", "REROUTE_SESSION_SECRET", ""],
    ["secret too short", "REROUTE_SESSION_SECRET", "short-secret"],
  ])("is disabled, never open, when %s", async (_label, name, value) => {
    const { cookie } = signIn("spurs-demo-review", "Ed");
    vi.stubEnv(name, value);
    expect(() => signIn("spurs-demo-review", "Ed")).toThrow(expect.objectContaining({ code: "NOT_CONFIGURED" }));
    await expect(requireReviewer(withCookie(cookie.value))).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await getSession(withCookie(cookie.value))).toBeNull();
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
