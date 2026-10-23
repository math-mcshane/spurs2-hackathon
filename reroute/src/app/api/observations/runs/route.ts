import { connection } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseInput, route } from "@/lib/server/http";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  mediaId: z.string().min(1).optional(),
});

/**
 * GET /api/observations/runs — list enrich/analyze audit rows (observation_runs).
 */
export const GET = route(async (req: Request) => {
  await connection();
  if (!supabaseConfigured()) {
    throw new AppError("NOT_CONFIGURED", "SUPABASE_URL + SUPABASE_SECRET_KEY required");
  }
  const params = new URL(req.url).searchParams;
  const { limit, mediaId } = parseInput(QuerySchema, {
    limit: params.get("limit") ?? undefined,
    mediaId: params.get("mediaId") ?? undefined,
  });

  let q = getSupabaseAdmin()
    .from("observation_runs")
    .select(
      "id,scoreplay_media_id,provider,model_name,tl_asset_id,tl_index_id,status,cached,error,observation_count,job_run_id,started_at,finished_at",
    )
    .order("finished_at", { ascending: false })
    .limit(limit);
  if (mediaId) q = q.eq("scoreplay_media_id", mediaId);

  const { data, error } = await q;
  if (error) throw new AppError("UPSTREAM", error.message);
  return Response.json({ runs: data ?? [], count: data?.length ?? 0 });
});
