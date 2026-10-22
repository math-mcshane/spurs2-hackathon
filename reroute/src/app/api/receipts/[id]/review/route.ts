import type { NextRequest } from "next/server";
import { ReviewRequestSchema } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { parseBody, route } from "@/lib/server/http";
import { recordReview } from "@/lib/server/store";

/**
 * POST /api/receipts/[id]/review — human review (reviewer + time recorded).
 * A BLOCKED decision can never be approved: a verified deny is not overridable here.
 */
export const POST = route(async (req: NextRequest, ctx: RouteContext<"/api/receipts/[id]/review">) => {
  const { id } = await ctx.params;
  const review = await parseBody(req, ReviewRequestSchema);
  if (!review.reviewer.trim()) throw new AppError("BAD_REQUEST", "reviewer is required");
  const receipt = await recordReview(id, { ...review, reviewer: review.reviewer.trim() }, (current) => {
    if (review.status === "APPROVED" && current.decision.verdict === "BLOCKED") {
      throw new AppError("FORBIDDEN", "A BLOCKED decision cannot be approved");
    }
  });
  return Response.json(receipt);
});
