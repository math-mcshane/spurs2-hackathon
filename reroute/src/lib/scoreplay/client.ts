/**
 * Server-only ScorePlay Media API client. Every route is cited in ./API_NOTES.md
 * (source: https://developer.scoreplay.io/downloads/scoreplay.yaml).
 * Auth: `X-ScorePlay-Api-Key` header. Base URL: `https://media.scoreplay.io/v1` (OpenAPI `servers`).
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { z } from "zod";
import type { Asset, RightsReceipt, ScorePlayClient } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { mapMediaToAsset } from "./map";
import {
  DeleteVideoLogsResultSchema,
  MediaSchema,
  MediaSearchResultSchema,
  TagFilterListSchema,
  TagOptionListSchema,
  TagOptionSchema,
  TagSearchResultSchema,
  UploadInitSchema,
  VideoLogListSchema,
  WhoamiSchema,
  type ScorePlayMedia,
  type ScorePlayTagFilter,
  type ScorePlayVideoLog,
  type ScorePlayWhoami,
} from "./schemas";
import { SCOREPLAY_TAXONOMY, managedTagNames } from "./taxonomy";
import { desiredTagNames, planActions, receiptMarker, writebackTargets, type MediaReadBack, type PlannedAction } from "./writeback";

if (typeof window !== "undefined") throw new Error("src/lib/scoreplay is server-only");

export const SCOREPLAY_DEFAULT_BASE_URL = "https://media.scoreplay.io/v1";
const REQUEST_TIMEOUT_MS = 15_000;
const UPLOAD_PART_TIMEOUT_MS = 120_000;
/** S3 multipart parts must be ≥ 5 MiB except the last; ScorePlay returns one pre-signed URL per part. */
const UPLOAD_PART_BYTES = 16 * 1024 * 1024;
const TAG_FILTER_TTL_MS = 5 * 60_000;
/** `GET /tag/search` rejects queries longer than 60 characters (documented). */
const TAG_SEARCH_MAX_CHARS = 60;

type Query = Record<string, string | number | boolean | undefined>;
type RequestOptions = { query?: Query; body?: unknown };

let tagFilterCache: { at: number; filters: ScorePlayTagFilter[] } | undefined;

export class ScorePlayHttpClient implements ScorePlayClient {
  // ---------- ScorePlayClient ----------

  async searchAssets(query: string, limit = 20): Promise<Asset[]> {
    const q = query.trim();
    const body: Record<string, unknown> = {};
    if (q) {
      // Docs pattern: resolve labels → IDs with GET /tag/search, then POST /media/search with those IDs.
      const found = await this.request("GET", "/tag/search", TagSearchResultSchema, {
        query: { query: q.slice(0, TAG_SEARCH_MAX_CHARS) },
      });
      const ids = (list: { ID: number }[] | null | undefined) => (list ?? []).map((x) => x.ID);
      Object.assign(body, {
        name: q,
        description: q,
        smart_filter: true, // OR across tag filters / name / description, scored
        order_by: "relevance",
      });
      if (found.tags?.length) body.any_tag_options = ids(found.tags);
      if (found.players?.length) body.any_players = ids(found.players);
      if (found.sponsors?.length) body.any_sponsors = ids(found.sponsors);
    }
    const result = await this.request("POST", "/media/search", MediaSearchResultSchema, {
      query: { page: 1, per_page: limit },
      body,
    });
    const filters = await this.tagFilters();
    return (result.media ?? []).slice(0, limit).map((m) => mapMediaToAsset(m, filters));
  }

  async getAsset(id: string): Promise<Asset> {
    const [media, filters] = await Promise.all([this.getMedia(id), this.tagFilters()]);
    return mapMediaToAsset(media, filters);
  }

  /**
   * Writes verdict tags + timecoded video logs per SCOREPLAY_TAXONOMY to every target, then re-reads.
   * Returns `Record<mediaId, MediaReadBack>`. Throws only NOT_CONFIGURED; per-media upstream errors → FAILED.
   */
  async writeDecision(receipt: RightsReceipt): Promise<Record<string, MediaReadBack>> {
    let tagIds: Promise<Map<string, number>> | undefined;
    const out: Record<string, MediaReadBack> = {};
    for (const mediaId of writebackTargets(receipt)) {
      try {
        tagIds ??= this.ensureTagOptions(desiredTagNames(receipt));
        out[mediaId] = await this.writeOne(mediaId, receipt, await tagIds);
      } catch (err) {
        if (err instanceof AppError && err.code === "NOT_CONFIGURED") throw err;
        out[mediaId] = {
          status: "FAILED",
          at: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
          tags: [],
          actions: [],
        };
      }
    }
    return out;
  }

  /** Uploads a rendered derivative as its OWN media (multipart, documented 3-step flow). */
  async uploadDerivative(file: { path: string; title: string }, receipt: RightsReceipt): Promise<{ id: string }> {
    if (process.env.SCOREPLAY_UPLOAD_APPROVED !== "true") {
      throw new AppError("NOT_CONFIGURED", "Derivative upload disabled: set SCOREPLAY_UPLOAD_APPROVED=true only after ScorePlay staff confirm permission");
    }
    const sourceId = receipt.sourceAssetIds[0];
    if (!sourceId) throw new AppError("BAD_REQUEST", "Receipt has no source asset to file the derivative under");
    const source = await this.getMedia(sourceId);
    const eventId = source.event_id || source.event?.ID;
    if (!eventId) {
      throw new AppError("NOT_CONFIGURED", `Source media ${sourceId} has no event; ScorePlay uploads go into an event (POST /upload/event/{id}) — ask ScorePlay staff which event to use`);
    }

    const bytes = await readFile(file.path);
    const parts = Math.max(1, Math.ceil(bytes.byteLength / UPLOAD_PART_BYTES));
    const ext = extname(file.path);
    const name = extname(file.title) ? file.title : `${file.title}${ext}`;
    const d = receipt.decision;
    const init = await this.request("POST", `/upload/event/${eventId}`, UploadInitSchema, {
      query: { parts },
      body: {
        name,
        description: [
          `REROUTE derivative of ${receipt.sourceAssetIds.join(", ")}`,
          `receipt ${receipt.id}`,
          `edit ${receipt.edit.id}`,
          `review PENDING — distinct asset, needs its own decision`,
          d.policyFictional ? SCOREPLAY_TAXONOMY.fictionalBanner : undefined,
        ]
          .filter(Boolean)
          .join(" | "),
        raw_tags: [SCOREPLAY_TAXONOMY.derivativeTag, SCOREPLAY_TAXONOMY.reviewTags.PENDING],
      },
    });

    try {
      const uploaded: { parts_number: number; etag: string }[] = [];
      for (const part of [...init.urls].sort((a, b) => a.parts_number - b.parts_number)) {
        const chunk = bytes.subarray((part.parts_number - 1) * UPLOAD_PART_BYTES, part.parts_number * UPLOAD_PART_BYTES);
        const res = await fetchWithTimeout(part.url, { method: "PUT", body: chunk }, UPLOAD_PART_TIMEOUT_MS, "upload part");
        const etag = res.headers.get("etag");
        if (!res.ok || !etag) throw new AppError("UPSTREAM", `Upload part ${part.parts_number} failed (HTTP ${res.status}${etag ? "" : ", no ETag"})`);
        uploaded.push({ parts_number: part.parts_number, etag });
      }
      await this.request("POST", `/upload/complete/${init.media_id}`, MediaSchema, {
        body: { key: init.key, upload_id: init.upload_id, parts_number: uploaded.length, parts: uploaded },
      });
    } catch (err) {
      await this.request("POST", "/upload/abort", undefined, { body: { key: init.key, upload_id: init.upload_id } }).catch(() => undefined);
      throw err;
    }
    return { id: String(init.media_id) };
  }

  // ---------- Raw reads (also used by scripts/scoreplay-smoke.ts) ----------

  whoami(): Promise<ScorePlayWhoami> {
    return this.request("GET", "/whoami", WhoamiSchema);
  }

  getMedia(id: string): Promise<ScorePlayMedia> {
    return this.request("GET", `/media/${mediaIdPath(id)}`, MediaSchema);
  }

  /** All video logs of a media (paged, max 200 per page). Times are normalised to seconds. */
  async listVideoLogs(id: string): Promise<ScorePlayVideoLog[]> {
    const all: ScorePlayVideoLog[] = [];
    for (let page = 1; ; page++) {
      const res = await this.request("GET", `/media/${mediaIdPath(id)}/logs`, VideoLogListSchema, { query: { page, limit: 200 } });
      const items = res.items ?? [];
      all.push(...items);
      if (items.length < 200 || (res.total ?? 0) <= all.length) return all;
    }
  }

  // ---------- Internals ----------

  private async tagFilters(): Promise<ScorePlayTagFilter[]> {
    if (tagFilterCache && Date.now() - tagFilterCache.at < TAG_FILTER_TTL_MS) return tagFilterCache.filters;
    const filters: ScorePlayTagFilter[] = [];
    for (let page = 1; ; page++) {
      const res = await this.request("GET", "/tag/filters", TagFilterListSchema, { query: { page, limit: 250 } });
      const items = res.items ?? [];
      filters.push(...items);
      if (items.length < 250 || (res.total ?? 0) <= filters.length) break;
    }
    tagFilterCache = { at: Date.now(), filters };
    return filters;
  }

  /** name → tag option ID, creating missing REROUTE tag options (`POST /tag/options`). */
  private async ensureTagOptions(names: string[]): Promise<Map<string, number>> {
    const resolved = new Map<string, number>();
    await Promise.all(
      names.map(async (name) => {
        const list = await this.request("GET", "/tag/options", TagOptionListSchema, { query: { query: name } });
        const existing = list.find((o) => o.name?.toLowerCase() === name.toLowerCase());
        const option =
          existing ??
          (await this.request("POST", "/tag/options", TagOptionSchema, {
            body: { name, label: name, type: SCOREPLAY_TAXONOMY.tagOptionType },
          }));
        resolved.set(name, option.ID);
      }),
    );
    return resolved;
  }

  private async writeOne(mediaId: string, receipt: RightsReceipt, tagIds: Map<string, number>): Promise<MediaReadBack> {
    const media = await this.getMedia(mediaId);
    const desired = desiredTagNames(receipt);
    const desiredIds = new Set(desired.map((n) => tagIds.get(n)!));
    const managed = new Set(managedTagNames());
    const present = (media.tags ?? []).filter((t) => t.tag_option_id);
    const presentIds = new Set([...present.map((t) => t.tag_option_id!), ...(media.tag_option_ids ?? [])]);

    // 1. Tags: remove stale REROUTE tags (e.g. previous verdict), add missing ones. Never touches other tags.
    const stale = [
      ...new Set(
        present
          .filter((t) => managed.has((t.tag_option?.name ?? t.name ?? "").toLowerCase()) && !desiredIds.has(t.tag_option_id!))
          .map((t) => t.tag_option_id!),
      ),
    ];
    if (stale.length) await this.request("DELETE", `/media/${mediaIdPath(mediaId)}/tags`, undefined, { body: { tag_option_ids: stale } });
    const missing = [...desiredIds].filter((tid) => !presentIds.has(tid));
    if (missing.length) await this.request("POST", `/media/${mediaIdPath(mediaId)}/tags`, undefined, { body: { tag_option_ids: missing } });

    // 2. Timecoded video logs (videos only): replace this receipt's logs unless already identical.
    const isVideo = media.type === "video";
    const planned = isVideo ? planActions(receipt, mediaId) : [];
    const marker = receiptMarker(receipt.id);
    if (isVideo) {
      const mine = (await this.listVideoLogs(mediaId)).filter((l) => l.comment?.startsWith(marker));
      if (!sameActions(mine, planned)) {
        if (mine.length) {
          await this.request("DELETE", `/media/${mediaIdPath(mediaId)}/logs`, DeleteVideoLogsResultSchema, {
            body: { log_ids: mine.map((l) => l.id) },
          });
        }
        if (media.company_id == null) throw new AppError("UPSTREAM", `Media ${mediaId} has no company_id; POST /video/logs requires it`);
        await this.request("POST", "/video/logs", undefined, {
          body: {
            company_id: media.company_id,
            video_logs: planned.map((a) => ({
              media_id: media.ID,
              log: {
                ...(a.end === undefined ? { offset: a.start } : { start_offset: a.start, end_offset: a.end }),
                comment: a.comment,
                raw_tags: a.rawTags,
              },
            })),
          },
        });
      }
    }

    // 3. Re-read to prove persistence (spec §11).
    const reread = await this.getMedia(mediaId);
    const rereadTags = (reread.tags ?? []).filter((t) => t.tag_option_id);
    const rereadIds = new Set([...rereadTags.map((t) => t.tag_option_id!), ...(reread.tag_option_ids ?? [])]);
    const tagNames = [
      ...new Set(
        rereadTags
          .map((t) => (t.tag_option?.name ?? t.name ?? "").toLowerCase())
          .filter((n) => managed.has(n)),
      ),
    ];
    const logs = isVideo ? (await this.listVideoLogs(mediaId)).filter((l) => l.comment?.startsWith(marker)) : [];
    const actions = logs.map(logToAction);

    const problems: string[] = [];
    const missingAfter = desired.filter((n) => !rereadIds.has(tagIds.get(n)!));
    if (missingAfter.length) problems.push(`tags not visible on re-read: ${missingAfter.join(", ")}`);
    const staleAfter = stale.filter((tid) => rereadIds.has(tid));
    if (staleAfter.length) problems.push(`stale REROUTE tag ids still present: ${staleAfter.join(", ")}`);
    if (isVideo && !sameActions(logs, planned)) problems.push(`expected ${planned.length} video log(s) for this receipt, re-read found ${logs.length}`);
    const note = isVideo ? undefined : `media type "${reread.type ?? "unknown"}" is not a video: tags only, no timecoded logs`;

    return {
      status: problems.length === 0 ? "VERIFIED" : "WRITTEN",
      at: new Date().toISOString(),
      detail: [...problems, note].filter(Boolean).join("; ") || undefined,
      verdictTag: SCOREPLAY_TAXONOMY.verdictTags[receipt.decision.verdict],
      tags: tagNames,
      actions,
    };
  }

  private async request<S extends z.ZodType | undefined>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    schema: S,
    opts: RequestOptions = {},
  ): Promise<S extends z.ZodType ? z.output<S> : unknown> {
    const { apiKey, baseUrl } = readConfig();
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    const res = await fetchWithTimeout(
      url,
      {
        method,
        headers: {
          "X-ScorePlay-Api-Key": apiKey,
          Accept: "application/json",
          ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: "no-store",
      },
      REQUEST_TIMEOUT_MS,
      `${method} ${path}`,
    );

    const text = await res.text();
    if (!res.ok) {
      const upstream = text.slice(0, 300);
      if (res.status === 404) throw new AppError("NOT_FOUND", `ScorePlay ${method} ${path}: not found (${upstream})`);
      const hint = res.status === 401 ? " — invalid API key or missing permission (writes need can_do_media_edit)" : "";
      throw new AppError("UPSTREAM", `ScorePlay ${method} ${path} → HTTP ${res.status}${hint}: ${upstream}`);
    }
    if (!schema) return undefined as never;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      throw new AppError("UPSTREAM", `ScorePlay ${method} ${path}: non-JSON response`, { cause });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("UPSTREAM", `ScorePlay ${method} ${path}: unexpected response shape: ${parsed.error.message.slice(0, 500)}`);
    }
    return parsed.data as never;
  }
}

function readConfig(): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.SCOREPLAY_API_KEY?.trim();
  if (!apiKey) throw new AppError("NOT_CONFIGURED", "SCOREPLAY_API_KEY is not set (add it to .env.local)");
  const baseUrl = (process.env.SCOREPLAY_API_BASE_URL?.trim() || SCOREPLAY_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { apiKey, baseUrl };
}

/** ScorePlay media IDs are integers (OpenAPI); we carry them as strings. */
function mediaIdPath(id: string): string {
  if (!/^[1-9]\d*$/.test(id)) throw new AppError("BAD_REQUEST", `Invalid ScorePlay media id "${id}" (expected a positive integer)`);
  return id;
}

async function fetchWithTimeout(input: string | URL, init: RequestInit, timeoutMs: number, label: string): Promise<Response> {
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new AppError("UPSTREAM", `ScorePlay ${label}: ${timedOut ? `timed out after ${timeoutMs} ms` : "network error"}`, { cause });
  }
}

/** Video-log read-back → seconds. `timestamp` is seconds; `start/end_timestamp` are milliseconds (documented). */
function logToAction(l: ScorePlayVideoLog): MediaReadBack["actions"][number] {
  const ranged = (l.end_timestamp ?? 0) > 0;
  return {
    id: l.id,
    start: ranged ? (l.start_timestamp ?? 0) / 1000 : (l.timestamp ?? undefined),
    end: ranged ? l.end_timestamp! / 1000 : undefined,
    comment: l.comment ?? "",
  };
}

/** Same comments and (to 1 s, since `timestamp` is whole seconds) same timing → nothing to rewrite. */
function sameActions(existing: ScorePlayVideoLog[], planned: PlannedAction[]): boolean {
  if (existing.length !== planned.length) return false;
  const key = (comment: string, start: number | undefined, end: number | undefined) =>
    `${comment}|${Math.floor(start ?? 0)}|${end === undefined ? "-" : Math.floor(end)}`;
  const have = existing.map((l) => {
    const a = logToAction(l);
    return key(a.comment, a.start, a.end);
  });
  const want = planned.map((p) => key(p.comment, p.start, p.end));
  return have.sort().join("\n") === want.sort().join("\n");
}
