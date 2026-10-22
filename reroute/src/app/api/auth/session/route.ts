import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { authConfig, getSession, signIn, signOutCookie, type ReviewerSession } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";

const SignInSchema = z.object({ passcode: z.string().min(1).max(200), name: z.string() });

function body(session: ReviewerSession | null) {
  return {
    enabled: authConfig() !== null,
    reviewer: session && { name: session.reviewer, expiresAt: new Date(session.exp * 1000).toISOString() },
  };
}

/** GET /api/auth/session → { enabled, reviewer: { name, expiresAt } | null } */
export const GET = route(async (req: Request) => {
  await connection();
  return Response.json(body(await getSession(req)));
});

/** POST /api/auth/session { passcode, name } → signed HttpOnly reviewer cookie (8 h). Wrong passcode → FORBIDDEN. */
export const POST = route(async (req: Request) => {
  const { passcode, name } = await parseBody(req, SignInSchema);
  const { session, cookie } = signIn(passcode, name);
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
