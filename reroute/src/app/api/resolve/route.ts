import { z } from "zod";
import { PublishIntentSchema, ResolveRequestSchema } from "@/lib/contracts";
import { forMediaAccess, mediaAccess } from "@/lib/media/preview";
import { parseBody, route } from "@/lib/server/http";
import { resolve } from "@/lib/server/resolver";

/** Contract request + optional `intents` (every use of the campaign; the blocker aggregates them). */
const RequestSchema = ResolveRequestSchema.extend({ intents: z.array(PublishIntentSchema).min(1).max(20).optional() });

/**
 * POST /api/resolve — blocker classification + (CLIP) Marengo alternatives, each re-checked; (CAMPAIGN) remedy.
 * Candidate `hit.thumbnailUrl` (a footage frame) only when MEDIA_PREVIEW_ENABLED=true AND a reviewer session.
 */
export const POST = route(async (req: Request) => {
  const input = await parseBody(req, RequestSchema);
  const [result, access] = await Promise.all([resolve(input), mediaAccess(req)]);
  return Response.json(forMediaAccess(access, result));
});
