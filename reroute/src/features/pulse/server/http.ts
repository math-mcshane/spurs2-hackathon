import { connection } from "next/server";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/server/http";
import { isPulseEnabled } from "../flags";

/**
 * Every PULSE API route goes through this: request-time flag check (never prerendered), plain 404
 * when disabled — before any parsing, store access or upstream call — then REROUTE's uniform error
 * handling. Mutations additionally reject cross-origin browser requests; the app has no session
 * layer of its own (access is Vercel Deployment Protection).
 */
export function pulseRoute(handler: (req: Request) => Promise<Response>) {
  const wrapped = route(async (req: Request) => {
    if (req.method !== "GET") {
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== req.headers.get("host")) {
        throw new AppError("FORBIDDEN", "Cross-origin PULSE mutations are not allowed");
      }
    }
    return handler(req);
  });
  return async (req: Request): Promise<Response> => {
    await connection();
    if (!isPulseEnabled()) return new Response(null, { status: 404 });
    return wrapped(req);
  };
}
