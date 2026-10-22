import { z } from "zod";
import type { Asset } from "@/lib/contracts";
import { mapMediaToAsset } from "@/lib/scoreplay/map";
import { MediaSearchResultSchema, TagSearchResultSchema, type ScorePlayMedia } from "@/lib/scoreplay/schemas";
import type { MediaDiscoverySpec } from "../types";

/**
 * PULSE asset discovery on ScorePlay, following the documented "find medias" flow
 * (https://developer.scoreplay.io/tutorial/find-medias/ and the OpenAPI `searchPublicTags` /
 * `searchPublicMedia` operations):
 *   1. `GET /tag/search?query=` resolves player / tag names to IDs (query ≤ 60 chars);
 *   2. `POST /media/search` with `players` / `any_tag_options` / `name` and `media_type: "video"`,
 *      paginated with `page` + `per_page` (body never carries pagination).
 * Free-text semantics ("bench reaction after a dunk") are NOT sent to the filename search, which
 * matches whole words with AND; moments inside the videos are TwelveLabs' job.
 */

export const SCOREPLAY_BASE_URL = "https://media.scoreplay.io/v1";
const TIMEOUT_MS = 15_000;
const TAG_QUERY_MAX = 60;

export const ScorePlayIssueSchema = z.enum(["MISSING_API_KEY", "UNAUTHORIZED", "RATE_LIMITED", "BAD_REQUEST", "UPSTREAM_UNAVAILABLE", "INVALID_RESPONSE"]);
export type ScorePlayIssue = z.infer<typeof ScorePlayIssueSchema>;

export class ScorePlayDiscoveryError extends Error {
  constructor(
    readonly code: ScorePlayIssue,
    message: string,
  ) {
    super(message);
    this.name = "ScorePlayDiscoveryError";
  }
}

export interface ScorePlayHttp {
  fetch: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
}

export const defaultScorePlayHttp = (): ScorePlayHttp => ({
  fetch,
  apiKey: process.env.SCOREPLAY_API_KEY?.trim() || undefined,
  baseUrl: process.env.SCOREPLAY_API_BASE_URL?.trim() || SCOREPLAY_BASE_URL,
});

async function call<S extends z.ZodType>(
  http: ScorePlayHttp,
  method: "GET" | "POST",
  path: string,
  schema: S,
  opts: { query?: Record<string, string | number>; body?: unknown } = {},
): Promise<z.output<S>> {
  if (!http.apiKey) throw new ScorePlayDiscoveryError("MISSING_API_KEY", "SCOREPLAY_API_KEY is not set");
  const url = new URL(`${(http.baseUrl ?? SCOREPLAY_BASE_URL).replace(/\/+$/, "")}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await http.fetch(url, {
      method,
      headers: {
        "X-ScorePlay-Api-Key": http.apiKey,
        Accept: "application/json",
        ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ScorePlayDiscoveryError("UPSTREAM_UNAVAILABLE", `ScorePlay ${method} ${path}: ${err instanceof Error ? err.message : "network error"}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    const code: ScorePlayIssue =
      res.status === 401 || res.status === 403
        ? "UNAUTHORIZED"
        : res.status === 429
          ? "RATE_LIMITED"
          : res.status === 400 || res.status === 422
            ? "BAD_REQUEST"
            : "UPSTREAM_UNAVAILABLE";
    throw new ScorePlayDiscoveryError(code, `ScorePlay ${method} ${path} → HTTP ${res.status}: ${detail}`);
  }
  const parsed = schema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new ScorePlayDiscoveryError("INVALID_RESPONSE", `ScorePlay ${method} ${path}: unexpected response shape`);
  return parsed.data;
}

export type ResolvedTags = { players: { id: number; name: string }[]; tags: { id: number; name: string }[]; unresolved: string[] };

/** Step 1: names → IDs. Only entries whose name contains the term are kept (tag search is fuzzy). */
export async function resolveTags(http: ScorePlayHttp, terms: readonly string[]): Promise<ResolvedTags> {
  const out: ResolvedTags = { players: [], tags: [], unresolved: [] };
  for (const term of terms) {
    const needle = term.toLowerCase();
    const found = await call(http, "GET", "/tag/search", TagSearchResultSchema, { query: { query: term.slice(0, TAG_QUERY_MAX) } });
    const players = (found.players ?? []).flatMap((p) => {
      const name = p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ");
      return name.toLowerCase().includes(needle) ? [{ id: p.ID, name }] : [];
    });
    const tags = (found.tags ?? []).flatMap((t) => {
      const name = t.name ?? t.label ?? "";
      return name.toLowerCase().includes(needle) ? [{ id: t.ID, name }] : [];
    });
    if (players.length + tags.length === 0) out.unresolved.push(term);
    out.players.push(...players.filter((p) => !out.players.some((x) => x.id === p.id)));
    out.tags.push(...tags.filter((t) => !out.tags.some((x) => x.id === t.id)));
  }
  return out;
}

export type SearchPage = { media: ScorePlayMedia[]; count: number; pages: number };

/**
 * Step 2: `POST /media/search`, following `page` until a short page, `total_pages`, or `maxItems`.
 * Pagination lives in the query string (documented); the body is the filter.
 */
export async function searchMediaPages(
  http: ScorePlayHttp,
  body: Record<string, unknown>,
  opts: { perPage?: number; maxItems?: number } = {},
): Promise<SearchPage> {
  const perPage = opts.perPage ?? 50;
  const maxItems = opts.maxItems ?? 100;
  const media: ScorePlayMedia[] = [];
  let count = 0;
  let pages = 0;
  for (let page = 1; media.length < maxItems; page++) {
    const res = await call(http, "POST", "/media/search", MediaSearchResultSchema, { query: { page, per_page: perPage }, body });
    const items = res.media ?? [];
    count = res.count ?? count;
    pages = page;
    media.push(...items);
    if (items.length < perPage || (res.total_pages != null && page >= res.total_pages)) break;
  }
  return { media: media.slice(0, maxItems), count, pages };
}

export type DiscoveredVideo = { asset: Asset; discoveredBy: "FILENAME" | "PLAYER_TAG" | "TEAM_TAG" };
export type Discovery = { videos: DiscoveredVideo[]; resolved: ResolvedTags; queries: { kind: DiscoveredVideo["discoveredBy"]; body: Record<string, unknown>; count: number }[] };

/**
 * Real ScorePlay videos for an opportunity: curated edits by exact filename words first, then
 * every video tagged with the resolved players, then videos carrying the resolved team/event tags.
 * Videos only (`media_type: "video"`), de-duplicated, in that order.
 */
export async function discoverVideos(http: ScorePlayHttp, spec: MediaDiscoverySpec, opts: { maxPerQuery?: number } = {}): Promise<Discovery> {
  const max = opts.maxPerQuery ?? 100;
  const resolved = await resolveTags(http, spec.terms);
  const plan: { kind: DiscoveredVideo["discoveredBy"]; body: Record<string, unknown> }[] = [
    ...spec.filenameHints.map((name) => ({ kind: "FILENAME" as const, body: { name, media_type: "video" } })),
    ...(resolved.players.length ? [{ kind: "PLAYER_TAG" as const, body: { any_players: resolved.players.map((p) => p.id), media_type: "video" } }] : []),
    ...(resolved.tags.length ? [{ kind: "TEAM_TAG" as const, body: { any_tag_options: resolved.tags.map((t) => t.id), media_type: "video" } }] : []),
  ];
  const videos: DiscoveredVideo[] = [];
  const queries: Discovery["queries"] = [];
  for (const q of plan) {
    const page = await searchMediaPages(http, q.body, { maxItems: max });
    queries.push({ ...q, count: page.count });
    for (const m of page.media) {
      if (m.type !== "video" || videos.some((v) => v.asset.id === String(m.ID))) continue;
      videos.push({ asset: mapMediaToAsset(m, []), discoveredBy: q.kind });
    }
  }
  return { videos, resolved, queries };
}
