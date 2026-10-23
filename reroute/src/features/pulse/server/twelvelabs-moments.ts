import { TwelveLabs } from "twelvelabs-js";
import { z } from "zod";
import type { DataOrigin } from "@/lib/contracts";
import { reportProvenance, type RunProvenance } from "@/lib/media/provenance";
import { ReplayMissError, provenanceOf, replayable } from "@/lib/media/replay";
import { claimedScoreplayId } from "@/lib/twelvelabs/parse";
import { TwelveLabsConfigError } from "@/lib/twelvelabs/config";
import type { TwelveLabsIssue } from "../types";

/** Shape of a `TwelvelabsApiError` (twelvelabs-js 1.3.6): HTTP `statusCode` and the API body's `code`. */
const ApiErrorShape = z.object({ statusCode: z.number().optional(), body: z.object({ code: z.string().optional() }).loose().optional() }).loose();

/** An indexed asset as listed by the SDK; user metadata stays under the raw `user_metadata` key in 1.3.6. */
const IndexedAssetShape = z
  .object({
    id: z.string(),
    status: z.string().optional(),
    systemMetadata: z.object({ filename: z.string().optional(), duration: z.number().optional() }).loose().optional(),
    userMetadata: z.record(z.string(), z.unknown()).optional(),
    user_metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

/**
 * PULSE's TwelveLabs adapter, written against the installed SDK (twelvelabs-js 1.3.6):
 * `indexes.retrieve`, `indexes.indexedAssets.list` (index content, paginated) and
 * `search.create` / `search.retrieve(pageToken)` (Marengo search; the SDK builds the documented
 * multipart request). Every failure is classified — nothing is silently turned into "no results".
 */

export class TwelveLabsError extends Error {
  constructor(
    readonly code: TwelveLabsIssue,
    message: string,
  ) {
    super(message);
    this.name = "TwelveLabsError";
  }
}

/** Maps SDK/HTTP failures (TwelvelabsApiError carries `statusCode` and `body.code`) onto PULSE issue codes. */
export function classifyTwelveLabsError(err: unknown, during: "index" | "search"): TwelveLabsError {
  if (err instanceof TwelveLabsError) return err;
  if (err instanceof TwelveLabsConfigError) return new TwelveLabsError(err.missing === "API_KEY" ? "MISSING_API_KEY" : "MISSING_INDEX_ID", err.message);
  const shape = ApiErrorShape.safeParse(err);
  const status = shape.success ? shape.data.statusCode : undefined;
  const apiCode = (shape.success && shape.data.body?.code) || "";
  const message = err instanceof Error ? err.message : String(err);
  const code: TwelveLabsIssue =
    status === 401 || apiCode === "api_key_invalid"
      ? "INVALID_API_KEY"
      : status === 429
        ? "RATE_LIMITED"
        : status === 403 || (status === 404 && during === "index") || apiCode === "resource_not_exists"
          ? "INDEX_NOT_ACCESSIBLE"
          : status === 400 && /search_option|searchOptions|search option/i.test(`${apiCode} ${message}`)
            ? "UNSUPPORTED_SEARCH_OPTION"
            : "UPSTREAM_UNAVAILABLE";
  return new TwelveLabsError(code, `TwelveLabs ${during} failed${status ? ` (HTTP ${status}${apiCode ? ` ${apiCode}` : ""})` : ""}`);
}

export type IndexInfo = { indexName?: string; videoCount?: number; models?: { modelName?: string; modelOptions?: string[] }[] };

/** The SDK's `core.Page` surface used for index-content pagination. */
export interface AssetPage {
  data: unknown[];
  hasNextPage(): boolean;
  getNextPage(): Promise<AssetPage>;
}
/** The slice of the SDK PULSE uses — injectable for tests. */
export interface TwelveLabsSdk {
  indexes: {
    retrieve(indexId: string): Promise<IndexInfo>;
    indexedAssets: {
      list(indexId: string, req: { page?: number; pageLimit?: number }): Promise<AssetPage>;
    };
    /** `GET /indexes/{index}/videos/{video}`; carries the HLS stream when the index has streaming. */
    videos: { retrieve(indexId: string, videoId: string): Promise<unknown> };
  };
  search: {
    create(req: {
      indexId: string;
      queryText: string;
      searchOptions: ("visual" | "audio")[];
      groupBy: "clip";
      pageLimit: number;
      filter?: string;
      includeUserMetadata: boolean;
    }): Promise<SearchPage>;
    retrieve(pageToken: string, req: { includeUserMetadata: boolean }): Promise<SearchPage>;
  };
}
type SearchPage = {
  data?: { videoId?: string; start?: number; end?: number; rank?: number; thumbnailUrl?: string; userMetadata?: Record<string, unknown> }[];
  pageInfo?: { nextPageToken?: string; totalResults?: number };
};

const sdks = new Map<string, TwelveLabsSdk>();

/**
 * One SDK per API key, so every cache keyed by SDK identity (catalogs, resolvers) is scoped per
 * (key, index): an index reached with one account's key is never served to another account's club.
 */
export function createTwelveLabsSdk(apiKey: string): TwelveLabsSdk {
  let sdk = sdks.get(apiKey);
  if (!sdk) {
    sdk = new TwelveLabs({ apiKey }) as unknown as TwelveLabsSdk;
    sdks.set(apiKey, sdk);
  }
  return sdk;
}

const VideoStreamShape = z.object({ hls: z.object({ videoUrl: z.string().optional(), status: z.string().optional() }).loose().optional() }).loose();

/**
 * The HLS stream TwelveLabs serves for an indexed video (a playback reference — nothing is
 * downloaded or stored), or undefined when the index has none or the lookup fails.
 */
export async function videoStream(sdk: TwelveLabsSdk, indexId: string, videoId: string): Promise<string | undefined> {
  try {
    const parsed = VideoStreamShape.safeParse(await sdk.indexes.videos.retrieve(indexId, videoId));
    const hls = parsed.success ? parsed.data.hls : undefined;
    return hls?.status === "COMPLETE" && hls.videoUrl?.startsWith("https://") ? hls.videoUrl : undefined;
  } catch (err) {
    console.warn(`[pulse] TwelveLabs stream lookup failed for ${videoId}: ${classifyTwelveLabsError(err, "index").code}`);
    return undefined;
  }
}

/** `claimedScoreplayId` is the index's `user_metadata` id: a hint for lib/media, never an identity on its own. */
export type CatalogEntry = { videoId: string; filename?: string; durationSec?: number; status?: string; claimedScoreplayId?: string };
export type IndexCatalog = { indexId: string; indexName?: string; models: string[]; searchOptions: string[]; entries: CatalogEntry[] };

const CATALOG_TTL_MS = 10 * 60_000;
type CachedCatalog = { at: number; catalog: Promise<{ catalog: IndexCatalog; provenance: RunProvenance }> };
/** Per SDK (= per API key), then per index id. */
const catalogCache = new WeakMap<TwelveLabsSdk, Map<string, CachedCatalog>>();

function catalogsOf(sdk: TwelveLabsSdk): Map<string, CachedCatalog> {
  let m = catalogCache.get(sdk);
  if (!m) {
    m = new Map();
    catalogCache.set(sdk, m);
  }
  return m;
}

function toEntry(raw: unknown): CatalogEntry | undefined {
  const parsed = IndexedAssetShape.safeParse(raw);
  if (!parsed.success) return undefined;
  const a = parsed.data;
  const meta = a.userMetadata ?? a.user_metadata;
  return {
    videoId: a.id,
    filename: a.systemMetadata?.filename,
    durationSec: a.systemMetadata?.duration,
    status: a.status,
    claimedScoreplayId: meta ? claimedScoreplayId(meta) : undefined,
  };
}

/** Drop the cached catalog so the next `loadCatalog` re-lists the index. */
export function invalidateCatalog(sdk: TwelveLabsSdk, indexId: string): void {
  catalogsOf(sdk).delete(indexId);
}

/** Live index summary + every indexed asset (paginated). Raw SDK errors propagate (replay inspects their status). */
async function listCatalog(sdk: TwelveLabsSdk, indexId: string): Promise<IndexCatalog> {
  const index = await sdk.indexes.retrieve(indexId);
  if (!index.videoCount) throw new TwelveLabsError("EMPTY_INDEX", `Index ${indexId} has no indexed videos`);
  const entries: CatalogEntry[] = [];
  let page = await sdk.indexes.indexedAssets.list(indexId, { pageLimit: 50 });
  for (;;) {
    entries.push(...page.data.flatMap((d) => toEntry(d) ?? []));
    if (!page.hasNextPage()) break;
    page = await page.getNextPage();
  }
  return {
    indexId,
    indexName: index.indexName,
    models: (index.models ?? []).flatMap((m) => m.modelName ?? []),
    searchOptions: [...new Set((index.models ?? []).flatMap((m) => m.modelOptions ?? []))],
    entries,
  };
}

/** A replay miss (DEMO_REPLAY=true without a recording) or a classified upstream failure. */
function replayFailure(err: unknown, during: "index" | "search"): TwelveLabsError {
  if (err instanceof ReplayMissError) return new TwelveLabsError("UPSTREAM_UNAVAILABLE", `TwelveLabs ${during} is not in the demo recording (DEMO_REPLAY=true)`);
  return classifyTwelveLabsError(err, during);
}

/**
 * Index summary + every indexed asset (paginated). EMPTY_INDEX when nothing is indexed. Cached 10 min;
 * served from the demo recording under DEMO_REPLAY or when TwelveLabs is unavailable. Each use reports the
 * catalog's origin to the run's provenance.
 */
export function loadCatalog(sdk: TwelveLabsSdk, indexId: string, now = Date.now()): Promise<IndexCatalog> {
  const cache = catalogsOf(sdk);
  const hit = cache.get(indexId);
  let catalog = hit && now - hit.at < CATALOG_TTL_MS ? hit.catalog : undefined;
  if (!catalog) {
    const loading = replayable("twelvelabs", { op: "catalog", indexId }, () => listCatalog(sdk, indexId)).then(
      (r) => ({ catalog: r.value, provenance: provenanceOf(r) }),
      (err: unknown) => {
        throw replayFailure(err, "index");
      },
    );
    cache.set(indexId, { at: now, catalog: loading });
    loading.catch(() => cache.delete(indexId));
    catalog = loading;
  }
  return catalog.then((c) => {
    reportProvenance(c.provenance);
    return c.catalog;
  });
}

/** `origin`: CACHED when the search was answered from the demo recording. */
export type Moment = { videoId: string; start: number; end: number; rank: number; thumbnailUrl?: string; query: string; origin: DataOrigin };

/**
 * Marengo moments for `query`, optionally restricted to `videoIds` (documented filter
 * `{"id": [...]}`), following `nextPageToken` until `limit` moments. Timestamps are kept exactly.
 * Served from the demo recording under DEMO_REPLAY or when TwelveLabs is unavailable (thumbnails are
 * signed URLs and are not recorded).
 */
export async function searchMoments(
  sdk: TwelveLabsSdk,
  indexId: string,
  query: string,
  opts: { videoIds?: string[]; limit?: number; searchOptions?: ("visual" | "audio")[] } = {},
): Promise<Moment[]> {
  const limit = opts.limit ?? 10;
  const searchOptions = opts.searchOptions ?? ["visual"];
  const request = { op: "moments", indexId, query, limit, searchOptions, videoIds: [...(opts.videoIds ?? [])].sort() };
  const live = async (): Promise<Omit<Moment, "origin">[]> => {
    const moments: Omit<Moment, "origin">[] = [];
    let page = await sdk.search.create({
      indexId,
      queryText: query,
      searchOptions,
      groupBy: "clip",
      pageLimit: Math.min(50, limit),
      includeUserMetadata: true,
      ...(opts.videoIds?.length ? { filter: JSON.stringify({ id: opts.videoIds }) } : {}),
    });
    for (;;) {
      for (const c of page.data ?? []) {
        if (!c.videoId || c.start === undefined || c.end === undefined) continue;
        moments.push({ videoId: c.videoId, start: c.start, end: c.end, rank: c.rank ?? moments.length + 1, thumbnailUrl: c.thumbnailUrl, query });
      }
      const next = page.pageInfo?.nextPageToken;
      if (moments.length >= limit || !next) break;
      page = await sdk.search.retrieve(next, { includeUserMetadata: true });
    }
    return moments.slice(0, limit);
  };
  try {
    const { value, origin } = await replayable("twelvelabs", request, live);
    return value.map((m) => ({ ...m, origin }));
  } catch (err) {
    throw replayFailure(err, "search");
  }
}
