import { pulseRoute } from "@/features/pulse/server/http";
import { approveGoalCampaign, checkGoalRights, draftGoalCampaign, findAlternatives, getGoal, runGoal } from "@/features/pulse/server/goal-service";
import { GoalActionSchema } from "@/features/pulse/types";
import { parseBody } from "@/lib/server/http";

/** GET /api/pulse/goal[?id=] — one goal run (or the latest) as `{ goal }`; `goal` is null before the first one. */
export const GET = pulseRoute(async (req) => {
  const id = new URL(req.url).searchParams.get("id") ?? undefined;
  return Response.json({ goal: await getGoal(id) });
});

/** POST /api/pulse/goal — run | draft | checkRights | findAlternatives | approve; returns `{ goal }`. */
export const POST = pulseRoute(async (req) => {
  const body = await parseBody(req, GoalActionSchema);
  switch (body.action) {
    case "run":
      return Response.json({ goal: await runGoal(body.goal, body.club) });
    case "draft":
      return Response.json({ goal: await draftGoalCampaign(body.id, body.key, body.commerceUrl) });
    case "checkRights":
      return Response.json({ goal: await checkGoalRights(body.id) });
    case "findAlternatives":
      return Response.json({ goal: await findAlternatives(body.id) });
    case "approve":
      return Response.json({ goal: await approveGoalCampaign(body.id, body.reviewer) });
  }
});
