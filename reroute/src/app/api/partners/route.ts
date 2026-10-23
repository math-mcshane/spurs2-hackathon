import { connection } from "next/server";
import { z } from "zod";
import { ClubCodeSchema } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { parseInput, route } from "@/lib/server/http";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

const QuerySchema = z.object({
  club: ClubCodeSchema.optional(),
});

/**
 * GET /api/partners?club=SAS|TOT — CDM partners + partnership_agreements (DEMO seed).
 */
export const GET = route(async (req: Request) => {
  await connection();
  if (!supabaseConfigured()) {
    throw new AppError("NOT_CONFIGURED", "SUPABASE_URL + SUPABASE_SECRET_KEY required");
  }
  const params = new URL(req.url).searchParams;
  const { club } = parseInput(QuerySchema, { club: params.get("club") ?? undefined });

  const sb = getSupabaseAdmin();
  const { data: partners, error: pErr } = await sb
    .from("partners")
    .select("id,brand_slug,display_name,scoreplay_sponsor_label,demo,created_at")
    .order("display_name");
  if (pErr) throw new AppError("UPSTREAM", pErr.message);

  let aq = sb
    .from("partnership_agreements")
    .select(
      "id,partner_id,club_code,usage_allowed,territories,platforms,window_start,window_end,exclusivity_notes,demo,created_at",
    )
    .order("club_code");
  if (club) aq = aq.eq("club_code", club);
  const { data: agreements, error: aErr } = await aq;
  if (aErr) throw new AppError("UPSTREAM", aErr.message);

  return Response.json({
    partners: partners ?? [],
    agreements: agreements ?? [],
    demoDisclaimer: "DEMO / FICTIONAL partnership rows — not real Spurs, Tottenham, or Nike contracts.",
  });
});
