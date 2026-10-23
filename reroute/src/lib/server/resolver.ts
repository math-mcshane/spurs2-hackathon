import type { Asset, Candidate, EditDecision, EditPlan, PublishIntent, SearchHit, Segment } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import type { DecisionContext } from "./context";
import { combineDecisions, evaluateEditInContext, type DecideOptions } from "./decide";

/**
 * Replacement footage for the Media Compliance Recovery Engine (`./recovery.ts`): Marengo search for comparable
 * moments, each candidate independently re-checked. Similarity is never permission.
 */

/** Marengo hits fetched per requested candidate: headroom for hits dropped by exclusion/duplicates/fit. */
const OVERFETCH = 4;
/** Each hit may trigger a ScorePlay load + video analysis: hard cap per search. */
const MAX_HITS = 12;
/** Renditions of the same clip differ by a few frames at most. */
const DUPLICATE_DURATION_SEC = 0.5;

/** One edit under every intent, combined segment by segment (worst verdict, weakest clearance). */
function evaluateForIntents(ctx: DecisionContext, edit: EditPlan, intents: readonly PublishIntent[], opts: Pick<DecideOptions, "policies"> & { now: Date }): EditDecision {
  const results = intents.map((intent) => evaluateEditInContext(ctx, edit, intent, opts));
  if (results.length === 1) return results[0];
  return {
    edit,
    decision: combineDecisions(results.map((r) => r.decision), opts.now),
    segments: edit.segments.map((segment, i) => ({ segment, decision: combineDecisions(results.map((r) => r.segments[i].decision), opts.now) })),
  };
}

/**
 * Fit a hit to `duration` seconds around its midpoint (minimal change to the matched moment),
 * clamped to [0, assetDuration]. Undefined when the asset is too short to supply `duration`.
 */
function fitToDuration(hit: SearchHit, duration: number, assetDuration: number | undefined) {
  if (assetDuration !== undefined && assetDuration < duration) return undefined;
  const max = assetDuration ?? Number.POSITIVE_INFINITY;
  const mid = (hit.start + hit.end) / 2;
  const start = Math.min(Math.max(0, mid - duration / 2), max - duration);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { start: round(start), end: round(start + duration) };
}

/** "9x16_TEAM_NEWS_MAN_UTD_2.mp4" and "9x16_TEAM_NEWS_MAN_UTD.mp4" share the stem "teamnewsmanutd". */
function nameStem(title: string): string {
  let s = title.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "");
  s = s.replace(/\b\d{1,2}x\d{1,2}\b/g, " "); // aspect-ratio renditions (9x16, 4x5, 16x9)
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/[\s_-]*(v\d+|\d|copy|final)\s*$/, "").trim();
  }
  return s.replace(/[^a-z0-9]+/g, "");
}

/** Same footage under another name: same stem and (near-)identical duration. */
function probableDuplicate(a: Asset, b: Asset): boolean {
  if (a.id === b.id) return true;
  if (a.durationSec === undefined || b.durationSec === undefined) return false;
  return Math.abs(a.durationSec - b.durationSec) <= DUPLICATE_DURATION_SEC && nameStem(a.title) === nameStem(b.title);
}

/**
 * Comparable footage for one segment of `edit` (Marengo search for `query`), each candidate re-checked alone and
 * inside the full proposed edit under every intent; eligible (full-edit ALLOWED) first, then search rank.
 * Candidate assets are loaded into `ctx`. The original asset and its probable duplicates are never candidates;
 * hits inside the original asset are returned as `sourceHits` (relevance evidence for a clean section of it).
 */
export async function searchReplacements(
  ctx: DecisionContext,
  input: { edit: EditPlan; segmentIndex: number; intents: readonly PublishIntent[]; query: string; limit: number },
  evalOpts: Pick<DecideOptions, "policies"> & { now: Date },
): Promise<{ candidates: Candidate[]; sourceHits: SearchHit[] }> {
  const { edit, segmentIndex, intents, query, limit } = input;
  const target = edit.segments[segmentIndex];
  const original = ctx.assets[target.scoreplayMediaId];
  const video = ctx.video();
  if ("status" in video) throw new AppError("NOT_CONFIGURED", `Marengo search unavailable: ${video.detail}`);

  const duration = target.end - target.start;
  const all = await video.search(query, { limit: Math.min(limit * OVERFETCH, MAX_HITS) });
  const sourceHits = all.filter((h) => h.scoreplayMediaId === original.id);
  const hits = all.filter((h) => h.scoreplayMediaId !== original.id);
  // Hits whose ScorePlay asset no longer exists can't be checked → dropped.
  const gone = new Set<string>();
  await Promise.all(
    [...new Set(hits.map((h) => h.scoreplayMediaId))].map((id) =>
      ctx.ensure([id]).catch((err: unknown) => {
        if (err instanceof AppError && err.code === "NOT_FOUND") gone.add(id);
        else throw err;
      }),
    ),
  );

  const candidates: Candidate[] = [];
  const picked: Asset[] = [];
  for (const hit of hits) {
    if (gone.has(hit.scoreplayMediaId)) continue;
    const asset = ctx.assets[hit.scoreplayMediaId];
    // One candidate per footage: never the original, a rendition of it, or a rendition of one already picked.
    if (probableDuplicate(asset, original) || picked.some((p) => probableDuplicate(asset, p))) continue;
    const fitted = fitToDuration(hit, duration, asset.durationSec);
    if (!fitted) continue;
    picked.push(asset);

    const segment: Segment = { scoreplayMediaId: asset.id, ...fitted, label: target.label ?? query };
    const proposedEdit: EditPlan = {
      id: `${edit.id}~seg${segmentIndex}~${asset.id}@${segment.start}`,
      title: `${edit.title} (rerouted segment ${segmentIndex + 1})`,
      segments: edit.segments.map((s, i) => (i === segmentIndex ? segment : s)),
      derived: true,
      derivedFrom: edit.id,
    };
    const alone: EditPlan = { id: `${proposedEdit.id}~alone`, title: asset.title, segments: [segment], derived: true, derivedFrom: edit.id };
    const segmentDecision = evaluateForIntents(ctx, alone, intents, evalOpts).segments[0].decision;
    const editDecision = evaluateForIntents(ctx, proposedEdit, intents, evalOpts);
    candidates.push({ hit, proposedEdit, segmentDecision, editDecision, eligible: editDecision.decision.verdict === "ALLOWED" });
  }

  candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.hit.rank - b.hit.rank);
  return { candidates: candidates.slice(0, limit), sourceHits };
}
