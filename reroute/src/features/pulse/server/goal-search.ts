import type { MediaRef } from "@/lib/contracts";
import { mapMediaToAsset } from "@/lib/scoreplay/map";
import { CLUBS } from "../clubs";
import { goalIntents } from "../goal-intents";
import { goalTerms, latestSeason, rankByMetadata, rankMoments, type LinkedVideo, type MetadataVideo } from "../moment-ranking";
import { objectiveMarkets } from "../objective-parser";
import type { Club, GoalRun, MatchFilter, ParsedObjective } from "../types";
import { candidateMapping, defaultMediaDeps, linkDiscovered, mappingAttempt, openIndex, stageIssue, type MediaDeps } from "./media-lookup";
import { ScorePlayDiscoveryError, discoverVideos, getMedia, resolveTags, searchMediaPages, type DiscoveredVideo, type Discovery, type ScorePlayHttp } from "./scoreplay-discovery";
import { classifyTwelveLabsError, searchMoments } from "./twelvelabs-moments";

/** Moments per question: one page; enough for agreement between questions to show. */
const MOMENTS_PER_INTENT = 12;

/** Preview stream URLs are not part of a goal search (they are resolved at view time via `previewFor` in lib/media). */
export type GoalSearchDeps = MediaDeps;

/** The club's index: `PULSE_TWELVELABS_INDEX_ID_<CLUB>` when configured, else the shared `TWELVELABS_INDEX_ID`. */
export function defaultGoalDeps(club: Club): GoalSearchDeps {
  return defaultMediaDeps(club);
}

export type GoalSearch = Pick<GoalRun, "intents" | "library" | "search" | "attempts" | "pool" | "matchFilter" | "playerFilter">;

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

/** Capitalized words of the goal that could name a person ("Solanke's" → "Solanke", "Wembanyama-led" → "Wembanyama"); club names are excluded. */
function nameCandidates(goal: string, exclude: readonly string[]): string[] {
  const skip = new Set(exclude.flatMap((e) => e.toLowerCase().split(/[^\p{L}]+/u)));
  const words = goal.match(/\p{Lu}[\p{L}-]{3,}/gu) ?? [];
  // A lower-case hyphen suffix is an English compound ("-led", "-inspired"), not part of a name ("Solanke-Mitchell").
  const names = words.map((w) => w.replace(/['’]s$/u, "").replace(/-\p{Ll}[\p{L}-]*$/u, ""));
  return [...new Set(names.filter((w, i) => w.length >= 4 && !(i === 0 && goal.trimStart().startsWith(words[i]!)) && !skip.has(w.toLowerCase())))].slice(0, 3);
}

/** Concurrent `GET /media/{id}` reads when ranking an un-indexed library on exact ScorePlay metadata. */
const METADATA_REFINE_CONCURRENCY = 8;
/** Upper bound of ScorePlay reads for the metadata ranking (a named player narrows the library well below this). */
const METADATA_MAX_VIDEOS = 60;

/**
 * An un-indexed library, ranked on exact ScorePlay metadata (`GET /media/{id}`: full tags and nanosecond duration),
 * only when the goal gives a ScorePlay signal to rank on — a tagged player it names, or a sponsor it names that
 * ScorePlay tags. Otherwise nothing is proposed (a library ranked on nothing would be a guess).
 */
async function rankUnindexed(
  http: ScorePlayHttp,
  videos: readonly DiscoveredVideo[],
  unmapped: readonly MediaRef[],
  ctx: { objective: ParsedObjective; player?: string; exclude: readonly string[] },
): Promise<GoalSearch["pool"]> {
  const sponsorTerms = goalTerms(ctx.objective.raw, ctx.exclude);
  if (!ctx.player && sponsorTerms.length === 0) return [];
  const refs = new Map(unmapped.map((r) => [r.scoreplayMediaId, r]));
  const subset = videos.filter((v) => refs.has(v.asset.id)).slice(0, METADATA_MAX_VIDEOS);
  const exact: MetadataVideo[] = [];
  for (let i = 0; i < subset.length; i += METADATA_REFINE_CONCURRENCY) {
    const batch = subset.slice(i, i + METADATA_REFINE_CONCURRENCY);
    const read = await Promise.all(batch.map(async (v) => ({ v, asset: mapMediaToAsset(await getMedia(http, v.asset.id), []) })));
    exact.push(...read.map(({ v, asset }) => ({ asset, discoveredBy: v.discoveredBy, media: refs.get(v.asset.id)! })));
  }
  return rankByMetadata(exact, { objective: ctx.objective, player: ctx.player, sponsorTerms });
}

/**
 * A player the goal names, resolved the way ScorePlay documents "find medias": `GET /tag/search` turns the name into
 * a player id (whole-word match, e.g. "Solanke" → "Dominic Ayodele Solanke-Mitchell"), then `POST /media/search`
 * with `any_players` lists the videos ScorePlay TAGS with that player. The goal's search is restricted to those
 * videos. Nothing is inferred from footage; no, or more than one, matching player leaves the library unfiltered.
 */
export async function filterByPlayer(
  http: ScorePlayHttp,
  videos: readonly DiscoveredVideo[],
  goal: string,
  exclude: readonly string[],
): Promise<{ videos: DiscoveredVideo[]; filter?: MatchFilter; query?: string }> {
  const terms = nameCandidates(goal, exclude);
  if (!terms.length) return { videos: [...videos] };
  const resolved = await resolveTags(http, terms);
  if (resolved.players.length !== 1) return { videos: [...videos] };
  const player = resolved.players[0];
  const tagged = await searchMediaPages(http, { any_players: [player.id], media_type: "video" }, { maxItems: 200 });
  const ids = new Set(tagged.media.map((m) => String(m.ID)));
  const kept = videos.filter((v) => ids.has(v.asset.id));
  if (!kept.length) return { videos: [...videos] };
  return { videos: kept, filter: { requested: player.name, status: "APPLIED", videos: kept.length }, query: terms.join(", ") };
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
  let playerFilter: MatchFilter | undefined;
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
  const before = videos.length;
  try {
    // The partner the goal promotes is never a search term: it names who the post is for, not what the footage shows.
    const player = await filterByPlayer(deps.scoreplay, videos, input.objective.raw, [club.label, ...terms, ...(input.match ? [input.match] : []), input.objective.targetSponsor ?? ""]);
    if (player.filter) {
      videos = player.videos;
      playerFilter = player.filter;
      attempts.push({ service: "ScorePlay", query: `player: ${player.query}`, outcome: "OK", detail: `${player.filter.videos} of ${before} video(s) tagged with ${player.filter.requested}` });
    }
  } catch (err) {
    attempts.push({ service: "ScorePlay", query: "player tag", outcome: "ERROR", detail: err instanceof Error ? err.message : String(err) });
  }
  const titles = videos.map((v) => v.asset.title);
  const library = { videos: videos.length, indexed: 0, latestSeason: latestSeason(titles) };
  if (videos.length === 0) {
    return { intents, library, attempts, pool: [], matchFilter, playerFilter, search: { status: "NO_MATCHING_MOMENT", message: `No ScorePlay video is tagged ${terms.join(" or ")}.` } };
  }

  try {
    const { sdk, indexId, catalog, media } = await openIndex(deps);
    const indexLabel = catalog.indexName ?? indexId;
    const { links, ambiguous, unmapped } = linkDiscovered(videos, media);
    const mapping = mappingAttempt(ambiguous, unmapped, indexLabel);
    if (mapping) attempts.push(mapping);
    const indexed = { ...library, indexed: links.length, indexName: catalog.indexName };
    if (links.length === 0) {
      if (!ambiguous.length) {
        const exclude = [club.label, ...terms, ...(input.match ? [input.match] : []), ...objectiveMarkets(input.objective).flatMap((m) => [m.matched, m.label]), input.objective.product?.matched ?? ""];
        const pool = await rankUnindexed(deps.scoreplay, videos, unmapped, { objective: input.objective, player: playerFilter?.requested, exclude });
        if (pool.length) {
          attempts.push({ service: "ScorePlay", query: "metadata ranking (not indexed)", outcome: "OK", detail: `${pool.length} whole clip(s) ranked on ScorePlay tags of ${Math.min(unmapped.length, METADATA_MAX_VIDEOS)} video(s); no moment search` });
          return {
            intents,
            library: indexed,
            attempts,
            pool,
            matchFilter,
            playerFilter,
            search: {
              status: "NOT_INDEXED",
              message: `None of the ${videos.length} ${club.label} videos is in the video-intelligence index ${indexLabel}, so no moment inside a clip can be located. PULSE ranked whole ScorePlay clips on their ScorePlay tags instead — nothing in them has been visually analysed.`,
            },
          };
        }
      }
      return {
        intents,
        library: indexed,
        attempts,
        pool: [],
        matchFilter,
        playerFilter,
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
      return { intents, library: indexed, attempts, pool: [], matchFilter, playerFilter, search: { status: "UNAVAILABLE", code, message: "Video intelligence is unavailable right now, so no moment can be proposed." } };
    }

    const o = input.objective;
    const exclude = [
      club.label,
      ...terms,
      ...(input.match ? [input.match, ...(OPPONENT_ALIASES[input.match.toLowerCase()] ?? [])] : []),
      ...objectiveMarkets(o).flatMap((m) => [m.matched, m.label]),
      o.product?.matched ?? "",
      o.targetSponsor ?? "",
    ];
    const pool = rankMoments(results, byVideo, { objective: o, match: input.match, latestSeason: library.latestSeason, goalTerms: goalTerms(o.raw, exclude) });
    const moments = results.reduce((n, r) => n + r.moments.length, 0);
    return {
      intents,
      library: indexed,
      attempts,
      pool,
      matchFilter,
      playerFilter,
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
      playerFilter,
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
