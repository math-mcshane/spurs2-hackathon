import { DecideRequestSchema } from "@/lib/contracts";
import { decideEdit } from "@/lib/server/decide";
import { parseBody, route } from "@/lib/server/http";
import { enqueueL2FromDecide, type LakeDecideBadge } from "@/lib/supabase/l2-requests";

/**
 * POST /api/decide — deterministic verdict for an edit + intent; policy selected per asset + intent.
 * Also stages gold.l2_requests via Supabase (async lake path); the lake badge is secondary and never gates the verdict.
 */
export const POST = route(async (req: Request) => {
  const { edit, intent } = await parseBody(req, DecideRequestSchema);
  const result = await decideEdit(edit, intent);
  const lake = await enqueueL2FromDecide({ edit, intent, appVerdict: result.decision.verdict }).catch(
    (): LakeDecideBadge => ({ status: "unavailable", mediaIds: [], requestIds: [], passports: [] }),
  );
  return Response.json({ ...result, lake });
});
