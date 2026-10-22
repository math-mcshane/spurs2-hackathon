import type { Candidate, EditPlan, PublishIntent, SearchHit, Segment } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { loadPolicy, type Policy } from "@/lib/rights";
import { loadDecisionContext, type ContextDeps, type DecisionContext } from "./context";
import { evaluateEditInContext, evaluateSegmentInContext } from "./decide";

export interface ResolveInput {
  edit: EditPlan;
  intent: PublishIntent;
  segmentIndex: number;
  query?: string;
  limit: number;
}

export interface ResolveResult {
  query: string;
  candidates: Candidate[];
  best?: Candidate;
}

/** Marengo hits fetched per requested candidate: headroom for hits dropped by overlap/fit. */
const OVERFETCH = 4;

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && a.end > b.start;

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

function buildQuery(ctx: DecisionContext, segment: Segment, explicit: string | undefined): string {
  const fromObservations = (ctx.observations[segment.scoreplayMediaId] ?? [])
    .filter((e) => e.start === undefined || e.end === undefined || overlaps({ start: e.start, end: e.end }, segment))
    .map((e) => e.observation.trim())
    .filter(Boolean)
    .join("; ");
  const query =
    explicit?.trim() || segment.label?.trim() || fromObservations || ctx.assets[segment.scoreplayMediaId]?.title.trim();
  if (!query) throw new AppError("BAD_REQUEST", "No query given and the segment has no label, observations or title");
  return query;
}

/**
 * Replace one segment of `edit` with comparable footage from Marengo. Every candidate is re-checked
 * alone AND as part of the full proposed edit; only full-edit ALLOWED candidates are eligible.
 * Similarity is never permission: unknown-rights candidates are listed but never eligible.
 */
export async function resolve(
  input: ResolveInput,
  opts: { deps?: ContextDeps; policy?: Policy; now?: Date } = {},
): Promise<ResolveResult> {
  const { edit, intent, segmentIndex, limit } = input;
  const target = edit.segments[segmentIndex];
  if (!target) {
    throw new AppError("BAD_REQUEST", `segmentIndex ${segmentIndex} out of range (edit has ${edit.segments.length})`);
  }
  const policy = opts.policy ?? loadPolicy();
  const now = opts.now ?? new Date();
  const ctx = await loadDecisionContext(edit, opts.deps);

  const video = ctx.video();
  if ("status" in video) throw new AppError("NOT_CONFIGURED", `Marengo search unavailable: ${video.detail}`);

  const query = buildQuery(ctx, target, input.query);
  const duration = target.end - target.start;
  const hits = await video.search(query, { limit: Math.min(limit * OVERFETCH, 50) });

  // Hits whose custom_id doesn't resolve to a ScorePlay asset can't be checked → dropped.
  const mediaIds = [...new Set(hits.map((h) => h.scoreplayMediaId))];
  const missing = new Set<string>();
  await Promise.all(
    mediaIds.map((id) =>
      ctx.ensure([id]).catch((err: unknown) => {
        if (err instanceof AppError && err.code === "NOT_FOUND") missing.add(id);
        else throw err;
      }),
    ),
  );

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (missing.has(hit.scoreplayMediaId)) continue;
    const sameAsset = hit.scoreplayMediaId === target.scoreplayMediaId;
    if (sameAsset && overlaps(hit, target)) continue;
    const fitted = fitToDuration(hit, duration, ctx.assets[hit.scoreplayMediaId].durationSec);
    if (!fitted || (sameAsset && overlaps(fitted, target))) continue;

    const segment: Segment = {
      scoreplayMediaId: hit.scoreplayMediaId,
      ...fitted,
      label: target.label ?? query,
    };
    const key = `${segment.scoreplayMediaId}@${segment.start}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const proposedEdit: EditPlan = {
      id: `${edit.id}~seg${segmentIndex}~${key}`,
      title: `${edit.title} (rerouted segment ${segmentIndex + 1})`,
      segments: edit.segments.map((s, i) => (i === segmentIndex ? segment : s)),
      derived: true,
      derivedFrom: edit.id,
    };
    const segmentDecision = evaluateSegmentInContext(ctx, segment, intent, policy, now);
    const editDecision = evaluateEditInContext(ctx, proposedEdit, intent, policy, now);
    candidates.push({
      hit,
      proposedEdit,
      segmentDecision,
      editDecision,
      eligible: editDecision.decision.verdict === "ALLOWED",
    });
  }

  candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.hit.rank - b.hit.rank);
  const ranked = candidates.slice(0, limit);
  return { query, candidates: ranked, best: ranked[0]?.eligible ? ranked[0] : undefined };
}
