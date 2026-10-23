import { setTimeout as delay } from "node:timers/promises";
import type { Asset, Decision, EditPlan, Evidence, PublishIntent } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { reportProvenance, trackProvenance, type RunProvenance } from "@/lib/media/provenance";
import { demoReplayEnabled } from "@/lib/media/replay";
import { evaluateEdit, type AnalysisStatus, type Policy } from "@/lib/rights";
import { getScorePlayClient } from "@/lib/scoreplay";
import type { ScorePlayMedia } from "@/lib/scoreplay/schemas";
import { combineDecisions } from "@/lib/server/decide";
import { listHumanObservations } from "@/lib/server/store";
import { CLUBS } from "../clubs";
import { proposedPublishAt } from "../goal-campaign";
import { goalIntents } from "../goal-intents";
import type { Club, GoalIntent, GoalPlan, GoalRun, ParsedObjective, PhotoSuggestion, Recommendation } from "../types";
import { ScorePlayDiscoveryError, defaultScorePlayHttp, resolveTags, searchMediaPages } from "./scoreplay-discovery";

/**
 * "Photos from the club library": up to three real ScorePlay photos that fit the goal, chosen from METADATA
 * ONLY — caption (`description`), person tags, event folder and orientation. Photos are not in the
 * video-intelligence index, so nothing about the image itself is known; every photo is then evaluated by the
 * REROUTE engine for the run's planned uses with analysis NOT_CONFIGURED (honest result: sales and sponsored
 * uses need a human look). Only the ScorePlay thumbnail URL leaves this module, on the suggestion itself; the API
 * boundary (`forMediaAccess`) strips it for anyone but a signed-in reviewer with MEDIA_PREVIEW_ENABLED.
 *
 * Work per goal is capped: one paginated `POST /media/search` listing of the club's photos (cached 10 min per
 * process) and at most `DETAIL_READS` `GET /media/{id}` reads for the best candidates (cached 10 min). Reads go
 * through lib/media's replayable ScorePlay path, so DEMO_REPLAY keeps working; a read that is not recorded
 * degrades to "no photos" with a note and never fails the goal.
 */

export const PHOTO_LIMIT = 3;
/** `GET /media/{id}` reads per goal (people, orientation and event come only from the full media object). */
const DETAIL_READS = 12;
/** One search page holds the whole club library (418 Tottenham photos); ScorePlay accepts per_page up to 500. */
const LIST_PAGE = 500;
const CACHE_TTL_MS = 10 * 60_000;
/** Longest the photos may delay the goal once its moments are known. */
const BUDGET_AFTER_MOMENTS_MS = 1_200;
const CAPTION_MAX = 160;

/** Photos have no machine analysis: the engine sees exactly that (never a fabricated observation). */
export const PHOTO_ANALYSIS: AnalysisStatus = { status: "NOT_CONFIGURED", detail: "photos are not analysed by video intelligence" };

/** One photo as `POST /media/search` lists it (no tags there: those need `GET /media/{id}`). */
export type PhotoSummary = { id: string; filename: string; caption?: string; playerIds: number[]; eventId?: number };

/** A photo with its full ScorePlay metadata (from the media object). */
export type PhotoCandidate = PhotoSummary & {
  people: string[];
  event?: { label: string; match: string };
  orientation: PhotoSuggestion["orientation"];
};

/** What the top video moments carry that a photo can share: tagged people and their match. */
export type MomentContext = { index: number; people: string[]; playerIds: number[]; match?: string };

export type PhotoDeps = {
  listPhotos(club: Club): Promise<PhotoSummary[]>;
  getAsset(id: string): Promise<Asset>;
  humanObservations(id: string): Promise<Evidence[]>;
  now(): Date;
};

export type PhotoInput = {
  club: Club;
  objective: ParsedObjective;
  plan: GoalPlan;
  /** The goal's top moments, once the video search has answered. */
  moments: Promise<readonly Recommendation[]>;
  /** The run's rule package (`deps.policies(run.club, run.policy?.packageId)`). */
  policies: Promise<readonly Policy[]>;
};

export type PhotoResult = { photos: PhotoSuggestion[]; note?: string; attempt: GoalRun["attempts"][number] };

// ---------- Ranking (pure) ----------

/** Caption cues per goal intent (`goal-intents.ts` keys) and how a reason names them. */
const CAPTION_CUES: Record<string, { re: RegExp; phrase: string }> = {
  kit: { re: /\b(shirts?|kits?|jerseys?|crests?|badges?)\b/i, phrase: "a match shirt" },
  celebration: { re: /\bcelebrat\w*/i, phrase: "a celebration" },
  "fans-colours": { re: /\b(fans|supporters|away end|crowd)\b/i, phrase: "supporters" },
  "player-fan-bond": { re: /\b(applaud\w*|thank\w*|acknowledg\w*|salut\w*)\b[^.]*\b(fans|supporters|crowd)\b/i, phrase: "a player with the supporters" },
  score: { re: /\b(scor(?:e|es|ed|ing)|goal|dunk\w*|three[- ]pointer|lay-?up)\b/i, phrase: "scoring" },
  "near-miss": { re: /\b(shot|shoots|chance|crossbar|misses)\b/i, phrase: "a chance" },
  save: { re: /\b(saves?|saved|goalkeeper|blocks?|blocked)\b/i, phrase: "a save" },
  atmosphere: { re: /\b(atmosphere|stadium|arena|warm[- ]?up|tunnel)\b/i, phrase: "the matchday atmosphere" },
  "to-camera": { re: /\b(poses?|posing|smil\w*|camera)\b/i, phrase: "a pose to camera" },
};

const W = { secondaryCue: 0.3, momentPerson: 0.4, sameMatch: 0.1, portrait: 0.2, personTag: 0.05, personTagsMax: 0.15 };

export type ScoredPhoto<P extends PhotoSummary = PhotoCandidate> = { photo: P; score: number; primary?: string; sharesMomentPerson: boolean; matchReason: string };

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const pad = (n: number) => String(n).padStart(2, "0");
const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();

/** Goal intents the caption names, strongest first ("applauds the fans" is the bond, not a crowd shot). */
function cuesOf(caption: string | undefined, intents: readonly GoalIntent[]): GoalIntent[] {
  if (!caption) return [];
  const hit = intents.filter((i) => CAPTION_CUES[i.key]?.re.test(caption));
  const bond = hit.some((i) => i.key === "player-fan-bond");
  return hit.filter((i) => !(bond && i.key === "fans-colours")).sort((a, b) => b.weight - a.weight);
}

/**
 * Score of one photo for the goal, from metadata only: caption cues (weighted by the goal's intents), people
 * who also appear in the top moments (by ScorePlay person tag), same match as a moment, portrait for a
 * vertical post, people tagged. Works on a search summary (pre-ranking) and on full metadata.
 */
export function scorePhoto<P extends PhotoSummary>(photo: P & Partial<PhotoCandidate>, intents: readonly GoalIntent[], moments: readonly MomentContext[]): ScoredPhoto<P> {
  const cues = cuesOf(photo.caption, intents);
  const people = photo.people ?? [];
  const reasons: string[] = [];
  let score = cues.reduce((s, c, i) => s + (i === 0 ? c.weight : W.secondaryCue * c.weight), 0);
  if (cues.length) reasons.push(`caption mentions ${list(cues.map((c) => CAPTION_CUES[c.key].phrase))}`);

  const shared = moments.flatMap((m) => {
    const names = people.filter((p) => m.people.some((q) => norm(q) === norm(p)));
    const ids = photo.playerIds.filter((id) => m.playerIds.includes(id));
    return names.length || ids.length ? [{ m, names }] : [];
  });
  if (shared.length) {
    score += W.momentPerson;
    const first = shared[0];
    if (first.names.length) reasons.push(`tagged ${list(first.names)}, who also ${first.names.length > 1 ? "appear" : "appears"} in moment ${pad(first.m.index)}`);
  }
  const match = photo.event?.match;
  const sameMatch = match ? moments.find((m) => m.match && norm(m.match) === norm(match)) : undefined;
  if (sameMatch) {
    score += W.sameMatch;
    reasons.push(`same match as moment ${pad(sameMatch.index)}`);
  }
  if (photo.orientation === "PORTRAIT") {
    score += W.portrait;
    reasons.push("portrait, suits a vertical social post");
  }
  if (people.length) {
    score += Math.min(W.personTagsMax, W.personTag * people.length);
    if (!shared.length || !shared[0].names.length) reasons.push(`tagged ${list(people.slice(0, 3))}${people.length > 3 ? ` and ${people.length - 3} more` : ""}`);
  }
  const text = reasons.join("; ");
  const matchReason = text ? `${text[0].toUpperCase()}${text.slice(1)}.` : "";
  return { photo, score: Math.round(score * 1000) / 1000, primary: cues[0]?.key, sharesMomentPerson: shared.length > 0, matchReason };
}

/**
 * Best photos first, one per caption (sequence shots share a caption), preferring a different leading intent
 * for each pick (a shirt, the supporters, a celebration) before repeating one. Ties: ScorePlay id. A photo is
 * only suggested for a reason tied to the goal: a caption cue or a person shared with a moment.
 */
export function rankPhotos<P extends PhotoSummary>(
  photos: readonly (P & Partial<PhotoCandidate>)[],
  intents: readonly GoalIntent[],
  moments: readonly MomentContext[],
  limit: number = PHOTO_LIMIT,
): ScoredPhoto<P>[] {
  const scored = photos
    .map((p) => scorePhoto(p, intents, moments))
    .filter((s) => s.primary || s.sharesMomentPerson)
    .sort((a, b) => b.score - a.score || a.photo.id.localeCompare(b.photo.id));
  const captions = new Set<string>();
  const unique = scored.filter((s) => {
    const key = s.photo.caption ? norm(s.photo.caption) : `#${s.photo.id}`;
    if (captions.has(key)) return false;
    captions.add(key);
    return true;
  });
  const picked: ScoredPhoto<P>[] = [];
  const leads = new Set<string | undefined>();
  for (const s of unique) {
    if (picked.length >= limit) break;
    if (!leads.has(s.primary)) {
      picked.push(s);
      leads.add(s.primary);
    }
  }
  for (const s of unique) {
    if (picked.length >= limit) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.sort((a, b) => b.score - a.score || a.photo.id.localeCompare(b.photo.id));
}

// ---------- ScorePlay metadata → candidates ----------

export function photoSummary(m: ScorePlayMedia): PhotoSummary {
  const eventId = m.event_id || m.event?.ID || undefined;
  return {
    id: String(m.ID),
    filename: m.name || `ScorePlay media ${m.ID}`,
    ...(m.description?.trim() ? { caption: m.description.trim() } : {}),
    playerIds: m.player_ids ?? [],
    ...(eventId ? { eventId } : {}),
  };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const nums = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : []);

/**
 * ScorePlay `event` as a folder label from the match onward ("Manchester United vs Tottenham Hotspur - Week 6 ·
 * Match · Dressing Room"; `full_path` holds the parents with id prefixes) and the match folder itself.
 */
function eventOf(asset: Asset): PhotoCandidate["event"] {
  const e = asset.metadata.event as { name?: unknown; fullPath?: unknown } | undefined;
  const name = str(e?.name);
  const folders = [
    ...(str(e?.fullPath)
      ?.split("/")
      .map((s) => s.replace(/^\d+:/, "").trim())
      .filter(Boolean) ?? []),
    ...(name ? [name] : []),
  ];
  if (!folders.length) return undefined;
  const at = folders.findIndex((f) => /\s(vs?\.?|@)\s/i.test(f));
  const fromMatch = at >= 0 ? folders.slice(at) : folders.slice(-1);
  return { label: fromMatch.join(" · "), match: fromMatch[0] };
}

/** From the `metadata:` tags ScorePlay sets on every photo ("Portrait"/"Landscape", else "WxH"). */
export function orientationOf(tags: readonly string[]): PhotoCandidate["orientation"] {
  const named = tags.find((t) => /^(portrait|landscape|square)$/i.test(t.trim()));
  if (named) return named.trim().toUpperCase() as PhotoCandidate["orientation"];
  const dims = tags.map((t) => /^(\d+)\s*x\s*(\d+)$/i.exec(t.trim())).find(Boolean);
  if (!dims) return "UNKNOWN";
  const [w, h] = [Number(dims[1]), Number(dims[2])];
  return w === h ? "SQUARE" : h > w ? "PORTRAIT" : "LANDSCAPE";
}

export function photoCandidate(summary: PhotoSummary, asset: Asset): PhotoCandidate {
  const caption = str(asset.metadata.description) ?? summary.caption;
  const event = eventOf(asset);
  const playerIds = nums(asset.metadata.playerIds);
  return {
    ...summary,
    filename: asset.title || summary.filename,
    ...(caption ? { caption } : {}),
    playerIds: playerIds.length ? playerIds : summary.playerIds,
    people: asset.facts.people ?? [],
    ...(event ? { event } : {}),
    orientation: orientationOf(asset.tags),
  };
}

// ---------- Rights ----------

/**
 * The real engine on a one-segment edit of the photo (`0–1 s`: a still has no timeline), for every planned
 * channel × territory, with HUMAN observations only (no machine analysis exists for photos).
 */
export function photoRights(asset: Asset, observations: readonly Evidence[], plan: GoalPlan, policies: readonly Policy[], now: Date): PhotoSuggestion["rights"] {
  const edit: EditPlan = { id: `photo-${asset.id}`, title: asset.title, segments: [{ scoreplayMediaId: asset.id, start: 0, end: 1 }], derived: false };
  const publishAt = proposedPublishAt(now);
  const intents: PublishIntent[] = plan.channels.flatMap((platform) =>
    plan.territories.map((territory) => ({ territory, platform, usage: plan.usage, competition: plan.competition, publishAt, club: plan.club })),
  );
  const decisions: Decision[] = intents.map(
    (intent) =>
      evaluateEdit({ edit, assets: { [asset.id]: asset }, observations: { [asset.id]: [...observations] }, analysis: { [asset.id]: PHOTO_ANALYSIS }, intent, now, policies }).decision,
  );
  const overall = combineDecisions(decisions, now);
  const worst = decisions.find((d) => d.verdict === overall.verdict) ?? decisions[0];
  const reason = worst?.reasons.find((r) => r.outcome !== "PERMIT")?.explanation;
  return {
    verdict: overall.verdict,
    clearance: overall.clearance,
    allowedUses: decisions.filter((d) => d.verdict === "ALLOWED").length,
    totalUses: decisions.length,
    demoPolicy: decisions.some((d) => d.policyFictional || d.clearance === "DEMO"),
    ...(reason ? { reason } : {}),
  };
}

// ---------- Orchestration ----------

async function humanOnly(deps: PhotoDeps, id: string): Promise<Evidence[]> {
  try {
    return await deps.humanObservations(id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_CONFIGURED") return [];
    throw err;
  }
}

const settledValue = <T>(p: Promise<T>): Promise<T | undefined> => p.then((v) => v, () => undefined);

async function suggest(input: PhotoInput, deps: PhotoDeps): Promise<PhotoResult> {
  const intents = goalIntents(input.objective, CLUBS[input.club].sport);
  // The library listing starts at once (in parallel with the video search); the moments' people as soon as they are known.
  const [library, moments] = await Promise.all([
    deps.listPhotos(input.club),
    settledValue(input.moments).then((top = []) =>
      Promise.all(
        top.slice(0, PHOTO_LIMIT).map(async (r, i): Promise<MomentContext> => {
          const asset = await settledValue(deps.getAsset(r.candidate.scoreplayAssetId));
          return { index: i + 1, people: asset?.facts.people ?? [], playerIds: asset ? nums(asset.metadata.playerIds) : [], match: asset && eventOf(asset)?.match };
        }),
      ),
    ),
  ]);

  // Pre-rank on what the listing carries (caption, person ids), then read the best few in full.
  const shortlist = rankPhotos(library, intents, moments, DETAIL_READS);
  const detailed = await Promise.all(
    shortlist.map(async ({ photo }) => {
      const asset = await settledValue(deps.getAsset(photo.id));
      return asset && asset.kind === "image" ? { candidate: photoCandidate(photo, asset), asset } : undefined;
    }),
  );
  const loaded = detailed.filter((d) => d !== undefined);
  if (shortlist.length && !loaded.length) throw new ScorePlayDiscoveryError("UPSTREAM_UNAVAILABLE", `ScorePlay GET /media/{id}: none of ${shortlist.length} shortlisted photo(s) could be read`);
  const ranked = rankPhotos(
    loaded.map((d) => d.candidate),
    intents,
    moments,
  );
  const policies = await input.policies;
  const now = deps.now();
  const photos = (
    await Promise.all(
      ranked.map(async ({ photo, matchReason }): Promise<PhotoSuggestion | undefined> => {
        const asset = loaded.find((d) => d.candidate.id === photo.id)!.asset;
        const observations = await settledValue(humanOnly(deps, photo.id));
        // Without the reviewer-observation store answering, no verdict is claimed for this photo.
        if (!observations) return undefined;
        const caption = photo.caption && photo.caption.length > CAPTION_MAX ? `${photo.caption.slice(0, CAPTION_MAX - 1).trimEnd()}…` : photo.caption;
        const event = photo.event?.label;
        return {
          scoreplayMediaId: photo.id,
          filename: photo.filename,
          ...(caption ? { caption } : {}),
          people: photo.people,
          ...(event ? { event } : {}),
          orientation: photo.orientation,
          matchReason,
          rights: photoRights(withoutUrls(asset), observations, input.plan, policies, now),
          ...(asset.thumbnailUrl?.startsWith("https://") ? { thumbnailUrl: asset.thumbnailUrl } : {}),
        };
      }),
    )
  ).filter((p) => p !== undefined);
  return {
    photos,
    attempt: {
      service: "ScorePlay",
      query: "club photos (metadata only)",
      outcome: photos.length ? "OK" : "EMPTY",
      detail: `${library.length} photo(s) listed · ${loaded.length} read in full · ${photos.length} suggested`,
    },
  };
}

function unavailable(err: unknown): PhotoResult {
  const code = err instanceof ScorePlayDiscoveryError ? err.code : err instanceof AppError ? err.code : "UPSTREAM_UNAVAILABLE";
  const detail = err instanceof Error ? err.message : String(err);
  const note =
    demoReplayEnabled() && code === "UPSTREAM_UNAVAILABLE"
      ? "The club's photo library is not part of the demo recording, so no photo is suggested."
      : code === "MISSING_API_KEY"
        ? "ScorePlay is not configured, so no photo from the club library is suggested."
        : "The club's photo library could not be read from ScorePlay, so no photo is suggested.";
  return { photos: [], note, attempt: { service: "ScorePlay", query: "club photos (metadata only)", outcome: "ERROR", code, detail } };
}

const TIMED_OUT: PhotoResult = {
  photos: [],
  note: "ScorePlay's photo library did not answer in time, so no photo is suggested for this goal.",
  attempt: { service: "ScorePlay", query: "club photos (metadata only)", outcome: "ERROR", code: "TIMEOUT", detail: `no answer within ${BUDGET_AFTER_MOMENTS_MS} ms of the moments` },
};

/**
 * Up to three club photos for the goal, each with its REROUTE verdict. Starts listing the library at once (in
 * parallel with the video search) and gives up `BUDGET_AFTER_MOMENTS_MS` after the moments are known. Never
 * rejects: every failure is a result with a note.
 */
export async function suggestPhotos(input: PhotoInput, deps: PhotoDeps = defaultPhotoDeps): Promise<PhotoResult> {
  // A failed rule-package load fails the goal itself; here it only ends the photo step (awaited in `suggest`).
  input.policies.catch(() => undefined);
  const work = suggest(input, deps).catch(unavailable);
  const timer = new AbortController();
  const deadline = input.moments
    .then(
      () => delay(BUDGET_AFTER_MOMENTS_MS, TIMED_OUT, { signal: timer.signal, ref: false }),
      () => work,
    )
    .catch(() => work);
  try {
    return await Promise.race([work, deadline]);
  } finally {
    timer.abort();
  }
}

// ---------- Live deps (10-minute in-process caches) ----------

type Entry<T> = { at: number; value: Promise<{ value: T; provenance: RunProvenance | undefined }> };

/** Loads once per key per TTL; a reuse re-reports the original reads' provenance (LIVE or demo recording). */
function cachedLoad<T>(cache: Map<string, Entry<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.value.then((r) => {
      reportProvenance(r.provenance);
      return r.value;
    });
  }
  for (const [k, e] of cache) if (Date.now() - e.at >= CACHE_TTL_MS) cache.delete(k);
  const value = trackProvenance(load);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value.then((r) => r.value);
}

const libraryCache = new Map<string, Entry<PhotoSummary[]>>();
const assetCache = new Map<string, Entry<Asset>>();

/** The club's photos: team tag(s) resolved like the video discovery, then one `POST /media/search` page of photos. */
async function listClubPhotos(club: Club): Promise<PhotoSummary[]> {
  const http = defaultScorePlayHttp();
  const resolved = await resolveTags(http, CLUBS[club].library.teamTerms);
  if (!resolved.tags.length) return [];
  const page = await searchMediaPages(http, { any_tag_options: resolved.tags.map((t) => t.id), media_type: "photo" }, { perPage: LIST_PAGE, maxItems: LIST_PAGE });
  return page.media.filter((m) => m.type === "photo").map(photoSummary);
}

/** The asset as the engine sees it: no footage URL (the engine never needs one). */
function withoutUrls(asset: Asset): Asset {
  const { thumbnailUrl: _t, previewUrl: _p, ...rest } = asset;
  return rest;
}

export const defaultPhotoDeps: PhotoDeps = {
  listPhotos: (club) => cachedLoad(libraryCache, club, () => listClubPhotos(club)),
  getAsset: (id) => cachedLoad(assetCache, id, () => getScorePlayClient().getAsset(id)),
  humanObservations: listHumanObservations,
  now: () => new Date(),
};
