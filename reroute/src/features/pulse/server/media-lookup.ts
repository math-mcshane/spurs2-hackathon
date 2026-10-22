import { isEvidenceLinkable, type MediaRef } from "@/lib/contracts";
import { listScorePlayCatalog, listTwelveLabsCatalog, resolverForIndex, type MediaCatalog } from "@/lib/media";
import { readTwelveLabsConfig } from "@/lib/twelvelabs/config";
import type { DetectedOpportunity, MediaCandidate, MediaLookup, TwelveLabsIssue } from "../types";
import { ScorePlayDiscoveryError, defaultScorePlayHttp, discoverVideos, type DiscoveredVideo, type Discovery, type ScorePlayHttp } from "./scoreplay-discovery";
import {
  TwelveLabsError,
  classifyTwelveLabsError,
  createTwelveLabsSdk,
  loadCatalog,
  searchMoments,
  type IndexCatalog,
  type TwelveLabsSdk,
} from "./twelvelabs-moments";

const LIMIT = 3;
/** One full search page: enough moments to usually span several distinct videos. */
const MOMENT_POOL = 50;

export interface MediaDeps {
  scoreplay: ScorePlayHttp;
  /** Throws when not configured (classified as MISSING_API_KEY / MISSING_INDEX_ID). */
  twelvelabs(): { sdk: TwelveLabsSdk; indexId: string };
}

/** Deps for a club's index (per-club override, else the shared one). */
export const defaultMediaDeps = (club?: string): MediaDeps => ({
  scoreplay: defaultScorePlayHttp(),
  twelvelabs: () => {
    const config = readTwelveLabsConfig({ club });
    return { sdk: createTwelveLabsSdk(config.apiKey), indexId: config.indexId };
  },
});

export type OpenIndex = { sdk: TwelveLabsSdk; indexId: string; catalog: IndexCatalog; media: MediaCatalog };

/** The index summary plus lib/media's canonical ScorePlay ↔ TwelveLabs catalog for it (shared cache per index). */
export async function openIndex(deps: MediaDeps): Promise<OpenIndex> {
  const { sdk, indexId } = deps.twelvelabs();
  const catalog = await loadCatalog(sdk, indexId);
  const resolver = resolverForIndex(indexId, () => ({
    indexId,
    scoreplay: (tl) => listScorePlayCatalog(deps.scoreplay, tl),
    twelvelabs: ({ fresh }) => listTwelveLabsCatalog(sdk, indexId, fresh),
  }));
  return { sdk, indexId, catalog, media: await resolver.catalog() };
}

export type IndexLink = { video: DiscoveredVideo; ref: MediaRef };

/** Discovered ScorePlay videos split by their canonical MediaRef: linkable, AMBIGUOUS, or UNMAPPED. */
export function linkDiscovered(videos: readonly DiscoveredVideo[], media: MediaCatalog): { links: IndexLink[]; ambiguous: MediaRef[]; unmapped: MediaRef[] } {
  const out = { links: [] as IndexLink[], ambiguous: [] as MediaRef[], unmapped: [] as MediaRef[] };
  for (const video of videos) {
    const ref: MediaRef = media.bySp.get(video.asset.id) ?? {
      scoreplayMediaId: video.asset.id,
      twelvelabsIndexId: media.indexId,
      method: "UNMAPPED",
      candidates: [],
      checkedAt: media.loadedAt,
    };
    if (isEvidenceLinkable(ref)) out.links.push({ video, ref });
    else if (ref.method === "AMBIGUOUS") out.ambiguous.push(ref);
    else out.unmapped.push(ref);
  }
  return out;
}

/** A MAPPING_FAILED attempt naming the ScorePlay videos that could not be linked, or undefined when all linked. */
export function mappingAttempt(ambiguous: readonly MediaRef[], unmapped: readonly MediaRef[], indexLabel: string): MediaLookup["attempts"][number] | undefined {
  if (ambiguous.length + unmapped.length === 0) return undefined;
  const amb = ambiguous.map((r) => `${r.scoreplayMediaId} ↔ ${r.candidates.map((c) => c.twelvelabsVideoId ?? `SP ${c.scoreplayMediaId}`).join("/")}`);
  const parts = [
    ambiguous.length ? `${ambiguous.length} ambiguous (same filename+duration on several videos: ${amb.slice(0, 5).join("; ")})` : "",
    unmapped.length ? `${unmapped.length} not in index ${indexLabel} (${unmapped.slice(0, 5).map((r) => r.scoreplayMediaId).join(", ")}${unmapped.length > 5 ? ", …" : ""})` : "",
  ].filter(Boolean);
  return { service: "TwelveLabs", query: "media identity", outcome: "EMPTY", code: "MAPPING_FAILED", detail: `${parts.join("; ")} — not used as evidence` };
}

/** Classify a failure inside the TwelveLabs stage (which also lists the ScorePlay catalog for mapping). */
export function stageIssue(err: unknown): { service: "TwelveLabs" | "ScorePlay"; code: string; intelligenceCode: TwelveLabsIssue; message: string } {
  if (err instanceof ScorePlayDiscoveryError) return { service: "ScorePlay", code: err.code, intelligenceCode: "UPSTREAM_UNAVAILABLE", message: err.message };
  const issue = err instanceof TwelveLabsError ? err : classifyTwelveLabsError(err, "search");
  return { service: "TwelveLabs", code: issue.code, intelligenceCode: issue.code, message: issue.message };
}

/** The UI-facing mapping summary of a linked video. */
export function candidateMapping(link: IndexLink): NonNullable<MediaCandidate["mapping"]> {
  return {
    via: link.ref.method === "AUTHORITATIVE_ID" ? "AUTHORITATIVE_ID" : "FILENAME_DURATION",
    filename: link.ref.match?.twelvelabsFilename ?? link.video.asset.title,
  };
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
export async function lookupMedia(opp: DetectedOpportunity, deps: MediaDeps = defaultMediaDeps()): Promise<MediaLookup> {
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
    const { sdk, indexId, catalog, media } = await openIndex(deps);
    const indexLabel = catalog.indexName ?? indexId;
    const { links, ambiguous, unmapped } = linkDiscovered(discovery.videos, media);
    const mapping = mappingAttempt(ambiguous, unmapped, indexLabel);
    if (mapping) attempts.push(mapping);
    if (links.length === 0) {
      return fallback(
        "NOT_INDEXED",
        `These ScorePlay videos are not in the video-intelligence index — ${FALLBACK_SUFFIX}`,
        ambiguous.length ? "MAPPING_FAILED" : undefined,
      );
    }

    const searchOptions = catalog.searchOptions.includes("visual") ? (["visual"] as const) : (["audio"] as const);
    const moments = await searchMoments(sdk, indexId, opp.semanticQuery, {
      videoIds: links.map((l) => l.ref.twelvelabsVideoId!),
      limit: MOMENT_POOL,
      searchOptions: [...searchOptions],
    });
    const byVideo = new Map(links.map((l) => [l.ref.twelvelabsVideoId!, l]));
    const dropped = moments.filter((m) => !byVideo.has(m.videoId)).length;
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
        mapping: candidateMapping(link),
      });
    }
    attempts.push({
      service: "TwelveLabs",
      query: opp.semanticQuery,
      outcome: found.length ? "OK" : "EMPTY",
      code: found.length ? undefined : dropped ? "MAPPING_FAILED" : "NO_SEARCH_RESULTS",
      detail: `index ${indexLabel}: ${links.length}/${discovery.videos.length} ScorePlay videos linked (${links.filter((l) => l.ref.method === "AUTHORITATIVE_ID").length} by verified id, ${links.filter((l) => l.ref.method === "FILENAME_DURATION").length} by exact filename+duration); ${moments.length} moment(s), ${dropped} dropped as unlinkable`,
    });
    if (found.length === 0) {
      return fallback("NO_MATCHING_MOMENT", `No matching moment found inside the indexed videos — ${FALLBACK_SUFFIX}`, dropped ? "MAPPING_FAILED" : "NO_SEARCH_RESULTS");
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
    const issue = stageIssue(err);
    console.warn(`[pulse] media intelligence unavailable for ${opp.id}: ${issue.code} — ${issue.message}`);
    attempts.push({ service: issue.service, query: opp.semanticQuery, outcome: "ERROR", code: issue.code, detail: issue.message });
    return fallback("UNAVAILABLE", `Media intelligence unavailable — ${FALLBACK_SUFFIX}`, issue.intelligenceCode);
  }
}
