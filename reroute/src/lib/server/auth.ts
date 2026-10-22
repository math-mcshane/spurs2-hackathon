import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";

/**
 * Reviewer sessions: a shared passcode (REROUTE_REVIEWER_PASSCODE) unlocks an 8-hour HttpOnly cookie
 * signed with HMAC-SHA256 (REROUTE_SESSION_SECRET). Without both env vars reviewer sign-in is disabled —
 * never open. Used by route handlers and by `src/proxy.ts` (Node runtime), so it stays free of
 * `server-only`; it is never imported by client code.
 */

export const SESSION_COOKIE = "reroute_reviewer";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MIN_SECRET_LENGTH = 32;
/** A shared passcode is the only factor, so production refuses short ones (dev/test may use anything). */
const MIN_PRODUCTION_PASSCODE_LENGTH = 12;
/** Tolerated clock skew for `iat` between instances. */
const CLOCK_SKEW_SECONDS = 60;

export const ReviewerNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name")
  .max(80)
  .regex(/^[^\p{Cc}]+$/u, "Name contains control characters");

const SessionSchema = z.object({ reviewer: ReviewerNameSchema, iat: z.number().int(), exp: z.number().int() });
export type ReviewerSession = z.infer<typeof SessionSchema>;

type AuthConfig = { passcode: string; secret: string };

/** null = reviewer sign-in disabled (env missing, secret too short, or a short passcode in production). */
export function authConfig(): AuthConfig | null {
  const passcode = process.env.REROUTE_REVIEWER_PASSCODE ?? "";
  const secret = process.env.REROUTE_SESSION_SECRET ?? "";
  if (!passcode || secret.length < MIN_SECRET_LENGTH) return null;
  if (process.env.NODE_ENV === "production" && passcode.length < MIN_PRODUCTION_PASSCODE_LENGTH) return null;
  return { passcode, secret };
}

function requireConfig(): AuthConfig {
  const config = authConfig();
  if (!config) {
    throw new AppError(
      "NOT_CONFIGURED",
      `Reviewer sign-in is disabled: set REROUTE_REVIEWER_PASSCODE (≥ ${MIN_PRODUCTION_PASSCODE_LENGTH} chars in production) and REROUTE_SESSION_SECRET (≥ ${MIN_SECRET_LENGTH} chars)`,
    );
  }
  return config;
}

function mac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

/** `<base64url(json)>.<base64url(hmac)>` */
export function signSession(session: ReviewerSession, secret: string): string {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${body}.${mac(secret, body).toString("base64url")}`;
}

/** The session if the signature, shape and lifetime all check out; otherwise null. */
export function verifySession(token: string, secret: string, nowSeconds: number): ReviewerSession | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, signature] = parts;
  const expected = mac(secret, body);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = SessionSchema.safeParse(json);
  if (!parsed.success) return null;
  const { iat, exp } = parsed.data;
  if (exp <= nowSeconds || iat > nowSeconds + CLOCK_SKEW_SECONDS || exp - iat > SESSION_TTL_SECONDS) return null;
  return parsed.data;
}

/** Constant-time comparison independent of either length (both sides hashed to 32 bytes first). */
export function passcodeMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** The signed-in reviewer, or null (also null when sign-in is disabled). */
export async function getSession(req: Request, now: Date = new Date()): Promise<ReviewerSession | null> {
  const config = authConfig();
  const token = readCookie(req, SESSION_COOKIE);
  if (!config || !token) return null;
  return verifySession(token, config.secret, Math.floor(now.getTime() / 1000));
}

/** Reviewer identity always comes from the session, never from a request body. */
export async function requireReviewer(req: Request): Promise<{ reviewer: string }> {
  requireConfig();
  const session = await getSession(req);
  if (!session) throw new AppError("FORBIDDEN", "Sign in as a reviewer to do this");
  return { reviewer: session.reviewer };
}

export type SessionCookie = {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number };
};

function cookie(value: string, maxAge: number): SessionCookie {
  return {
    name: SESSION_COOKIE,
    value,
    options: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge },
  };
}

/** Checks the passcode (FORBIDDEN on mismatch) and issues a signed 8-hour session cookie. */
export function signIn(passcode: string, name: string, now: Date = new Date()): { session: ReviewerSession; cookie: SessionCookie } {
  const config = requireConfig();
  if (!passcodeMatches(passcode, config.passcode)) throw new AppError("FORBIDDEN", "Wrong reviewer passcode");
  const reviewer = ReviewerNameSchema.safeParse(name);
  if (!reviewer.success) throw new AppError("BAD_REQUEST", z.prettifyError(reviewer.error));
  const iat = Math.floor(now.getTime() / 1000);
  const session: ReviewerSession = { reviewer: reviewer.data, iat, exp: iat + SESSION_TTL_SECONDS };
  return { session, cookie: cookie(signSession(session, config.secret), SESSION_TTL_SECONDS) };
}

// ---------- Sign-in throttling ----------
//
// Defence in depth only: this limiter is per server instance and in memory, so on Vercel (many instances,
// cold starts) the real control is a Vercel Firewall rate-limit rule on POST /api/auth/session.

export const SIGN_IN_FAILURE_DELAY_MS = 750;
export const SIGN_IN_MAX_FAILURES = 10;
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
/** Bound on tracked client addresses, so a spray of addresses cannot grow memory without limit. */
const SIGN_IN_MAX_TRACKED = 10_000;

/** Failure timestamps per client address within the current window. */
const signInFailures = new Map<string, number[]>();

/** Client address as set by the platform proxy (Vercel sets both headers); local requests share "unknown". */
export function clientAddress(req: Request): string {
  return req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function recentFailures(address: string, now: number): number[] {
  const recent = (signInFailures.get(address) ?? []).filter((t) => now - t < SIGN_IN_WINDOW_MS);
  if (recent.length) signInFailures.set(address, recent);
  else signInFailures.delete(address);
  return recent;
}

function recordSignInFailure(address: string, now: number): void {
  if (!signInFailures.has(address) && signInFailures.size >= SIGN_IN_MAX_TRACKED) {
    for (const key of signInFailures.keys()) recentFailures(key, now);
    // Still full: forget the oldest-tracked address (Map iterates in insertion order).
    if (signInFailures.size >= SIGN_IN_MAX_TRACKED) signInFailures.delete(signInFailures.keys().next().value!);
  }
  signInFailures.set(address, [...recentFailures(address, now), now]);
}

export function resetSignInThrottleForTests(): void {
  signInFailures.clear();
}

/**
 * `signIn` behind the throttle: while an address has SIGN_IN_MAX_FAILURES failures in the window every
 * attempt (even a correct passcode) gets RATE_LIMITED; each wrong passcode is answered after a fixed delay.
 */
export async function attemptSignIn(
  req: Request,
  passcode: string,
  name: string,
): Promise<{ session: ReviewerSession; cookie: SessionCookie }> {
  const address = clientAddress(req);
  const recent = recentFailures(address, Date.now());
  if (recent.length >= SIGN_IN_MAX_FAILURES) {
    const retryAfter = Math.max(1, Math.ceil((recent[0] + SIGN_IN_WINDOW_MS - Date.now()) / 1000));
    throw new AppError("RATE_LIMITED", "Too many failed sign-in attempts; try again later", {
      headers: { "Retry-After": String(retryAfter) },
    });
  }
  try {
    return signIn(passcode, name);
  } catch (err) {
    if (err instanceof AppError && err.code === "FORBIDDEN") {
      recordSignInFailure(address, Date.now());
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, SIGN_IN_FAILURE_DELAY_MS);
      await promise;
    }
    throw err;
  }
}

export function signOutCookie(): SessionCookie {
  return cookie("", 0);
}

/**
 * CSRF guard for mutating requests: the browser must say the request is same-origin (Sec-Fetch-Site) and/or
 * send an Origin whose host is this server's host. Requests carrying neither are rejected.
 */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return site === "same-origin";
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // includes the opaque "null" origin
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return !!host && originHost === host;
}
