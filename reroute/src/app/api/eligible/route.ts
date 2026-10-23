import { connection } from "next/server";
import { z } from "zod";
import { ClubCodeSchema } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { parseInput, route } from "@/lib/server/http";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

const QuerySchema = z.object({
  club: ClubCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * GET /api/eligible?club=SAS|TOT&limit= — CDM mirror of UC L1-pass pool (`eligible_media`).
 * Synced by Databricks `sync_eligible_supabase`. Not publish clearance.
 */
export const GET = route(async (req: Request) => {
  await connection();
  if (!supabaseConfigured()) {
    throw new AppError("NOT_CONFIGURED", "SUPABASE_URL + SUPABASE_SECRET_KEY required");
  }
  const params = new URL(req.url).searchParams;
  const { club, limit } = parseInput(QuerySchema, {
    club: params.get("club") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });

  let q = getSupabaseAdmin()
    .from("eligible_media")
    .select(
      "media_id,club_code,company_id,title,media_type,cdn_url,thumbnail_url,event_label,game_date,sponsors,brands_seen,tl_status,tl_asset_id,tl_index_id,l1_passed_at,synced_at",
    )
    .order("synced_at", { ascending: false })
    .limit(limit);
  if (club) q = q.eq("club_code", club);

  const { data, error } = await q;
  if (error) throw new AppError("UPSTREAM", error.message);

  return Response.json({
    media: data ?? [],
    count: data?.length ?? 0,
    disclaimer: "L1-pass eligible pool only — observations ≠ permissions; use /api/decide for rights.",
  });
});
