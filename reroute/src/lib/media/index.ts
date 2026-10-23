/**
 * Canonical ScorePlay ↔ TwelveLabs identity (server-only). Catalog loaders reuse PULSE's ScorePlay
 * discovery HTTP and TwelveLabs index listing so there is one implementation of each call.
 */
import { defaultScorePlayHttp, getMedia, searchMediaPages, type ScorePlayHttp } from "@/features/pulse/server/scoreplay-discovery";
import { createTwelveLabsSdk, invalidateCatalog, loadCatalog, type TwelveLabsSdk } from "@/features/pulse/server/twelvelabs-moments";
import type { ScorePlayMedia } from "@/lib/scoreplay/schemas";
import { readTwelveLabsConfig } from "@/lib/twelvelabs/config";
import { normalizeFilename, type ScorePlayCatalogEntry, type TwelveLabsCatalogEntry } from "./link";
import { CatalogMediaResolver, type CatalogSource } from "./resolver";

export { DURATION_TOLERANCE_SEC, linkCatalogs, normalizeFilename } from "./link";
export type { LinkedCatalogs, ScorePlayCatalogEntry, TwelveLabsCatalogEntry } from "./link";
export { CATALOG_TTL_MS, CatalogMediaResolver } from "./resolver";
export type { CatalogSource, MediaCatalog } from "./resolver";
export { PREVIEW_TTL_MS, previewFor, type PreviewDeps } from "./preview";

if (typeof window !== "undefined") throw new Error("lib/media is server-only");

/** Concurrent `GET /media/{id}` calls while refining durations. */
const REFINE_CONCURRENCY = 8;

/**
 * Every video in the ScorePlay workspace (all pages; `name` is the uploaded filename). `POST /media/search`
 * truncates durations to whole seconds — too coarse for ±0.5 s — so videos whose filename also appears in
 * the TwelveLabs catalog are re-read with `GET /media/{id}` for the exact `media_duration` (nanoseconds).
 */
export async function listScorePlayCatalog(http: ScorePlayHttp, twelvelabs: readonly TwelveLabsCatalogEntry[]): Promise<ScorePlayCatalogEntry[]> {
  const { media } = await searchMediaPages(http, { media_type: "video" }, { maxItems: Number.POSITIVE_INFINITY });
  const indexed = new Set(twelvelabs.flatMap((t) => (t.filename ? [normalizeFilename(t.filename)] : [])));
  const videos = media.filter((m) => m.type === "video");
  const out: ScorePlayCatalogEntry[] = [];
  for (let i = 0; i < videos.length; i += REFINE_CONCURRENCY) {
    const batch = videos.slice(i, i + REFINE_CONCURRENCY);
    const refined = await Promise.all(batch.map((m) => (m.name && indexed.has(normalizeFilename(m.name)) ? getMedia(http, String(m.ID)) : m)));
    out.push(...refined.map((m) => ({ scoreplayMediaId: String(m.ID), filename: m.name ?? undefined, durationSec: exactDurationSec(m) })));
  }
  return out;
}

/** `media_duration` is nanoseconds; `duration` (whole seconds, sometimes 0) is the fallback. */
function exactDurationSec(m: ScorePlayMedia): number | undefined {
  if (m.media_duration && m.media_duration > 0) return m.media_duration / 1e9;
  return m.duration && m.duration > 0 ? m.duration : undefined;
}

/** Every video in a TwelveLabs index (paginated, via PULSE's catalog loader). */
export async function listTwelveLabsCatalog(sdk: TwelveLabsSdk, indexId: string, fresh = false): Promise<TwelveLabsCatalogEntry[]> {
  if (fresh) invalidateCatalog(sdk, indexId);
  const catalog = await loadCatalog(sdk, indexId);
  return catalog.entries.map((e) => ({ twelvelabsVideoId: e.videoId, filename: e.filename, durationSec: e.durationSec, claimedScoreplayId: e.claimedScoreplayId }));
}

/** Per SDK (= per TwelveLabs API key, see `createTwelveLabsSdk`), then per index id. */
const resolvers = new WeakMap<TwelveLabsSdk, Map<string, CatalogMediaResolver>>();

/** One resolver (and catalog cache) per (API key, index id). `source` is used only when none exists yet. */
export function resolverForIndex(sdk: TwelveLabsSdk, indexId: string, source: () => CatalogSource): CatalogMediaResolver {
  let byIndex = resolvers.get(sdk);
  if (!byIndex) {
    byIndex = new Map();
    resolvers.set(sdk, byIndex);
  }
  let r = byIndex.get(indexId);
  if (!r) {
    r = new CatalogMediaResolver(source());
    byIndex.set(indexId, r);
  }
  return r;
}

/** The resolver for a club's index and key (per-club overrides, else the shared ones). Throws NOT_CONFIGURED. */
export function getMediaResolver(club?: string): CatalogMediaResolver {
  const config = readTwelveLabsConfig({ club });
  const sdk = createTwelveLabsSdk(config.apiKey);
  return resolverForIndex(sdk, config.indexId, () => {
    const http = defaultScorePlayHttp();
    return {
      indexId: config.indexId,
      scoreplay: (tl) => listScorePlayCatalog(http, tl),
      twelvelabs: ({ fresh }) => listTwelveLabsCatalog(sdk, config.indexId, fresh),
    };
  });
}
