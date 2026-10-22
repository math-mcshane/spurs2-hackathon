import type { DetectedOpportunity, MediaCandidate, MediaLookup, TwelveLabsIssue } from "../types";
import { ScorePlayDiscoveryError, defaultScorePlayHttp, discoverVideos, type DiscoveredVideo, type Discovery, type ScorePlayHttp } from "./scoreplay-discovery";
import {
  TwelveLabsError,
  classifyTwelveLabsError,
  createTwelveLabsSdk,
  loadCatalog,
  readTwelveLabsConfig,
  searchMoments,
  type CatalogEntry,
  type TwelveLabsSdk,
} from "./twelvelabs-moments";

const LIMIT = 3;
/** TwelveLabs and ScorePlay report the same file's duration with rounding differences. */
const DURATION_TOLERANCE_SEC = 1.5;
/** One full search page: enough moments to usually span several distinct videos. */
const MOMENT_POOL = 50;

export interface MediaDeps {
  scoreplay: ScorePlayHttp;
  /** Throws TwelveLabsError MISSING_API_KEY / MISSING_INDEX_ID when not configured. */
  twelvelabs(): { sdk: TwelveLabsSdk; indexId: string };
}

const defaultDeps = (): MediaDeps => ({
  scoreplay: defaultScorePlayHttp(),
  twelvelabs: () => {
    const config = readTwelveLabsConfig();
    return { sdk: createTwelveLabsSdk(config.apiKey), indexId: config.indexId };
  },
});

export type IndexLink = { video: DiscoveredVideo; entry: CatalogEntry; via: "CUSTOM_ID" | "FILENAME_DURATION" };

/**
 * The indexed TwelveLabs video for a ScorePlay video: the index's custom id (`user_metadata.scoreplay_id`)
 * when it equals this asset's id; otherwise exactly one indexed file with the same filename and
 * duration. Ambiguous or missing matches are not linked — an id is never guessed.
 */
export function linkToIndex(videos: readonly DiscoveredVideo[], catalog: readonly CatalogEntry[]): { links: IndexLink[]; ambiguous: string[] } {
  const links: IndexLink[] = [];
  const ambiguous: string[] = [];
  for (const video of videos) {
    const byId = catalog.find((e) => e.customId === video.asset.id);
    if (byId) {
      links.push({ video, entry: byId, via: "CUSTOM_ID" });
      continue;
    }
    const same = catalog.filter(
      (e) =>
        e.filename === video.asset.title &&
        e.durationSec !== undefined &&
        video.asset.durationSec !== undefined &&
        Math.abs(e.durationSec - video.asset.durationSec) <= DURATION_TOLERANCE_SEC,
    );
    if (same.length === 1) links.push({ video, entry: same[0], via: "FILENAME_DURATION" });
    else if (same.length > 1) ambiguous.push(video.asset.id);
  }
  return { links, ambiguous };
}

function metadataCandidate(v: DiscoveredVideo): MediaCandidate {
  return {
    scoreplayAssetId: v.asset.id,
    title: v.asset.title,
    kind: v.asset.kind,
    thumbnailUrl: v.asset.thumbnailUrl,
    durationSec: v.asset.durationSec,
    competition: v.asset.facts.competition,
    recordedAt: v.asset.facts.recordedAt,
    foundBy: "SCOREPLAY_METADATA_FALLBACK",
    discoveredBy: v.discoveredBy,
    origin: v.asset.origin,
  };
}

const FALLBACK_SUFFIX = "showing ScorePlay videos matched by player, team or filename instead.";

function describe(d: Discovery): string {
  const players = d.resolved.players.map((p) => p.name).join(", ") || "none";
  const tags = d.resolved.tags.map((t) => t.name).join(", ") || "none";
  const queries = d.queries.map((q) => `${q.kind}=${q.count}`).join(" ");
  return `players: ${players}; tags: ${tags}; unresolved: ${d.resolved.unresolved.join(", ") || "none"}; matches ${queries || "none"}`;
}

/**
 * Media pipeline for one opportunity (references only — no media is copied):
 *  1. ScorePlay discovers real videos (player/team tags, curated filenames);
 *  2. TwelveLabs Marengo searches moments *inside* those videos (filtered by indexed video id);
 *  3. moments map back to the ScorePlay asset with exact timestamps.
 * When TwelveLabs cannot contribute, ScorePlay videos are returned as SCOREPLAY_METADATA_FALLBACK
 * and the reason is stated — never replaced by simulated results.
 */
export async function lookupMedia(opp: DetectedOpportunity, deps: MediaDeps = defaultDeps()): Promise<MediaLookup> {
  const searchedAt = new Date().toISOString();
  const attempts: MediaLookup["attempts"] = [];
  const spec = [...opp.discovery.terms, ...opp.discovery.filenameHints].join(", ");

  let discovery: Discovery;
  try {
    discovery = await discoverVideos(deps.scoreplay, opp.discovery);
    attempts.push({ service: "ScorePlay", query: spec, outcome: discovery.videos.length ? "OK" : "EMPTY", detail: describe(discovery) });
  } catch (err) {
    const code = err instanceof ScorePlayDiscoveryError ? err.code : "UPSTREAM_UNAVAILABLE";
    console.warn(`[pulse] ScorePlay discovery failed for ${opp.id}: ${code}`, err instanceof Error ? err.message : err);
    attempts.push({ service: "ScorePlay", query: spec, outcome: "ERROR", code, detail: err instanceof Error ? err.message : String(err) });
    return {
      status: "UNAVAILABLE",
      searchedAt,
      intelligence: { status: "UNAVAILABLE", message: "The ScorePlay media library could not be reached, so no footage is proposed." },
      attempts,
      candidates: [],
    };
  }

  const fallback = (status: MediaLookup["intelligence"]["status"], message: string, code?: TwelveLabsIssue): MediaLookup => {
    const candidates = discovery.videos.slice(0, LIMIT).map(metadataCandidate);
    return { status: candidates.length ? "FOUND" : "NOT_FOUND", searchedAt, intelligence: { status, code, message }, attempts, candidates };
  };
  if (discovery.videos.length === 0) {
    return fallback("NO_MATCHING_MOMENT", "No ScorePlay video matched this topic's players, teams or filenames.");
  }

  try {
    const { sdk, indexId } = deps.twelvelabs();
    const catalog = await loadCatalog(sdk, indexId);
    const { links, ambiguous } = linkToIndex(discovery.videos, catalog.entries);
    if (links.length === 0) {
      attempts.push({
        service: "TwelveLabs",
        query: opp.semanticQuery,
        outcome: "EMPTY",
        code: ambiguous.length ? "MAPPING_FAILED" : undefined,
        detail: `index ${catalog.indexName ?? indexId}: 0 of ${discovery.videos.length} ScorePlay videos indexed${ambiguous.length ? `; ambiguous filename matches for ${ambiguous.join(", ")}` : ""}`,
      });
      return fallback(
        "NOT_INDEXED",
        `These ScorePlay videos are not in the video-intelligence index — ${FALLBACK_SUFFIX}`,
        ambiguous.length ? "MAPPING_FAILED" : undefined,
      );
    }

    const searchOptions = catalog.searchOptions.includes("visual") ? (["visual"] as const) : (["audio"] as const);
    const moments = await searchMoments(sdk, indexId, opp.semanticQuery, {
      videoIds: links.map((l) => l.entry.videoId),
      limit: MOMENT_POOL,
      searchOptions: [...searchOptions],
    });
    const byVideo = new Map(links.map((l) => [l.entry.videoId, l]));
    const unmapped = moments.filter((m) => !byVideo.has(m.videoId)).length;
    const seen = new Set<string>();
    const found: MediaCandidate[] = [];
    for (const m of moments) {
      const link = byVideo.get(m.videoId);
      if (!link || seen.has(link.video.asset.id)) continue;
      seen.add(link.video.asset.id);
      found.push({
        ...metadataCandidate(link.video),
        twelveLabsVideoId: m.videoId,
        thumbnailUrl: m.thumbnailUrl ?? link.video.asset.thumbnailUrl,
        startSeconds: m.start,
        endSeconds: m.end,
        rank: m.rank,
        query: m.query,
        foundBy: "TWELVELABS",
        origin: "LIVE",
        mapping: { via: link.via, indexedScoreplayId: link.entry.customId, filename: link.entry.filename ?? link.video.asset.title },
      });
    }
    attempts.push({
      service: "TwelveLabs",
      query: opp.semanticQuery,
      outcome: found.length ? "OK" : "EMPTY",
      code: found.length ? undefined : unmapped ? "MAPPING_FAILED" : "NO_SEARCH_RESULTS",
      detail: `index ${catalog.indexName ?? indexId}: ${links.length}/${discovery.videos.length} ScorePlay videos indexed (${links.filter((l) => l.via === "CUSTOM_ID").length} by custom id, ${links.filter((l) => l.via === "FILENAME_DURATION").length} by exact filename+duration); ${moments.length} moment(s), ${unmapped} unmapped`,
    });
    if (found.length === 0) {
      return fallback("NO_MATCHING_MOMENT", `No matching moment found inside the indexed videos — ${FALLBACK_SUFFIX}`, unmapped ? "MAPPING_FAILED" : "NO_SEARCH_RESULTS");
    }
    const fill = discovery.videos.filter((v) => !seen.has(v.asset.id)).map(metadataCandidate);
    return {
      status: "FOUND",
      searchedAt,
      intelligence: {
        status: "MOMENTS_FOUND",
        message: `TwelveLabs found ${found.length} matching moment(s) inside ${links.length} indexed ScorePlay video(s).`,
      },
      attempts,
      candidates: [...found, ...fill].slice(0, LIMIT),
    };
  } catch (err) {
    const issue = err instanceof TwelveLabsError ? err : classifyTwelveLabsError(err, "search");
    console.warn(`[pulse] TwelveLabs unavailable for ${opp.id}: ${issue.code} — ${issue.message}`);
    attempts.push({ service: "TwelveLabs", query: opp.semanticQuery, outcome: "ERROR", code: issue.code, detail: issue.message });
    return fallback("UNAVAILABLE", `Media intelligence unavailable — ${FALLBACK_SUFFIX}`, issue.code);
  }
}
