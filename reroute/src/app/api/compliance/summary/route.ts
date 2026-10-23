import { connection } from "next/server";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/server/http";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

/** GET /api/compliance/summary — mirrored UC gold.compliance_summary buckets. */
export const GET = route(async () => {
  await connection();
  if (!supabaseConfigured()) {
    throw new AppError("NOT_CONFIGURED", "SUPABASE_URL + SUPABASE_SECRET_KEY required");
  }
  const { data, error } = await getSupabaseAdmin()
    .from("compliance_summary")
    .select("bucket,n_artifacts,as_of,synced_at")
    .order("bucket");
  if (error) throw new AppError("UPSTREAM", error.message);
  return Response.json({ buckets: data ?? [], count: data?.length ?? 0 });
});
