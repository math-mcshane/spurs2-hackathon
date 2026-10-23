import { AppError } from "@/lib/errors";

/**
 * Optional gate for public integration probes.
 * When `REROUTE_TEST_SECRET` is set, require Bearer / `X-Reroute-Test-Secret` / `?token=`.
 * When unset (hackathon default), probes are open — still respect Vercel Deployment Protection
 * unless the path is excluded or `x-vercel-protection-bypass` is used.
 */
export function assertTestAccess(req: Request): void {
  const secret = process.env.REROUTE_TEST_SECRET?.trim();
  if (!secret) return;

  const auth = req.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const header = req.headers.get("x-reroute-test-secret")?.trim() ?? "";
  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";

  if (bearer === secret || header === secret || token === secret) return;
  throw new AppError("FORBIDDEN", "Invalid or missing REROUTE_TEST_SECRET");
}
