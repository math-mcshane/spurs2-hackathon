import { pulseRoute } from "@/features/pulse/server/http";
import { handoff } from "@/features/pulse/server/service";
import { HandoffRequestSchema } from "@/features/pulse/types";
import { parseBody } from "@/lib/server/http";

/** POST /api/pulse/handoff — send one candidate through REROUTE's decision; returns the REROUTE deep link. */
export const POST = pulseRoute(async (req) => {
  const { opportunityId, scoreplayAssetId } = await parseBody(req, HandoffRequestSchema);
  return Response.json(await handoff(opportunityId, scoreplayAssetId));
});
