import { boardRoute } from "@/features/pulse/server/http";
import { act, draftCampaign, getOpportunity, listOpportunities } from "@/features/pulse/server/service";
import { ActionRequestSchema } from "@/features/pulse/types";
import { forMediaAccess, mediaAccess } from "@/lib/media/preview";
import { parseBody } from "@/lib/server/http";

/** GET /api/pulse/opportunities[?id=] — ranked opportunities with provenance (or one, with its brief and campaign draft).
 * Footage-derived URLs (thumbnails/previews) on every board response only for `mediaAccess(req) === "ALLOWED"`. */
export const GET = boardRoute(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  const [body, access] = await Promise.all([id ? getOpportunity(id) : listOpportunities(), mediaAccess(req)]);
  return Response.json(forMediaAccess(access, body));
});

/** POST /api/pulse/opportunities — producer action: draftCampaign | recheck | approve | publish | dismiss | restore. */
export const POST = boardRoute(async (req) => {
  const [body, access] = await Promise.all([parseBody(req, ActionRequestSchema), mediaAccess(req)]);
  if (body.action === "draftCampaign") return Response.json(forMediaAccess(access, await draftCampaign(body)));
  return Response.json(forMediaAccess(access, { opportunity: await act(body) }));
});
