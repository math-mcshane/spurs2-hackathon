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

/** null = reviewer sign-in disabled (env missing or secret too short). */
export function authConfig(): AuthConfig | null {
  const passcode = process.env.REROUTE_REVIEWER_PASSCODE ?? "";
  const secret = process.env.REROUTE_SESSION_SECRET ?? "";
  if (!passcode || secret.length < MIN_SECRET_LENGTH) return null;
  return { passcode, secret };
}

function requireConfig(): AuthConfig {
  const config = authConfig();
  if (!config) {
    throw new AppError(
      "NOT_CONFIGURED",
      `Reviewer sign-in is disabled: set REROUTE_REVIEWER_PASSCODE and REROUTE_SESSION_SECRET (≥ ${MIN_SECRET_LENGTH} chars)`,
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
