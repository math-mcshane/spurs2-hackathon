import { connection } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseInput, route } from "@/lib/server/http";
import { loadSupabaseEvidence } from "@/lib/supabase/evidence";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

const QuerySchema = z.object({
  mediaId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/evidence?mediaId=&limit= — CDM evidence mirror (TwelveLabs observations; never permissions).
 * With mediaId: rows for that asset. Without: recent rows across media.
 */
export const GET = route(async (req: Request) => {
  await connection();
  if (!supabaseConfigured()) {
    throw new AppError("NOT_CONFIGURED", "SUPABASE_URL + SUPABASE_SECRET_KEY required");
  }
  const params = new URL(req.url).searchParams;
  const { mediaId, limit } = parseInput(QuerySchema, {
    mediaId: params.get("mediaId") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });

  if (mediaId) {
    const evidence = await loadSupabaseEvidence(mediaId);
    return Response.json({
      mediaId,
      evidence,
      count: evidence.length,
      disclaimer: "Observations ≠ permissions.",
    });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("evidence")
    .select(
      "id,observation_id,scoreplay_media_id,start_sec,end_sec,observation,source,label,confidence,origin,observed_at",
    )
    .order("observed_at", { ascending: false })
    .limit(limit);
  if (error) throw new AppError("UPSTREAM", error.message);

  return Response.json({
    evidence: data ?? [],
    count: data?.length ?? 0,
    disclaimer: "Observations ≠ permissions.",
  });
});
