import { connection } from "next/server";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/server/http";
import { isPulseBoardEnabled } from "../flags";

/**
 * Every PULSE API route goes through this: request-time evaluation (never prerendered), cross-origin
 * mutations rejected, then REROUTE's uniform error handling.
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
    return wrapped(req);
  };
}

/**
 * Routes of the SIMULATED fan-signal board: plain 404 unless `PULSE_BOARD_ENABLED=true` — checked
 * before any parsing, store access or upstream call.
 */
export function boardRoute(handler: (req: Request) => Promise<Response>) {
  const inner = pulseRoute(handler);
  return async (req: Request): Promise<Response> => {
    await connection();
    if (!isPulseBoardEnabled()) return new Response(null, { status: 404 });
    return inner(req);
  };
}
