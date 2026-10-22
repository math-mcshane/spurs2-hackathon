/**
 * ScorePlay Connect webhook helpers.
 *
 * Docs name events `media.create` / `media.update` (not `media.created`).
 * @see https://developer.scoreplay.io/docs/webhooks/events
 * @see OpenAPI note near getUserPublic: subscribe to media.create, then GET /media/{id}.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";

export const SCOREPLAY_WEBHOOK_EVENTS = ["media.create", "media.update"] as const;
export type ScorePlayWebhookEvent = (typeof SCOREPLAY_WEBHOOK_EVENTS)[number];

/** Loose envelope — ScorePlay payload shapes vary; we keep the raw body and pull media id. */
export const ScorePlayWebhookBodySchema = z.looseObject({
  event: z.string().nullish(),
  event_type: z.string().nullish(),
  event_id: z.string().nullish(),
  type: z.string().nullish(),
  id: z.union([z.string(), z.number()]).nullish(),
  media_id: z.union([z.string(), z.number()]).nullish(),
  mediaId: z.union([z.string(), z.number()]).nullish(),
  company_id: z.union([z.string(), z.number()]).nullish(),
  occurred_at: z.string().nullish(),
  created_at: z.string().nullish(),
  media: z.looseObject({ ID: z.number().int().nullish(), id: z.union([z.string(), z.number()]).nullish() }).nullish(),
  data: z.looseObject({
    ID: z.number().int().nullish(),
    id: z.union([z.string(), z.number()]).nullish(),
    media_id: z.union([z.string(), z.number()]).nullish(),
  }).nullish(),
});
export type ScorePlayWebhookBody = z.infer<typeof ScorePlayWebhookBodySchema>;

export function routeEventForPath(kind: "media-create" | "media-update"): ScorePlayWebhookEvent {
  return kind === "media-create" ? "media.create" : "media.update";
}

function asId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return undefined;
}

/** Best-effort media id extraction from common ScorePlay webhook shapes. */
export function extractMediaId(body: unknown): string | undefined {
  const parsed = ScorePlayWebhookBodySchema.safeParse(body);
  if (!parsed.success) return undefined;
  const b = parsed.data;
  return (
    asId(b.media_id) ??
    asId(b.mediaId) ??
    asId(b.media?.ID) ??
    asId(b.media?.id) ??
    asId(b.data?.media_id) ??
    asId(b.data?.ID) ??
    asId(b.data?.id) ??
    asId(b.id)
  );
}

export function extractDeclaredEvent(body: unknown): string | undefined {
  const parsed = ScorePlayWebhookBodySchema.safeParse(body);
  if (!parsed.success) return undefined;
  const b = parsed.data;
  const raw = b.event ?? b.event_type ?? b.type;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function eventIdFor(body: unknown, rawText: string, expected: ScorePlayWebhookEvent): string {
  const parsed = ScorePlayWebhookBodySchema.safeParse(body);
  const candidate = parsed.success ? parsed.data.event_id?.trim() : undefined;
  if (candidate) return candidate;
  const mediaId = extractMediaId(body) ?? "unknown";
  const digest = createHash("sha256").update(`${expected}\0${mediaId}\0${rawText}`).digest("hex").slice(0, 32);
  return `${expected}:${mediaId}:${digest}`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * ScorePlay webhooks support Bearer, Basic, or none.
 * When `SCOREPLAY_WEBHOOK_SECRET` is set, require Bearer or `X-ScorePlay-Webhook-Secret`.
 * When unset, accept (hackathon bootstrap) and log a warning from the route.
 */
export function assertWebhookAuthorized(req: Request): { mode: "secret" | "open" } {
  const secret = process.env.SCOREPLAY_WEBHOOK_SECRET?.trim();
  if (!secret) return { mode: "open" };

  const headerSecret = req.headers.get("x-scoreplay-webhook-secret")?.trim();
  if (headerSecret && safeEqual(headerSecret, secret)) return { mode: "secret" };

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token && safeEqual(token, secret)) return { mode: "secret" };
  }
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice("Basic ".length).trim(), "base64").toString("utf8");
      const password = decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : decoded;
      if (password && safeEqual(password, secret)) return { mode: "secret" };
    } catch {
      /* fall through */
    }
  }

  throw new AppError("FORBIDDEN", "Invalid or missing ScorePlay webhook secret");
}
