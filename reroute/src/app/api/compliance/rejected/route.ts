import { connection } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseInput, route } from "@/lib/server/http";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().min(1).optional(),
});

/** GET /api/compliance/rejected — L1 reject triage queue (Supabase mirror). */
export const GET = route(async (req: Request) => {
  await connection();
  if (!supabaseConfigured()) {
    throw new AppError("NOT_CONFIGURED", "SUPABASE_URL + SUPABASE_SECRET_KEY required");
  }
  const params = new URL(req.url).searchParams;
  const { limit, status } = parseInput(QuerySchema, {
    limit: params.get("limit") ?? undefined,
    status: params.get("status") ?? undefined,
  });

  let q = getSupabaseAdmin()
    .from("compliance_rejected")
    .select(
      "media_id,company_id,title,media_type,verdict,reason_codes,reason_summary,triage_status,triage_notes,latest_decision_id,first_rejected_at,last_rejected_at,policy_pack_id,policy_version,reviewed_by,reviewed_at,synced_at",
    )
    .order("last_rejected_at", { ascending: false })
    .limit(limit);
  if (status) q = q.eq("triage_status", status);

  const { data, error } = await q;
  if (error) throw new AppError("UPSTREAM", error.message);
  return Response.json({ rejected: data ?? [], count: data?.length ?? 0 });
});
