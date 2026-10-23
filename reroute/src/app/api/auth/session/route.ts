import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { isMediaPreviewEnabled } from "@/features/pulse/flags";
import { attemptSignIn, authConfig, getSession, signOutCookie, type ReviewerSession } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";

/** Any other field (e.g. a `name`) is stripped: the session identity comes from REROUTE_REVIEWERS only. */
const SignInSchema = z.object({ reviewer: z.string().trim().min(1).max(80), passcode: z.string().min(1).max(200) });

function body(session: ReviewerSession | null) {
  return {
    enabled: authConfig() !== null,
    reviewer: session && { id: session.reviewerId, name: session.reviewer, expiresAt: new Date(session.exp * 1000).toISOString() },
    mediaPreview: isMediaPreviewEnabled(),
  };
}

/** GET /api/auth/session → { enabled, reviewer: { id, name, expiresAt } | null, mediaPreview } */
export const GET = route(async (req: Request) => {
  await connection();
  return Response.json(body(await getSession(req)));
});

/**
 * POST /api/auth/session { reviewer: id or display name, passcode } → signed HttpOnly reviewer cookie (4 h) for
 * the configured reviewer. Unknown reviewer or wrong passcode → FORBIDDEN after a fixed delay; repeated failures
 * from one address → RATE_LIMITED (429, Retry-After); the proxy also caps attempts at 5/min per address.
 */
export const POST = route(async (req: Request) => {
  const { reviewer, passcode } = await parseBody(req, SignInSchema);
  const { session, cookie } = await attemptSignIn(req, reviewer, passcode);
  const res = NextResponse.json(body(session));
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
});

/** DELETE /api/auth/session → signs out. */
export const DELETE = route(async () => {
  const res = NextResponse.json(body(null));
  const cookie = signOutCookie();
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
});
