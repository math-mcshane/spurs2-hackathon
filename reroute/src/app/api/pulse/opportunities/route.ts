import { pulseRoute } from "@/features/pulse/server/http";
import { act, draftCampaign, getOpportunity, listOpportunities } from "@/features/pulse/server/service";
import { ActionRequestSchema } from "@/features/pulse/types";
import { parseBody } from "@/lib/server/http";

/** GET /api/pulse/opportunities[?id=] — ranked opportunities with provenance (or one, with its brief and campaign draft). */
export const GET = pulseRoute(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  return Response.json(id ? await getOpportunity(id) : await listOpportunities());
});

/** POST /api/pulse/opportunities — producer action: draftCampaign | recheck | approve | publish | dismiss | restore. */
export const POST = pulseRoute(async (req) => {
  const body = await parseBody(req, ActionRequestSchema);
  if (body.action === "draftCampaign") return Response.json(await draftCampaign(body));
  return Response.json({ opportunity: await act(body) });
});
