import { pulseRoute } from "@/features/pulse/server/http";
import {
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
import { parseBody } from "@/lib/server/http";

/** GET /api/pulse/goal[?id=] — one goal run (or the latest) as `{ goal: GoalView | null }`. */
export const GET = pulseRoute(async (req) => {
  const id = new URL(req.url).searchParams.get("id") ?? undefined;
  return Response.json({ goal: await getGoal(id) });
});

/**
 * POST /api/pulse/goal — run | select | draft | checkRights | findAlternatives | useAlternative |
 * submitForReview; returns `{ goal: GoalView }`. Human review itself is POST /api/receipts/[id]/review.
 */
export const POST = pulseRoute(async (req) => {
  const body = await parseBody(req, GoalActionSchema);
  switch (body.action) {
    case "run":
      return Response.json({ goal: await runGoal(body.goal, body.club) });
    case "select":
      return Response.json({ goal: await selectMoment(body.id, body.key) });
    case "draft":
      return Response.json({ goal: await draftGoalCampaign(body.id, body.commerceUrl) });
    case "checkRights":
      return Response.json({ goal: await checkGoalRights(body.id) });
    case "findAlternatives":
      return Response.json({ goal: await findAlternatives(body.id) });
    case "useAlternative":
      return Response.json({ goal: await useAlternative(body.id, body.key) });
    case "submitForReview":
      return Response.json({ goal: await submitForReview(body.id) });
  }
});
