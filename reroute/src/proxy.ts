import { NextResponse, type NextRequest } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { isSameOrigin, requireReviewer } from "@/lib/server/auth";

/**
 * API gate (Next 16 proxy, Node runtime):
 * - every mutating /api/** request must be same-origin (CSRF);
 * - review, HUMAN observations, writeback and render need a signed-in reviewer.
 * Route handlers re-check the reviewer themselves (`requireReviewer`) — this is the outer layer, not the only one.
 */

const MUTATING: Record<string, true> = { POST: true, PUT: true, PATCH: true, DELETE: true };

const REVIEWER_ONLY: readonly RegExp[] = [
  /^\/api\/receipts\/[^/]+\/review\/?$/,
  /^\/api\/observations\/?$/,
  /^\/api\/writeback\/?$/,
  /^\/api\/render\/?$/,
];

export async function proxy(request: NextRequest): Promise<Response> {
  if (!MUTATING[request.method]) return NextResponse.next();
  if (!isSameOrigin(request)) {
    return toErrorResponse(new AppError("FORBIDDEN", "Cross-origin requests cannot change data"));
  }
  if (request.method === "POST" && REVIEWER_ONLY.some((re) => re.test(request.nextUrl.pathname))) {
    try {
      await requireReviewer(request);
    } catch (err) {
      return toErrorResponse(err);
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
