import type { GoalIntent, MediaCandidate, MomentMatch, ParsedObjective, Preview, Recommendation } from "./types";
import { isEvidenceLinkable, type Asset, type DataOrigin, type MediaRef } from "@/lib/contracts";

/**
 * Ranks live TwelveLabs moments against a business objective. Pure: the server passes in what the
 * index and ScorePlay actually returned; nothing here invents a clip or a timestamp.
 *
 *   relevance  = Σ over intents the moment matched of weight × K / (K + rank − 1), ÷ Σ all weights
 *   readiness  = how close the asset is to a social-ready cut (from its duration and filename)
 *   context    = 0.6 when the goal names a match and the filename marks an earlier season; × (1 + 0.5 × (n − 1))
 *                when the club's own ScorePlay title names n ≥ 2 of the goal's distinctive words ("Solanke's late
 *                goal" → "solanke late goal.mp4", ×2); else 1
 *   score      = (0.85 × relevance + 0.15 × readiness) × context
 *
 * A moment that several of the objective's questions independently found ranks higher: agreement
 * across queries is the evidence. Hackathon weights, shown to the user; not a sales predictor.
 */

export const RANKING = { relevance: 0.85, readiness: 0.15, k: 5, earlierSeason: 0.6, titleWord: 0.5 } as const;

/** One hit as returned by the TwelveLabs adapter (`origin` CACHED when served from a recorded response). */
export type RawMoment = { videoId: string; start: number; end: number; rank: number; thumbnailUrl?: string; origin?: DataOrigin };

/** A TwelveLabs video tied to a ScorePlay asset by the canonical MediaResolver (`linkCatalogs`). */
export type LinkedVideo = {
  asset: Asset;
  discoveredBy: MediaCandidate["discoveredBy"];
  media: MediaRef;
};

export type RankingContext = {
  objective: ParsedObjective;
  match?: string;
  /** Latest season marked in any library filename. */
  latestSeason?: string;
  /** Distinctive words of the goal (no club, market, product or filler words), lower-case. */
  goalTerms?: readonly string[];
};

/** "2020-21" from "…_20_21_…" or "…2026-27…"; only consecutive years count as a season. */
export function seasonOf(title: string): string | undefined {
  const long = /(?<!\d)(20\d{2})[-_/](\d{2})(?!\d)/.exec(title);
  if (long && (Number(long[1]) + 1) % 100 === Number(long[2])) return `${long[1]}-${long[2]}`;
  for (const m of title.matchAll(/(?<![\d])(\d{2})[-_](\d{2})(?![\d])/g)) {
    if ((Number(m[1]) + 1) % 100 === Number(m[2])) return `20${m[1]}-${m[2]}`;
  }
  return undefined;
}

export function latestSeason(titles: readonly string[]): string | undefined {
  return titles.flatMap((t) => seasonOf(t) ?? []).sort().at(-1);
}

/** Seconds → `m:ss` (minutes keep counting past 60, like a match clock). */
export function clock(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
const contribution = (weight: number, rank: number) => (weight * RANKING.k) / (RANKING.k + rank - 1);

/** Words common to every sports goal: never evidence that a title names what the goal asks for. */
const FILLER = new Set(
  "with from that this your their they them have more most into over about around after before during next last best big new club team fans fan supporters supporter followers people game games match matches season moment moments video videos post posts campaign campaigns activate drive grow promote maximize increase sell boost celebrate show share".split(" "),
);

/** Distinctive, ≥ 4-letter words of a goal, minus `exclude` (club names, the named fixture, parsed market/product words). */
export function goalTerms(goal: string, exclude: readonly string[]): string[] {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const skip = new Set(exclude.flatMap((e) => fold(e).split(/[^\p{L}\p{N}]+/u)));
  return [...new Set(fold(goal).replace(/['’]s\b/gu, "").split(/[^\p{L}\p{N}]+/u))].filter((w) => w.length >= 4 && !FILLER.has(w) && !skip.has(w));
}

/** Goal words the asset's ScorePlay title names (whole words). */
function titleHits(title: string, terms: readonly string[] | undefined): string[] {
  if (!terms?.length) return [];
  const words = new Set(title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u));
  return terms.filter((t) => words.has(t));
}

function readiness(asset: Asset): { value: number; note: string } {
  const d = asset.durationSec;
  if (/9\s*x\s*16|vertical/i.test(asset.title)) return { value: 100, note: "Vertical 9:16 edit (per filename) — ready for Reels and Stories." };
  if (d !== undefined && d <= 60) return { value: 70, note: `Short ${Math.round(d)}-second clip; reframe to 9:16 for Reels.` };
  if (d !== undefined && d > 300) return { value: 50, note: `Cut from a ${Math.round(d / 60)}-minute video at the exact timecode.` };
  return { value: 60, note: "Trim to 12–15 s at the exact timecode." };
}

const ACTION: Record<NonNullable<ParsedObjective["product"]>["key"] | "default", (where: string) => string> = {
  merch: (w) => `Post it to fans${w} with a link to the club store.`,
  jersey: (w) => `Post it to fans${w} with a link to the club's shirt range.`,
  tickets: (w) => `Post it to fans${w} with a link to ticketing.`,
  engagement: (w) => `Post it on club channels${w} and invite comments and shares.`,
  followers: (w) => `Post it on club channels${w} with a follow prompt.`,
  subscriptions: (w) => `Post it to fans${w} with a link to viewing options.`,
  sponsor: (w) => `Package it for the partner brief${w} — partner credit as contracted.`,
  default: (w) => `Post it on club channels${w}.`,
};

type Cluster = {
  videoId: string;
  link: LinkedVideo;
  matches: (MomentMatch & { weight: number; why: string; thumbnailUrl?: string; origin: DataOrigin })[];
};

/**
 * Turns per-intent TwelveLabs results into ranked recommendations. Hits on the same video whose
 * time ranges overlap are one moment; its cut is the strongest hit's exact boundaries.
 */
export function rankMoments(
  results: readonly { intent: GoalIntent; moments: readonly RawMoment[] }[],
  links: ReadonlyMap<string, LinkedVideo>,
  ctx: RankingContext,
): Recommendation[] {
  const clusters: Cluster[] = [];
  for (const { intent, moments } of results) {
    for (const m of moments) {
      const link = links.get(m.videoId);
      // Only a canonical 1:1 link may carry TwelveLabs evidence onto a ScorePlay asset.
      if (!link || !isEvidenceLinkable(link.media) || !(m.end > m.start)) continue;
      const match = {
        intent: intent.key,
        label: intent.label,
        query: intent.query,
        rank: m.rank,
        start: m.start,
        end: m.end,
        weight: intent.weight,
        why: intent.why,
        thumbnailUrl: m.thumbnailUrl,
        origin: m.origin ?? "LIVE",
      };
      const home = clusters.find((c) => c.videoId === m.videoId && c.matches.some((x) => overlaps(x, m)));
      if (home) home.matches.push(match);
      else clusters.push({ videoId: m.videoId, link, matches: [match] });
    }
  }

  const totalWeight = results.reduce((n, r) => n + r.intent.weight, 0) || 1;
  const objective = ctx.objective;
  const where = objective.market ? ` in ${objective.market.label}` : objective.scope === "GLOBAL" ? " worldwide" : "";
  const action = ACTION[objective.product?.key ?? "default"](where);

  const ranked = clusters.map((c): Recommendation => {
    // Best hit per intent: an intent counts once, however many overlapping hits it produced.
    const best = new Map<string, Cluster["matches"][number]>();
    for (const m of c.matches) {
      const prev = best.get(m.intent);
      if (!prev || m.rank < prev.rank) best.set(m.intent, m);
    }
    const supporting = [...best.values()].sort((a, b) => contribution(b.weight, b.rank) - contribution(a.weight, a.rank));
    const primary = supporting[0];
    const relevance = Math.round((100 * supporting.reduce((n, m) => n + contribution(m.weight, m.rank), 0)) / totalWeight);
    const ready = readiness(c.link.asset);
    const season = seasonOf(c.link.asset.title);
    const earlier = !!(ctx.match && season && ctx.latestSeason && season < ctx.latestSeason);
    const named = titleHits(c.link.asset.title, ctx.goalTerms);
    const titleFactor = named.length >= 2 ? 1 + RANKING.titleWord * (named.length - 1) : 1;
    const contextFactor = (earlier ? RANKING.earlierSeason : 1) * titleFactor;
    const score = Math.round((RANKING.relevance * relevance + RANKING.readiness * ready.value) * contextFactor);
    const asset = c.link.asset;
    const span = `${clock(primary.start)}–${clock(primary.end)}`;
    const seconds = Math.round(primary.end - primary.start);
    const evidence = supporting.map((m) => `#${m.rank} for “${m.query}”`).join(", ");

    const candidate: MediaCandidate = {
      scoreplayAssetId: asset.id,
      twelveLabsVideoId: c.videoId,
      title: asset.title,
      kind: asset.kind,
      thumbnailUrl: primary.thumbnailUrl ?? asset.thumbnailUrl,
      durationSec: asset.durationSec,
      startSeconds: primary.start,
      endSeconds: primary.end,
      competition: asset.facts.competition,
      recordedAt: asset.facts.recordedAt,
      foundBy: "TWELVELABS",
      discoveredBy: c.link.discoveredBy,
      rank: primary.rank,
      query: primary.query,
      // Never present a recorded (cached) search result as live.
      origin: supporting.some((m) => m.origin !== "LIVE") ? "CACHED" : "LIVE",
      mapping: { via: c.link.media.method as "AUTHORITATIVE_ID" | "FILENAME_DURATION", filename: c.link.media.match?.twelvelabsFilename ?? asset.title },
    };
    return {
      key: `${asset.id}@${primary.start}-${primary.end}`,
      candidate,
      media: c.link.media,
      duplicates: [],
      headline: primary.label,
      score,
      breakdown: {
        relevance,
        readiness: ready.value,
        contextFactor,
        notes: {
          relevance: `Matched ${supporting.length} of ${results.length} questions for this goal (${evidence}).`,
          readiness: ready.note,
          context: [
            earlier
              ? `Filename marks the ${season} season — an earlier meeting, not the match you named (×${RANKING.earlierSeason}).`
              : season
                ? `Filename marks the ${season} season.`
                : "No season marked in the filename.",
            titleFactor > 1 ? `The club's ScorePlay title names what the goal asks for (${named.join(", ")}) (×${titleFactor}).` : "",
          ]
            .filter(Boolean)
            .join(" "),
        },
      },
      matches: supporting.map(({ intent, label, query, rank, start, end }) => ({ intent, label, query, rank, start, end })),
      season,
      why: {
        opportunity:
          `${primary.why} — which serves “${objective.summary}”.` +
          (supporting.length > 1 ? ` Also matches: ${supporting.slice(1).map((m) => m.label.toLowerCase()).join(", ")}.` : ""),
        media: `TwelveLabs found this ${seconds}-second moment at ${span} in “${asset.title}” (${evidence}).`,
        action,
      },
      previewNote: "",
    };
  });

  return dedupe(diversify(ranked.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))));
}

/** Relevance points per ScorePlay signal when no video intelligence exists (shown in the breakdown). */
export const METADATA_RANKING = { player: 40, sponsor: 40, focus: { solo: 20, small: 10 } } as const;

/** A ScorePlay video of an un-indexed library with its real MediaRef (UNMAPPED: nothing can be observed in it). */
export type MetadataVideo = { asset: Asset; discoveredBy: MediaCandidate["discoveredBy"]; media: MediaRef };

/** Sponsors the goal names that ScorePlay tags on this asset (whole-word, case-insensitive). */
export function namedSponsors(asset: Asset, goalTerms: readonly string[]): string[] {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return (asset.facts.sponsors ?? []).filter((s) => fold(s).split(/[^\p{L}\p{N}]+/u).some((w) => goalTerms.includes(w)));
}

/**
 * Whole ScorePlay clips ranked on ScorePlay metadata ONLY, for a club whose footage is in no TwelveLabs index.
 * Nothing inside a clip has been observed: there is no moment, no timecode inside the clip and no visual evidence
 * (a missing sponsor tag never means a brand-free picture). Signals, all from ScorePlay tags:
 *   relevance = player tag (the goal's player) 40 + sponsor tag the goal names 40 + focus (1 player tagged 20, ≤ 3: 10)
 *   readiness = as for moments (vertical edit / short clip / needs trimming), from the filename and exact duration
 *   score     = 0.85 × relevance + 0.15 × readiness
 */
export function rankByMetadata(videos: readonly MetadataVideo[], ctx: RankingContext & { player?: string; sponsorTerms: readonly string[] }): Recommendation[] {
  const objective = ctx.objective;
  const where = objective.market ? ` in ${objective.market.label}` : objective.scope === "GLOBAL" ? " worldwide" : "";
  const action = ACTION[objective.product?.key ?? "default"](where);
  const ranked = videos.flatMap((v): Recommendation[] => {
    const asset = v.asset;
    const duration = asset.durationSec;
    if (asset.kind !== "video" || !duration || duration <= 0) return [];
    const people = asset.facts.people ?? [];
    const player = ctx.player && people.includes(ctx.player) ? ctx.player : undefined;
    const sponsors = namedSponsors(asset, ctx.sponsorTerms);
    const focus = player ? (people.length === 1 ? METADATA_RANKING.focus.solo : people.length <= 3 ? METADATA_RANKING.focus.small : 0) : 0;
    const relevance = (player ? METADATA_RANKING.player : 0) + (sponsors.length ? METADATA_RANKING.sponsor : 0) + focus;
    if (relevance === 0) return [];
    const ready = readiness(asset);
    const score = Math.round(RANKING.relevance * relevance + RANKING.readiness * ready.value);
    const signals = [
      ...(player ? [{ intent: "scoreplay:player", label: `Tagged ${player}` }] : []),
      ...sponsors.map((s) => ({ intent: `scoreplay:sponsor:${s.toLowerCase()}`, label: `Tagged ${s}` })),
    ];
    const evidence = signals.map((s) => s.label.replace(/^Tagged /, "")).join(" + ");
    const event = typeof asset.metadata.event === "object" && asset.metadata.event && "name" in asset.metadata.event ? String(asset.metadata.event.name) : undefined;
    const season = seasonOf(asset.title);
    return [
      {
        key: `${asset.id}@0-${duration}`,
        candidate: {
          scoreplayAssetId: asset.id,
          title: asset.title,
          kind: asset.kind,
          thumbnailUrl: asset.thumbnailUrl,
          durationSec: duration,
          startSeconds: 0,
          endSeconds: duration,
          competition: asset.facts.competition,
          recordedAt: asset.facts.recordedAt,
          foundBy: "SCOREPLAY_METADATA_FALLBACK",
          discoveredBy: v.discoveredBy,
          origin: asset.origin,
        },
        media: v.media,
        duplicates: [],
        headline: [player ?? "Club highlight", ...sponsors].join(" × "),
        score,
        breakdown: {
          relevance,
          readiness: ready.value,
          contextFactor: 1,
          notes: {
            relevance: `ScorePlay tags: ${[
              player ? `${player} (+${METADATA_RANKING.player})` : "",
              sponsors.length ? `${sponsors.join(", ")} (+${METADATA_RANKING.sponsor})` : "",
              focus ? `${people.length} player(s) tagged (+${focus})` : "",
            ]
              .filter(Boolean)
              .join(", ")}.`,
            readiness: ready.note,
            context: [event && `ScorePlay folder “${event}”.`, season ? `Filename marks the ${season} season.` : ""].filter(Boolean).join(" ") || "No season marked in the filename.",
          },
        },
        matches: signals.map((s) => ({ ...s, query: "ScorePlay tag", rank: 1, start: 0, end: duration })),
        ...(season ? { season } : {}),
        why: {
          opportunity: `ScorePlay links this clip to ${evidence} — which serves “${objective.summary}”.`,
          media: `Whole ${Math.round(duration)}-second ScorePlay clip “${asset.title}”, chosen on its ScorePlay tags (${evidence}). Not visually analysed: this footage is in no TwelveLabs index, so nothing inside it has been observed — including which brands are on screen.`,
          action,
        },
        previewNote: "",
      },
    ];
  });
  // Whole clips all start at 0, so length alone is no duplicate signal: only aspect-ratio versions of one edit
  // ("Vic FB Backboard Oop_4x5" / "_9x16", same length ± 0.5 s) fold into the best-ranked one.
  const stem = (title: string) => title.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[_\s-]*(\d+x\d+)[_\s-]*/g, " ").trim();
  const kept: Recommendation[] = [];
  for (const r of ranked.sort((a, b) => b.score - a.score || (a.candidate.durationSec ?? 0) - (b.candidate.durationSec ?? 0) || a.key.localeCompare(b.key))) {
    const original = kept.find((k) => stem(k.candidate.title) === stem(r.candidate.title) && Math.abs((k.candidate.durationSec ?? 0) - (r.candidate.durationSec ?? 0)) <= 0.5);
    if (original) original.duplicates = [...original.duplicates, r.key];
    else kept.push(r);
  }
  return kept;
}

/** Probable re-upload: a different ScorePlay asset of the same length, cut at the same timecode. */
export const probableDuplicate = (a: Recommendation, b: Recommendation) =>
  a.candidate.scoreplayAssetId !== b.candidate.scoreplayAssetId &&
  a.candidate.durationSec !== undefined &&
  b.candidate.durationSec !== undefined &&
  Math.abs(a.candidate.durationSec - b.candidate.durationSec) <= 0.5 &&
  Math.abs((a.candidate.startSeconds ?? 0) - (b.candidate.startSeconds ?? 0)) <= 1 &&
  Math.abs((a.candidate.endSeconds ?? 0) - (b.candidate.endSeconds ?? 0)) <= 1;

/**
 * Order for presentation: the best moment of each distinct asset first (re-uploads of the same file
 * count as one asset), then everything else by score.
 */
export function diversify(sorted: readonly Recommendation[]): Recommendation[] {
  const lead: Recommendation[] = [];
  const rest: Recommendation[] = [];
  for (const r of sorted) {
    const dup = lead.some((l) => l.candidate.scoreplayAssetId === r.candidate.scoreplayAssetId || probableDuplicate(l, r));
    (dup ? rest : lead).push(r);
  }
  return [...lead, ...rest];
}

/** Folds probable duplicates into the first (best-placed) moment: listed in its `duplicates`, never proposed twice. */
export function dedupe(ordered: readonly Recommendation[]): Recommendation[] {
  const kept: Recommendation[] = [];
  for (const r of ordered) {
    const original = kept.find((k) => probableDuplicate(k, r));
    if (original) original.duplicates = [...original.duplicates, r.key];
    else kept.push({ ...r, duplicates: [...r.duplicates] });
  }
  return kept;
}

/** Attaches a playable reference, or says plainly why there is none and what to do instead. */
export function withPreview(rec: Recommendation, preview: Preview | undefined, unavailable: string): Recommendation {
  const where = `${clock(rec.candidate.startSeconds ?? 0)}–${clock(rec.candidate.endSeconds ?? 0)}`;
  return preview
    ? {
        ...rec,
        preview,
        previewNote:
          preview.source === "SCOREPLAY_PROXY"
            ? `ScorePlay preview, starting at ${where}. Streamed from ScorePlay — nothing is downloaded.`
            : `TwelveLabs stream of the indexed video, starting at ${where}. Streamed — nothing is downloaded.`,
      }
    : { ...rec, preview: undefined, previewNote: `${unavailable} To watch it, open ScorePlay asset ${rec.candidate.scoreplayAssetId} at ${where}.` };
}
