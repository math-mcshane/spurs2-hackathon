import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseBody, route } from "@/lib/server/http";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

const PatchSchema = z.object({
  triage_status: z.enum([
    "new",
    "acknowledged",
    "appealed",
    "closed",
    "false_positive",
    "escalated",
  ]),
  triage_notes: z.string().max(4000).optional(),
  reviewed_by: z.string().min(1).max(200),
});

/**
 * PATCH /api/rejected/[mediaId] — update triage on Supabase mirror.
 * Sets triage_dirty so the pipeline can write back to UC gold.rejected_artifacts.
 */
export const PATCH = route(async (req: NextRequest, ctx: { params: Promise<{ mediaId: string }> }) => {
  await connection();
  if (!supabaseConfigured()) {
    throw new AppError("NOT_CONFIGURED", "SUPABASE_URL + SUPABASE_SECRET_KEY required");
  }
  const { mediaId } = await ctx.params;
  if (!mediaId?.trim()) throw new AppError("BAD_REQUEST", "mediaId required");

  const body = await parseBody(req, PatchSchema);
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("compliance_rejected")
    .update({
      triage_status: body.triage_status,
      triage_notes: body.triage_notes ?? null,
      reviewed_by: body.reviewed_by,
      reviewed_at: now,
      triage_dirty: true,
      updated_at: now,
    })
    .eq("media_id", mediaId)
    .select(
      "media_id,triage_status,triage_notes,reviewed_by,reviewed_at,triage_dirty,updated_at",
    )
    .maybeSingle();

  if (error) throw new AppError("UPSTREAM", error.message);
  if (!data) throw new AppError("NOT_FOUND", `Rejected media ${mediaId} not found`);
  return Response.json({ rejected: data });
});
