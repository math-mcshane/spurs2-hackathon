import { pulseRoute } from "@/features/pulse/server/http";
import {
  applyRecovery,
  checkGoalRights,
  draftGoalCampaign,
  findRecovery,
  getGoal,
  goalDeps,
  runGoal,
  selectMoment,
  setRunPolicy,
  submitForReview,
} from "@/features/pulse/server/goal-service";
import { GoalActionSchema } from "@/features/pulse/types";
import { AppError } from "@/lib/errors";
import { mediaAccess } from "@/lib/media/preview";
import { parseBody } from "@/lib/server/http";

/**
 * GET /api/pulse/goal?id= — one goal run as `{ goal: GoalView | null }` (null when unknown). `id` is required.
 * Every response carries footage-derived URLs (previews, thumbnails) only for `mediaAccess(req) === "ALLOWED"`.
 */
export const GET = pulseRoute(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new AppError("BAD_REQUEST", "id is required");
  return Response.json({ goal: await getGoal(id, goalDeps(await mediaAccess(req))) });
});

/**
 * POST /api/pulse/goal — run | select | draft | checkRights | findRecovery | applyRecovery | setPolicy |
 * submitForReview; returns `{ goal: GoalView }`. Every action on an existing run carries `expectedVersion`
 * (stale → CONFLICT). Human review itself is POST /api/receipts/[id]/review.
 */
export const POST = pulseRoute(async (req) => {
  const [body, media] = await Promise.all([parseBody(req, GoalActionSchema), mediaAccess(req)]);
  const deps = goalDeps(media);
  if (body.action === "run") return Response.json({ goal: await runGoal(body.goal, body.club, deps) });
  const target = { id: body.id, expectedVersion: body.expectedVersion };
  switch (body.action) {
    case "select":
      return Response.json({ goal: await selectMoment(target, body.key, deps) });
    case "draft":
      return Response.json({ goal: await draftGoalCampaign(target, body.commerceUrl, deps) });
    case "checkRights":
      return Response.json({ goal: await checkGoalRights(target, deps) });
    case "findRecovery":
      return Response.json({ goal: await findRecovery(target, deps) });
    case "applyRecovery":
      return Response.json({ goal: await applyRecovery(target, body.optionId, deps) });
    case "setPolicy":
      return Response.json({ goal: await setRunPolicy(target, body.packageId, deps) });
    case "submitForReview":
      return Response.json({ goal: await submitForReview(target, deps) });
  }
});
