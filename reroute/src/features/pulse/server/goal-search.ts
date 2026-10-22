import { CLUBS } from "../clubs";
import { isVideoPreviewEnabled } from "../flags";
import { goalIntents } from "../goal-intents";
import { latestSeason, rankMoments, withPreview, type LinkedVideo } from "../moment-ranking";
import type { Club, GoalRun, ParsedObjective, Preview } from "../types";
import { linkToIndex, type MediaDeps } from "./media-lookup";
import { ScorePlayDiscoveryError, defaultScorePlayHttp, discoverVideos, type Discovery } from "./scoreplay-discovery";
import {
  TwelveLabsError,
  classifyTwelveLabsError,
  createTwelveLabsSdk,
  loadCatalog,
  readTwelveLabsConfig,
  searchMoments,
  videoStream,
} from "./twelvelabs-moments";

/** Moments per question: one page; enough for agreement between questions to show. */
const MOMENTS_PER_INTENT = 12;
/** Distinct videos whose stream is looked up (top recommendations + alternatives). */
const PREVIEW_VIDEOS = 15;

export type GoalSearchDeps = MediaDeps & { previews: boolean };

/** The club's index: its own (`CLUBS[club].library.indexEnv`) when configured, else the shared one. */
export function defaultGoalDeps(club: Club): GoalSearchDeps {
  return {
    scoreplay: defaultScorePlayHttp(),
    twelvelabs: () => {
      const config = readTwelveLabsConfig();
      const own = process.env[CLUBS[club].library.indexEnv]?.trim();
      return { sdk: createTwelveLabsSdk(config.apiKey), indexId: own || config.indexId };
    },
    previews: isVideoPreviewEnabled(),
  };
}

export type GoalSearch = Pick<GoalRun, "intents" | "library" | "search" | "attempts" | "pool">;

/**
 * Goal → ranked real moments:
 *  1. ScorePlay lists the club's videos (team tag);
 *  2. each objective question is a TwelveLabs Marengo search restricted to those indexed videos;
 *  3. hits map back to ScorePlay assets with exact timestamps and are ranked for the objective.
 * Every failure is reported as such; nothing is simulated or filled in.
 */
export async function searchGoal(
  input: { club: Club; objective: ParsedObjective; match?: string },
  deps: GoalSearchDeps = defaultGoalDeps(input.club),
): Promise<GoalSearch> {
  const club = CLUBS[input.club];
  const intents = goalIntents(input.objective, club.sport);
  const attempts: GoalRun["attempts"] = [];
  const terms = club.library.teamTerms;
  const empty = { videos: 0, indexed: 0 };

  let discovery: Discovery;
  try {
    discovery = await discoverVideos(deps.scoreplay, { terms, filenameHints: [] }, { maxPerQuery: 200 });
    const tags = [...new Set(discovery.resolved.tags.map((t) => t.name))].slice(0, 5).join(", ") || "—";
    attempts.push({ service: "ScorePlay", query: terms.join(", "), outcome: discovery.videos.length ? "OK" : "EMPTY", detail: `${discovery.videos.length} video(s) · tags ${tags}` });
  } catch (err) {
    const code = err instanceof ScorePlayDiscoveryError ? err.code : "UPSTREAM_UNAVAILABLE";
    attempts.push({ service: "ScorePlay", query: terms.join(", "), outcome: "ERROR", code, detail: err instanceof Error ? err.message : String(err) });
    return { intents, library: empty, attempts, pool: [], search: { status: "UNAVAILABLE", code, message: "The ScorePlay media library could not be reached, so no footage is proposed." } };
  }
  const titles = discovery.videos.map((v) => v.asset.title);
  const library = { videos: discovery.videos.length, indexed: 0, latestSeason: latestSeason(titles) };
  if (discovery.videos.length === 0) {
    return { intents, library, attempts, pool: [], search: { status: "NO_MATCHING_MOMENT", message: `No ScorePlay video is tagged ${terms.join(" or ")}.` } };
  }

  try {
    const { sdk, indexId } = deps.twelvelabs();
    const catalog = await loadCatalog(sdk, indexId);
    const { links } = linkToIndex(discovery.videos, catalog.entries);
    const indexed = { ...library, indexed: links.length, indexName: catalog.indexName };
    if (links.length === 0) {
      attempts.push({ service: "TwelveLabs", query: "index catalog", outcome: "EMPTY", detail: `index ${catalog.indexName ?? indexId}: 0 of ${discovery.videos.length} videos indexed` });
      return {
        intents,
        library: indexed,
        attempts,
        pool: [],
        search: { status: "NOT_INDEXED", message: `None of the ${discovery.videos.length} ${club.label} videos in ScorePlay is in the video-intelligence index ${catalog.indexName ?? indexId}, so no moment can be found yet.` },
      };
    }

    const byVideo = new Map<string, LinkedVideo>(
      links.map((l) => [
        l.entry.videoId,
        { asset: l.video.asset, discoveredBy: l.video.discoveredBy, mapping: { via: l.via, indexedScoreplayId: l.entry.customId, filename: l.entry.filename ?? l.video.asset.title } },
      ]),
    );
    const searchOptions: ("visual" | "audio")[] = catalog.searchOptions.includes("visual") ? ["visual"] : ["audio"];
    const videoIds = [...byVideo.keys()];
    const settled = await Promise.allSettled(intents.map((intent) => searchMoments(sdk, indexId, intent.query, { videoIds, limit: MOMENTS_PER_INTENT, searchOptions })));
    const results = intents.flatMap((intent, i) => {
      const s = settled[i];
      if (s.status === "fulfilled") {
        attempts.push({ service: "TwelveLabs", query: intent.query, outcome: s.value.length ? "OK" : "EMPTY", detail: `${s.value.length} moment(s) in ${catalog.indexName ?? indexId}` });
        return [{ intent, moments: s.value }];
      }
      const issue = classifyTwelveLabsError(s.reason, "search");
      attempts.push({ service: "TwelveLabs", query: intent.query, outcome: "ERROR", code: issue.code, detail: issue.message });
      return [];
    });
    if (results.length === 0) {
      const code = attempts.findLast((a) => a.code)?.code;
      return { intents, library: indexed, attempts, pool: [], search: { status: "UNAVAILABLE", code, message: "Video intelligence is unavailable right now, so no moment can be proposed." } };
    }

    const ranked = rankMoments(results, byVideo, { objective: input.objective, match: input.match, latestSeason: library.latestSeason });
    const previews = new Map<string, Preview>();
    if (deps.previews) {
      const wanted = [...new Set(ranked.flatMap((r) => r.candidate.twelveLabsVideoId ?? []))].slice(0, PREVIEW_VIDEOS);
      await Promise.all(
        wanted.map(async (videoId) => {
          const proxy = byVideo.get(videoId)?.asset.previewUrl;
          if (proxy?.startsWith("https://")) {
            previews.set(videoId, { source: "SCOREPLAY_PROXY", url: proxy, hls: /\.m3u8(\?|$)/.test(proxy) });
            return;
          }
          const hls = await videoStream(sdk, indexId, videoId);
          if (hls) previews.set(videoId, { source: "TWELVELABS_STREAM", url: hls, hls: true });
        }),
      );
    }
    const unavailable = deps.previews
      ? "Neither ScorePlay nor TwelveLabs returned a browser-playable stream for this video."
      : "In-app video preview is switched off (PULSE_VIDEO_PREVIEW=off).";
    const pool = ranked.map((r) => {
      const videoId = r.candidate.twelveLabsVideoId;
      return withPreview(r, videoId ? previews.get(videoId) : undefined, unavailable);
    });
    const moments = results.reduce((n, r) => n + r.moments.length, 0);
    return {
      intents,
      library: indexed,
      attempts,
      pool,
      search: pool.length
        ? {
            status: "FOUND",
            message: `TwelveLabs searched ${links.length} indexed ${club.label} videos with ${results.length} questions for this goal and returned ${moments} hits, grouped into ${pool.length} distinct moments.`,
          }
        : { status: "NO_MATCHING_MOMENT", code: "NO_SEARCH_RESULTS", message: "TwelveLabs found no moment in the indexed videos for this goal." },
    };
  } catch (err) {
    const issue: TwelveLabsError = err instanceof TwelveLabsError ? err : classifyTwelveLabsError(err, "search");
    attempts.push({ service: "TwelveLabs", query: "index", outcome: "ERROR", code: issue.code, detail: issue.message });
    return {
      intents,
      library,
      attempts,
      pool: [],
      search: {
        status: issue.code === "EMPTY_INDEX" ? "NOT_INDEXED" : "UNAVAILABLE",
        code: issue.code,
        message:
          issue.code === "MISSING_API_KEY" || issue.code === "MISSING_INDEX_ID"
            ? "Video intelligence is not configured (TwelveLabs key or index missing), so no moment can be found."
            : issue.code === "INDEX_NOT_ACCESSIBLE"
              ? `The ${club.label} video-intelligence index is not accessible with the configured key.`
              : "Video intelligence is unavailable right now, so no moment can be proposed.",
      },
    };
  }
}
