import { connection } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseInput, route } from "@/lib/server/http";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  mediaId: z.string().min(1).optional(),
});

/** GET /api/compliance/l1 — mirrored UC gold.l1_decisions. */
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
    .from("l1_decisions")
    .select(
      "decision_id,media_id,company_id,decided_at,verdict,policy_pack_id,policy_version,reason_codes,reason_summary,job_run_id,synced_at",
    )
    .order("decided_at", { ascending: false })
    .limit(limit);
  if (mediaId) q = q.eq("media_id", mediaId);

  const { data, error } = await q;
  if (error) throw new AppError("UPSTREAM", error.message);
  return Response.json({ decisions: data ?? [], count: data?.length ?? 0 });
});
