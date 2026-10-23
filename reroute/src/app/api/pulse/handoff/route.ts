import { boardRoute } from "@/features/pulse/server/http";
import { handoff } from "@/features/pulse/server/service";
import { HandoffRequestSchema } from "@/features/pulse/types";
import { forMediaAccess, mediaAccess } from "@/lib/media/preview";
import { parseBody } from "@/lib/server/http";

/** POST /api/pulse/handoff — send one candidate through REROUTE's decision; returns the REROUTE deep link. */
export const POST = boardRoute(async (req) => {
  const [{ opportunityId, scoreplayAssetId }, access] = await Promise.all([parseBody(req, HandoffRequestSchema), mediaAccess(req)]);
  return Response.json(forMediaAccess(access, await handoff(opportunityId, scoreplayAssetId)));
});
