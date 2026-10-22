import { connection } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseInput, route } from "@/lib/server/http";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/webhooks/scoreplay/inbound — list files seen via ScorePlay webhooks
 * (scoreplay_inbound_media). Requires Supabase env.
 */
export const GET = route(async (req: Request) => {
  await connection();
  if (!supabaseConfigured()) {
    throw new AppError("NOT_CONFIGURED", "SUPABASE_URL + SUPABASE_SECRET_KEY required");
  }
  const params = new URL(req.url).searchParams;
  const { limit } = parseInput(QuerySchema, { limit: params.get("limit") ?? undefined });

  const { data, error } = await getSupabaseAdmin()
    .from("scoreplay_inbound_media")
    .select(
      "media_id, company_id, title, media_type, cdn_url, thumbnail_url, last_event, first_seen_at, last_seen_at, create_count, update_count",
    )
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (error) throw new AppError("UPSTREAM", error.message);
  return Response.json({ media: data ?? [], count: data?.length ?? 0 });
});
