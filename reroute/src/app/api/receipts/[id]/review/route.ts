import type { NextRequest } from "next/server";
import { ReviewRequestSchema } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { requireReviewer } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { recordReview } from "@/lib/server/store";

/** Only the decision comes from the body; who reviewed is the signed-in session, never a body field. */
const ReviewBodySchema = ReviewRequestSchema.pick({ status: true });

/**
 * POST /api/receipts/[id]/review — human review by the signed-in reviewer (name + time recorded).
 * A BLOCKED decision can never be approved: a verified deny is not overridable here.
 */
export const POST = route(async (req: NextRequest, ctx: RouteContext<"/api/receipts/[id]/review">) => {
  const { reviewer } = await requireReviewer(req);
  const { id } = await ctx.params;
  const { status } = await parseBody(req, ReviewBodySchema);
  const receipt = await recordReview(id, { status, reviewer }, (current) => {
    if (status === "APPROVED" && current.decision.verdict === "BLOCKED") {
      throw new AppError("FORBIDDEN", "A BLOCKED decision cannot be approved");
    }
  });
  return Response.json(receipt);
});
