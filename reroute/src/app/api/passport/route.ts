import { connection } from "next/server";
import { z } from "zod";
import { PassportResponseSchema } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { parseInput, route } from "@/lib/server/http";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

const QuerySchema = z.object({
  mediaId: z.string().min(1),
});

const DEMO =
  "SAMPLE RULES — not actual NBA, Premier League, club, broadcaster or sponsor terms; not legal advice. Verdicts are recommendations a person confirms.";

/** GET /api/passport?mediaId= — Rights Passport grid from Supabase mirror. */
export const GET = route(async (req: Request) => {
  await connection();
  if (!supabaseConfigured()) {
    throw new AppError("NOT_CONFIGURED", "SUPABASE_URL + SUPABASE_SECRET_KEY required");
  }
  const { mediaId } = parseInput(QuerySchema, {
    mediaId: new URL(req.url).searchParams.get("mediaId") ?? undefined,
  });

  const { data, error } = await getSupabaseAdmin()
    .from("media_passports")
    .select(
      "media_id,decision_id,verdict,policy_pack_id,policy_version,passport_json,rules_fired,usable_until,decided_at",
    )
    .eq("media_id", mediaId)
    .maybeSingle();

  if (error) throw new AppError("UPSTREAM", error.message);
  if (!data) {
    return Response.json(
      PassportResponseSchema.parse({
        mediaId,
        verdict: "NEEDS_REVIEW",
        rulesFired: [],
        cells: {},
        demoDisclaimer: DEMO,
        source: "missing",
      }),
    );
  }

  const pj = data.passport_json as { cells?: unknown; demo_disclaimer?: string } | null;
  return Response.json(
    PassportResponseSchema.parse({
      mediaId: data.media_id,
      verdict: data.verdict,
      policyPackId: data.policy_pack_id ?? undefined,
      policyVersion: data.policy_version ?? undefined,
      usableUntil: data.usable_until ?? undefined,
      rulesFired: data.rules_fired ?? [],
      cells: pj?.cells ?? {},
      demoDisclaimer: pj?.demo_disclaimer || DEMO,
      decidedAt: data.decided_at ?? undefined,
      source: "supabase",
    }),
  );
});
