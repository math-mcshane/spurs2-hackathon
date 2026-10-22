import { CLUBS } from "../clubs";
import { goalIntents } from "../goal-intents";
import { latestSeason, rankMoments, type LinkedVideo } from "../moment-ranking";
import type { Club, GoalRun, MatchFilter, ParsedObjective } from "../types";
import { candidateMapping, defaultMediaDeps, linkDiscovered, mappingAttempt, openIndex, stageIssue, type MediaDeps } from "./media-lookup";
import { ScorePlayDiscoveryError, discoverVideos, type DiscoveredVideo, type Discovery } from "./scoreplay-discovery";
import { classifyTwelveLabsError, searchMoments } from "./twelvelabs-moments";

/** Moments per question: one page; enough for agreement between questions to show. */
const MOMENTS_PER_INTENT = 12;

/** Preview stream URLs are not part of a goal search (they are resolved at view time via `previewFor` in lib/media). */
export type GoalSearchDeps = MediaDeps;

/** The club's index: `PULSE_TWELVELABS_INDEX_ID_<CLUB>` when configured, else the shared `TWELVELABS_INDEX_ID`. */
export function defaultGoalDeps(club: Club): GoalSearchDeps {
  return defaultMediaDeps(club);
}

export type GoalSearch = Pick<GoalRun, "intents" | "library" | "search" | "attempts" | "pool" | "matchFilter">;

/** Names under which footage refers to a fixture's opponent (lower-case). */
const OPPONENT_ALIASES: Record<string, string[]> = {
  "manchester united": ["manchester united", "man utd", "man united", "mnu", "united"],
  "sacramento kings": ["sacramento kings", "sacramento", "kings", "sac"],
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Restrict to videos whose filename or tags name the requested opponent (word-boundary match). */
export function filterByMatch(videos: readonly DiscoveredVideo[], requested: string): { videos: DiscoveredVideo[]; filter: MatchFilter } {
  const key = requested.trim().toLowerCase();
  const names = OPPONENT_ALIASES[key] ?? Object.values(OPPONENT_ALIASES).find((a) => a.includes(key)) ?? [key];
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${names.map(escapeRegExp).join("|")})(?=$|[^\\p{L}\\p{N}])`, "iu");
  const kept = videos.filter((v) => re.test(v.asset.title) || v.asset.tags.some((t) => re.test(t)));
  return kept.length
    ? { videos: kept, filter: { requested, status: "APPLIED", videos: kept.length } }
    : { videos: [...videos], filter: { requested, status: "NOT_FOUND", videos: videos.length } };
}

/**
 * Goal → ranked real moments:
 *  1. ScorePlay lists the club's videos (team tag);
 *  2. each objective question is a TwelveLabs Marengo search restricted to those indexed videos;
 *  3. hits map back to ScorePlay assets with exact timestamps and are ranked for the objective.
 * Identity is lib/media's MediaResolver: AMBIGUOUS/UNMAPPED videos are reported as MAPPING_FAILED attempts.
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
    discovery = await discoverVideos(deps.scoreplay, { terms, filenameHints: [] }, { maxPerQuery: Number.POSITIVE_INFINITY });
    const tags = [...new Set(discovery.resolved.tags.map((t) => t.name))].slice(0, 5).join(", ") || "—";
    attempts.push({ service: "ScorePlay", query: terms.join(", "), outcome: discovery.videos.length ? "OK" : "EMPTY", detail: `${discovery.videos.length} video(s) · tags ${tags}` });
  } catch (err) {
    const code = err instanceof ScorePlayDiscoveryError ? err.code : "UPSTREAM_UNAVAILABLE";
    attempts.push({ service: "ScorePlay", query: terms.join(", "), outcome: "ERROR", code, detail: err instanceof Error ? err.message : String(err) });
    return { intents, library: empty, attempts, pool: [], search: { status: "UNAVAILABLE", code, message: "The ScorePlay media library could not be reached, so no footage is proposed." } };
  }
  let videos = discovery.videos;
  let matchFilter: MatchFilter | undefined;
  if (input.match) {
    ({ videos, filter: matchFilter } = filterByMatch(videos, input.match));
    attempts.push({
      service: "ScorePlay",
      query: `match: ${input.match}`,
      outcome: matchFilter.status === "APPLIED" ? "OK" : "EMPTY",
      detail:
        matchFilter.status === "APPLIED"
          ? `${matchFilter.videos} of ${discovery.videos.length} video(s) name ${input.match}`
          : `no video names ${input.match}; searching the whole ${club.label} library`,
    });
  }
  const titles = videos.map((v) => v.asset.title);
  const library = { videos: videos.length, indexed: 0, latestSeason: latestSeason(titles) };
  if (videos.length === 0) {
    return { intents, library, attempts, pool: [], matchFilter, search: { status: "NO_MATCHING_MOMENT", message: `No ScorePlay video is tagged ${terms.join(" or ")}.` } };
  }

  try {
    const { sdk, indexId, catalog, media } = await openIndex(deps);
    const indexLabel = catalog.indexName ?? indexId;
    const { links, ambiguous, unmapped } = linkDiscovered(videos, media);
    const mapping = mappingAttempt(ambiguous, unmapped, indexLabel);
    if (mapping) attempts.push(mapping);
    const indexed = { ...library, indexed: links.length, indexName: catalog.indexName };
    if (links.length === 0) {
      return {
        intents,
        library: indexed,
        attempts,
        pool: [],
        matchFilter,
        search: ambiguous.length
          ? {
              status: "NOT_INDEXED",
              code: "MAPPING_FAILED",
              message: `${ambiguous.length} ${club.label} video(s) match several indexed videos by filename and duration, and none can be linked uniquely, so no moment is proposed.`,
            }
          : { status: "NOT_INDEXED", message: `None of the ${videos.length} ${club.label} videos in ScorePlay is in the video-intelligence index ${indexLabel}, so no moment can be found yet.` },
      };
    }

    const byVideo = new Map<string, LinkedVideo>(
      links.map((l) => [l.ref.twelvelabsVideoId!, { asset: l.video.asset, discoveredBy: l.video.discoveredBy, mapping: candidateMapping(l), media: l.ref }]),
    );
    const searchOptions: ("visual" | "audio")[] = catalog.searchOptions.includes("visual") ? ["visual"] : ["audio"];
    const videoIds = [...byVideo.keys()];
    const settled = await Promise.allSettled(intents.map((intent) => searchMoments(sdk, indexId, intent.query, { videoIds, limit: MOMENTS_PER_INTENT, searchOptions })));
    const results = intents.flatMap((intent, i) => {
      const s = settled[i];
      if (s.status === "fulfilled") {
        // The search is restricted to linked videos; anything else is dropped, never mapped.
        const moments = s.value.filter((m) => byVideo.has(m.videoId));
        const dropped = s.value.length - moments.length;
        attempts.push({
          service: "TwelveLabs",
          query: intent.query,
          outcome: moments.length ? "OK" : "EMPTY",
          ...(dropped ? { code: "MAPPING_FAILED" } : {}),
          detail: `${moments.length} moment(s) in ${indexLabel}${dropped ? `; ${dropped} unlinkable hit(s) dropped` : ""}`,
        });
        return [{ intent, moments }];
      }
      const issue = classifyTwelveLabsError(s.reason, "search");
      attempts.push({ service: "TwelveLabs", query: intent.query, outcome: "ERROR", code: issue.code, detail: issue.message });
      return [];
    });
    if (results.length === 0) {
      const code = attempts.findLast((a) => a.outcome === "ERROR")?.code;
      return { intents, library: indexed, attempts, pool: [], matchFilter, search: { status: "UNAVAILABLE", code, message: "Video intelligence is unavailable right now, so no moment can be proposed." } };
    }

    const pool = rankMoments(results, byVideo, { objective: input.objective, match: input.match, latestSeason: library.latestSeason });
    const moments = results.reduce((n, r) => n + r.moments.length, 0);
    return {
      intents,
      library: indexed,
      attempts,
      pool,
      matchFilter,
      search: pool.length
        ? {
            status: "FOUND",
            message: `TwelveLabs searched ${links.length} indexed ${club.label} videos with ${results.length} questions for this goal and returned ${moments} hits, grouped into ${pool.length} distinct moments.`,
          }
        : { status: "NO_MATCHING_MOMENT", code: "NO_SEARCH_RESULTS", message: "TwelveLabs found no moment in the indexed videos for this goal." },
    };
  } catch (err) {
    const issue = stageIssue(err);
    attempts.push({ service: issue.service, query: "index", outcome: "ERROR", code: issue.code, detail: issue.message });
    return {
      intents,
      library,
      attempts,
      pool: [],
      matchFilter,
      search: {
        status: issue.code === "EMPTY_INDEX" ? "NOT_INDEXED" : "UNAVAILABLE",
        code: issue.code,
        message:
          issue.code === "MISSING_API_KEY" || issue.code === "MISSING_INDEX_ID"
            ? "Video intelligence is not configured (TwelveLabs key or index missing), so no moment can be found."
            : issue.code === "INDEX_NOT_ACCESSIBLE"
              ? `The ${club.label} video-intelligence index is not accessible with the configured key.`
              : issue.service === "ScorePlay"
                ? "The ScorePlay catalog needed to link footage could not be read, so no moment can be proposed."
                : "Video intelligence is unavailable right now, so no moment can be proposed.",
      },
    };
  }
}
