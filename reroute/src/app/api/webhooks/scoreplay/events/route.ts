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
 * GET /api/webhooks/scoreplay/events — list raw ScorePlay webhook landings
 * (scoreplay_webhook_events). Requires Supabase env.
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
    .from("scoreplay_webhook_events")
    .select("event_id,event,media_id,company_id,received_at,duplicate")
    .order("received_at", { ascending: false })
    .limit(limit);
  if (mediaId) q = q.eq("media_id", mediaId);

  const { data, error } = await q;
  if (error) throw new AppError("UPSTREAM", error.message);
  return Response.json({ events: data ?? [], count: data?.length ?? 0 });
});
