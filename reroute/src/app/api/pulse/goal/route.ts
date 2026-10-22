import { pulseRoute } from "@/features/pulse/server/http";
import {
  applyRemedy,
  checkGoalRights,
  draftGoalCampaign,
  findAlternatives,
  getGoal,
  runGoal,
  selectMoment,
  submitForReview,
  useAlternative,
} from "@/features/pulse/server/goal-service";
import { GoalActionSchema } from "@/features/pulse/types";
import { AppError } from "@/lib/errors";
import { parseBody } from "@/lib/server/http";

/** GET /api/pulse/goal?id= — one goal run as `{ goal: GoalView | null }` (null when unknown). `id` is required. */
export const GET = pulseRoute(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new AppError("BAD_REQUEST", "id is required");
  return Response.json({ goal: await getGoal(id) });
});

/**
 * POST /api/pulse/goal — run | select | draft | checkRights | findAlternatives | useAlternative |
 * applyRemedy | submitForReview; returns `{ goal: GoalView }`. Every action on an existing run carries
 * `expectedVersion` (stale → CONFLICT). Human review itself is POST /api/receipts/[id]/review.
 */
export const POST = pulseRoute(async (req) => {
  const body = await parseBody(req, GoalActionSchema);
  if (body.action === "run") return Response.json({ goal: await runGoal(body.goal, body.club) });
  const target = { id: body.id, expectedVersion: body.expectedVersion };
  switch (body.action) {
    case "select":
      return Response.json({ goal: await selectMoment(target, body.key) });
    case "draft":
      return Response.json({ goal: await draftGoalCampaign(target, body.commerceUrl) });
    case "checkRights":
      return Response.json({ goal: await checkGoalRights(target) });
    case "findAlternatives":
      return Response.json({ goal: await findAlternatives(target) });
    case "useAlternative":
      return Response.json({ goal: await useAlternative(target, body.key) });
    case "applyRemedy":
      return Response.json({ goal: await applyRemedy(target) });
    case "submitForReview":
      return Response.json({ goal: await submitForReview(target) });
  }
});
