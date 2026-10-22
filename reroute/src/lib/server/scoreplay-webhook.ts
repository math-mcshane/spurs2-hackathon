import { z } from "zod";
import { AppError } from "@/lib/errors";
import { getScorePlayClient } from "@/lib/scoreplay";
import {
  assertWebhookAuthorized,
  eventIdFor,
  extractDeclaredEvent,
  extractMediaId,
  routeEventForPath,
  ScorePlayWebhookBodySchema,
  type ScorePlayWebhookEvent,
} from "@/lib/scoreplay/webhook";
import { appendWebhook } from "@/lib/server/webhook-store";
import { persistWebhookToSupabase } from "@/lib/supabase/webhooks";
import { route } from "@/lib/server/http";
import type { Asset } from "@/lib/contracts";

const PUBLIC_BASE = "https://spurs2-hackathon.vercel.app";

function redactHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) {
    const key = k.toLowerCase();
    if (key === "authorization" || key === "cookie" || key.includes("secret") || key.includes("api-key")) {
      out[k] = "[redacted]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

function companyIdFrom(body: unknown): string | undefined {
  const parsed = ScorePlayWebhookBodySchema.safeParse(body);
  if (!parsed.success || parsed.data.company_id == null) return undefined;
  return String(parsed.data.company_id);
}

export function webhookConfigResponse(kind: "media-create" | "media-update") {
  const event = routeEventForPath(kind);
  const path = `/api/webhooks/scoreplay/${kind}`;
  return Response.json({
    ok: true,
    event,
    method: "POST",
    path,
    url: `${PUBLIC_BASE}${path}`,
    tables: ["scoreplay_webhook_events", "scoreplay_inbound_media"],
    auth: {
      bearer: "Authorization: Bearer <SCOREPLAY_WEBHOOK_SECRET>",
      header: "X-ScorePlay-Webhook-Secret: <SCOREPLAY_WEBHOOK_SECRET>",
      basic: "Authorization: Basic (password = SCOREPLAY_WEBHOOK_SECRET)",
    },
    note:
      "Writes every webhook to Supabase (when configured). If Vercel Deployment Protection is on, append ?x-vercel-protection-bypass=<VERCEL_AUTOMATION_BYPASS_SECRET> or exclude this path.",
  });
}

export function scoreplayWebhookPost(kind: "media-create" | "media-update") {
  const expected: ScorePlayWebhookEvent = routeEventForPath(kind);

  return route(async (req: Request) => {
    const auth = assertWebhookAuthorized(req);
    if (auth.mode === "open") {
      console.warn(
        `[scoreplay webhook] SCOREPLAY_WEBHOOK_SECRET unset — accepting ${expected} without auth (set secret for production)`,
      );
    }

    let rawText: string;
    try {
      rawText = await req.text();
    } catch {
      throw new AppError("BAD_REQUEST", "Could not read webhook body");
    }

    let body: unknown = {};
    if (rawText.trim()) {
      try {
        body = JSON.parse(rawText);
      } catch {
        throw new AppError("BAD_REQUEST", "Webhook body must be valid JSON");
      }
    }

    const soft = ScorePlayWebhookBodySchema.safeParse(body);
    if (!soft.success) {
      throw new AppError("BAD_REQUEST", z.prettifyError(soft.error));
    }

    const declared = extractDeclaredEvent(body);
    if (declared && declared !== expected) {
      console.warn(`[scoreplay webhook] expected ${expected}, payload declared ${declared}`);
    }

    const mediaId = extractMediaId(body);
    const eventId = eventIdFor(body, rawText, expected);
    const receivedAt = new Date().toISOString();
    const companyId = companyIdFrom(body);
    const headers = redactHeaders(req);

    const { stored, duplicate } = await appendWebhook({
      eventId,
      event: expected,
      ...(mediaId ? { mediaId } : {}),
      ...(companyId ? { companyId } : {}),
      receivedAt,
      payload: body,
      headers,
    });

    let asset: Asset | undefined;
    let mediaFetch: { ok: true; title?: string } | { ok: false; error: string } | null = null;
    if (mediaId && process.env.SCOREPLAY_API_KEY?.trim()) {
      try {
        asset = await getScorePlayClient().getAsset(mediaId);
        mediaFetch = { ok: true, title: asset.title };
      } catch (err) {
        mediaFetch = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const supabase = await persistWebhookToSupabase({
      eventId: stored.eventId,
      event: expected,
      mediaId: stored.mediaId,
      companyId: stored.companyId ?? companyId,
      mediaTitle: asset?.title,
      mediaType: asset?.kind,
      cdnUrl: asset?.previewUrl,
      thumbnailUrl: asset?.thumbnailUrl,
      payload: body,
      headers,
      mediaSnapshot: asset ?? undefined,
      receivedAt: stored.receivedAt,
      duplicate,
    });

    return Response.json(
      {
        ok: true,
        duplicate,
        event: expected,
        eventId: stored.eventId,
        mediaId: stored.mediaId ?? null,
        receivedAt: stored.receivedAt,
        mediaFetch,
        supabase,
      },
      { status: duplicate ? 200 : 201 },
    );
  });
}
