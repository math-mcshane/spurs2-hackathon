/**
 * Server-only ScorePlay Media API client. Every route is cited in ./API_NOTES.md
 * (source: https://developer.scoreplay.io/downloads/scoreplay.yaml).
 * Auth: `X-ScorePlay-Api-Key` header. Base URL: `https://media.scoreplay.io/v1` (OpenAPI `servers`).
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { z } from "zod";
import { DEMO_CLEARANCE_LABEL, type Asset, type RightsReceipt, type ScorePlayClient } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { mapMediaToAsset, toSquad, type ScorePlaySquad } from "./map";
import {
  DeleteVideoLogsResultSchema,
  MediaSchema,
  MediaSearchResultSchema,
  PlayerListSchema,
  TagFilterListSchema,
  TagOptionListSchema,
  TagOptionSchema,
  TagSearchResultSchema,
  TeamSeasonListSchema,
  UploadInitSchema,
  VideoLogListSchema,
  WhoamiSchema,
  type ScorePlayMedia,
  type ScorePlayTagFilter,
  type ScorePlayTagOption,
  type ScorePlayVideoLog,
  type ScorePlayTeamSeason,
  type ScorePlayWhoami,
} from "./schemas";
import { SCOREPLAY_TAXONOMY } from "./taxonomy";
import type { PlannedLog } from "./writeback";

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
let squadCache: { at: number; squads: ScorePlaySquad[] } | undefined;

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
    const [filters, squads] = await Promise.all([this.tagFilters(), this.squads()]);
    return (result.media ?? []).slice(0, limit).map((m) => mapMediaToAsset(m, filters, squads));
  }

  async getAsset(id: string): Promise<Asset> {
    const [media, filters, squads] = await Promise.all([this.getMedia(id), this.tagFilters(), this.squads()]);
    return mapMediaToAsset(media, filters, squads);
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
          d.policyFictional ? DEMO_CLEARANCE_LABEL : undefined,
        ]
          .filter(Boolean)
          .join(" | "),
        raw_tags: [SCOREPLAY_TAXONOMY.derivativeTag],
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

  /** Exact (case-insensitive) match for a tag-option name via `GET /tag/options?query=`. */
  async findTagOption(name: string): Promise<ScorePlayTagOption | undefined> {
    const list = await this.request("GET", "/tag/options", TagOptionListSchema, { query: { query: name } });
    return list.find((o) => o.name?.toLowerCase() === name.toLowerCase());
  }

  // ---------- Writes (documented; only reachable through lib/scoreplay/writeback.ts#applyWriteback) ----------

  /** `POST /tag/options` → 201 TagOption. */
  createTagOption(name: string, type: string): Promise<ScorePlayTagOption> {
    return this.request("POST", "/tag/options", TagOptionSchema, { body: { name, label: name, type } });
  }

  /** `POST /media/{id}/tags` (`UpdateMediaTagsPayload.tag_option_ids`) → 204. */
  async addMediaTags(mediaId: string, tagOptionIds: number[]): Promise<void> {
    await this.request("POST", `/media/${mediaIdPath(mediaId)}/tags`, undefined, { body: { tag_option_ids: tagOptionIds } });
  }

  /** `DELETE /media/{id}/tags` (`UpdateMediaTagsPayload.tag_option_ids`) → 204. */
  async removeMediaTags(mediaId: string, tagOptionIds: number[]): Promise<void> {
    await this.request("DELETE", `/media/${mediaIdPath(mediaId)}/tags`, undefined, { body: { tag_option_ids: tagOptionIds } });
  }

  /** `POST /video/logs` (`VideoLogPayload`, `ActionClip` offset-range mode) → 200 `true`. */
  async addVideoLogs(companyId: number, mediaId: number, logs: PlannedLog[]): Promise<void> {
    await this.request("POST", "/video/logs", undefined, {
      body: {
        company_id: companyId,
        video_logs: logs.map((l) => ({
          media_id: mediaId,
          log: { start_offset: l.start, end_offset: l.end, comment: l.comment, raw_tags: l.rawTags },
        })),
      },
    });
  }

  /** `DELETE /media/{id}/logs` `{log_ids}` → `{deleted_ids}`. */
  deleteVideoLogs(mediaId: string, logIds: number[]): Promise<z.output<typeof DeleteVideoLogsResultSchema>> {
    return this.request("DELETE", `/media/${mediaIdPath(mediaId)}/logs`, DeleteVideoLogsResultSchema, { body: { log_ids: logIds } });
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

  /** Squad registrations (`GET /team-seasons`, then `GET /players?team_season_id=` per season); same TTL as tag groups. */
  private async squads(): Promise<ScorePlaySquad[]> {
    if (squadCache && Date.now() - squadCache.at < TAG_FILTER_TTL_MS) return squadCache.squads;
    const seasons: ScorePlayTeamSeason[] = [];
    for (let page = 1; ; page++) {
      const res = await this.request("GET", "/team-seasons", TeamSeasonListSchema, { query: { page, limit: 100 } });
      const items = res.items ?? [];
      seasons.push(...items);
      if (items.length < 100 || (res.total ?? 0) <= seasons.length) break;
    }
    const squads = (
      await Promise.all(
        seasons.map(async (season) =>
          toSquad(season, await this.request("GET", "/players", PlayerListSchema, { query: { team_season_id: season.id, limit: 500 } })),
        ),
      )
    ).filter((s): s is ScorePlaySquad => s !== undefined);
    squadCache = { at: Date.now(), squads };
    return squads;
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
