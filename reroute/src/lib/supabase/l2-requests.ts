import { randomUUID } from "node:crypto";
import type { EditPlan, PublishIntent, Verdict } from "@/lib/contracts";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

export type LakeDecideBadge = {
  status: "pending" | "synced" | "unavailable";
  mediaIds: string[];
  requestIds: string[];
  passports: { mediaId: string; verdict?: Verdict }[];
};

/**
 * Fire-and-forget: stage L2 requests for each media in the edit.
 * Does not block decide; pipeline pulls queued rows into gold.l2_requests.
 */
export async function enqueueL2FromDecide(input: {
  edit: EditPlan;
  intent: PublishIntent;
  appVerdict: Verdict;
  receiptId?: string;
}): Promise<LakeDecideBadge> {
  if (!supabaseConfigured()) {
    return { status: "unavailable", mediaIds: [], requestIds: [], passports: [] };
  }

  const mediaIds = [...new Set(input.edit.segments.map((s) => s.scoreplayMediaId))];
  const sb = getSupabaseAdmin();
  const requestIds: string[] = [];
  const requestedAt = new Date().toISOString();

  for (const mediaId of mediaIds) {
    // Dedupe: intent dial re-decides often — reuse an open Studio request if present.
    const { data: existing } = await sb
      .from("l2_requests")
      .select("request_id")
      .eq("media_id", mediaId)
      .in("status", ["queued", "synced", "running"])
      .order("requested_at", { ascending: false })
      .limit(1);
    if (existing?.[0]?.request_id) {
      requestIds.push(existing[0].request_id as string);
      continue;
    }

    const requestId = randomUUID();
    const { error } = await sb.from("l2_requests").insert({
      request_id: requestId,
      media_id: mediaId,
      requested_at: requestedAt,
      channel: input.intent.platform,
      territory: input.intent.territory,
      intent_json: {
        source: "studio_decide",
        intent: input.intent,
        editId: input.edit.id,
        appVerdict: input.appVerdict,
      },
      status: "queued",
      app_verdict: input.appVerdict,
      receipt_id: input.receiptId ?? null,
      source: "studio_decide",
    });
    if (!error) requestIds.push(requestId);
    else console.warn("[l2_requests] enqueue failed", mediaId, error.message);
  }

  // Secondary badge: any already-synced passport for these media
  const { data: passports } = await sb
    .from("media_passports")
    .select("media_id,verdict")
    .in("media_id", mediaIds);

  const passportRows = (passports ?? []).map((p) => ({
    mediaId: p.media_id as string,
    verdict: p.verdict as Verdict | undefined,
  }));

  return {
    status: passportRows.length > 0 ? "synced" : "pending",
    mediaIds,
    requestIds,
    passports: passportRows,
  };
}
