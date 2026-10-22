import type { ScorePlayWebhookEvent } from "@/lib/scoreplay/webhook";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

export type WebhookPersistInput = {
  eventId: string;
  event: ScorePlayWebhookEvent;
  mediaId?: string;
  companyId?: string;
  mediaTitle?: string;
  mediaType?: string;
  cdnUrl?: string;
  thumbnailUrl?: string;
  mediaStatus?: string;
  payload: unknown;
  headers?: Record<string, string>;
  mediaSnapshot?: unknown;
  receivedAt: string;
  duplicate: boolean;
};

export type WebhookPersistResult = {
  wrote: boolean;
  reason?: string;
  eventRowId?: string;
};

/**
 * Persist webhook → scoreplay_webhook_events + upsert scoreplay_inbound_media.
 * No-op with wrote:false when Supabase env is missing (local file store still works).
 */
export async function persistWebhookToSupabase(
  input: WebhookPersistInput,
): Promise<WebhookPersistResult> {
  if (!supabaseConfigured()) {
    return { wrote: false, reason: "supabase_not_configured" };
  }

  const sb = getSupabaseAdmin();

  const { data: eventRow, error: eventErr } = await sb
    .from("scoreplay_webhook_events")
    .upsert(
      {
        event_id: input.eventId,
        event: input.event,
        media_id: input.mediaId ?? null,
        company_id: input.companyId ?? null,
        media_title: input.mediaTitle ?? null,
        media_type: input.mediaType ?? null,
        cdn_url: input.cdnUrl ?? null,
        thumbnail_url: input.thumbnailUrl ?? null,
        media_status: input.mediaStatus ?? null,
        payload: input.payload ?? {},
        headers: input.headers ?? null,
        media_snapshot: input.mediaSnapshot ?? null,
        duplicate: input.duplicate,
        received_at: input.receivedAt,
      },
      { onConflict: "event_id", ignoreDuplicates: false },
    )
    .select("id")
    .maybeSingle();

  if (eventErr) {
    console.error("[supabase webhook]", eventErr.message);
    return { wrote: false, reason: eventErr.message };
  }

  if (input.mediaId) {
    const { data: existing } = await sb
      .from("scoreplay_inbound_media")
      .select(
        "create_count, update_count, first_seen_at, title, media_type, cdn_url, thumbnail_url, media_status, company_id, media_snapshot",
      )
      .eq("media_id", input.mediaId)
      .maybeSingle();

    const createCount =
      (existing?.create_count ?? 0) + (input.event === "media.create" && !input.duplicate ? 1 : 0);
    const updateCount =
      (existing?.update_count ?? 0) + (input.event === "media.update" && !input.duplicate ? 1 : 0);

    const { error: mediaErr } = await sb.from("scoreplay_inbound_media").upsert(
      {
        media_id: input.mediaId,
        company_id: input.companyId ?? existing?.company_id ?? null,
        title: input.mediaTitle ?? existing?.title ?? null,
        media_type: input.mediaType ?? existing?.media_type ?? null,
        cdn_url: input.cdnUrl ?? existing?.cdn_url ?? null,
        thumbnail_url: input.thumbnailUrl ?? existing?.thumbnail_url ?? null,
        media_status: input.mediaStatus ?? existing?.media_status ?? null,
        last_event: input.event,
        last_event_id: input.eventId,
        last_payload: input.payload ?? {},
        media_snapshot: input.mediaSnapshot ?? existing?.media_snapshot ?? null,
        first_seen_at: existing?.first_seen_at ?? input.receivedAt,
        last_seen_at: input.receivedAt,
        create_count: createCount,
        update_count: updateCount,
      },
      { onConflict: "media_id" },
    );

    if (mediaErr) {
      console.error("[supabase inbound_media]", mediaErr.message);
      return { wrote: false, reason: mediaErr.message, eventRowId: eventRow?.id };
    }
  }

  return { wrote: true, eventRowId: eventRow?.id };
}
