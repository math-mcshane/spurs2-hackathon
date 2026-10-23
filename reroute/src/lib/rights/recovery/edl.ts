/**
 * Edit decision list (EDL) for a derived cut of ONE source asset: which source intervals are kept, which are
 * removed and why, and where every kept interval lands on the output timeline. Pure and deterministic.
 *
 * An EDL is a plan. `execution` says whether a file exists: PLAN_NOT_RENDERED means no video was produced —
 * the rights engine evaluates the kept SOURCE intervals (what the derivative would contain), never a file.
 */
import { z } from "zod";
import { EvidenceSchema, type EditPlan, type Evidence } from "@/lib/contracts";

/** Timestamps are rounded to milliseconds so plans are stable across float noise. */
const ms = (t: number) => Math.round(t * 1000) / 1000;

export const IntervalSchema = z.object({ start: z.number().nonnegative(), end: z.number().nonnegative() });
export type Interval = z.infer<typeof IntervalSchema>;

export const RemovalSchema = IntervalSchema.extend({
  /** Plain-language reason, e.g. "Manchester United crest on the hoarding (partner exclusivity)". */
  reason: z.string(),
  /** Rule ids of the restrictions this removal targets. */
  ruleIds: z.array(z.string()),
  /** Observations that place the restriction at this time (source timeline). */
  evidence: z.array(EvidenceSchema),
});
export type Removal = z.infer<typeof RemovalSchema>;

/** One kept source interval and its position on the output timeline. */
export const TimelinePieceSchema = z.object({
  sourceStart: z.number(),
  sourceEnd: z.number(),
  outStart: z.number(),
  outEnd: z.number(),
});
export type TimelinePiece = z.infer<typeof TimelinePieceSchema>;

export const EdlSchema = z.object({
  /** Id of the derived variant — never equal to the source asset id. */
  id: z.string(),
  sourceAssetId: z.string(),
  sourceTitle: z.string(),
  /** The source range the campaign had selected before the edit. */
  sourceRange: IntervalSchema,
  removed: z.array(RemovalSchema),
  /** Kept source intervals, sorted, non-overlapping. */
  retained: z.array(IntervalSchema).min(1),
  timeline: z.array(TimelinePieceSchema).min(1),
  durationSec: z.number().positive(),
  originalDurationSec: z.number().positive(),
  /** Kept pieces shorter than this were dropped as unusable flashes (recorded in `removed`). */
  minPieceSec: z.number().nonnegative(),
  execution: z.enum(["PLAN_NOT_RENDERED"]),
});
export type Edl = z.infer<typeof EdlSchema>;

export const EDL_EXECUTION_LABEL = "Edit plan — not rendered";

/** Sorted union of intervals; touching or overlapping intervals merge (empty ones are dropped). */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).map((i) => ({ start: ms(i.start), end: ms(i.end) })).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** `range` minus every removal, clipped to `range`. */
export function subtractIntervals(range: Interval, removals: readonly Interval[]): Interval[] {
  const cuts = mergeIntervals(removals.map((r) => ({ start: Math.max(r.start, range.start), end: Math.min(r.end, range.end) })));
  const out: Interval[] = [];
  let cursor = ms(range.start);
  for (const c of cuts) {
    if (c.start > cursor) out.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (ms(range.end) > cursor) out.push({ start: cursor, end: ms(range.end) });
  return out;
}

export const totalDuration = (intervals: readonly Interval[]) => ms(intervals.reduce((s, i) => s + (i.end - i.start), 0));

/** Kept source intervals laid end to end on the output timeline. */
export function buildTimeline(retained: readonly Interval[]): TimelinePiece[] {
  let out = 0;
  return retained.map((r) => {
    const piece = { sourceStart: r.start, sourceEnd: r.end, outStart: ms(out), outEnd: ms(out + (r.end - r.start)) };
    out += r.end - r.start;
    return piece;
  });
}

/**
 * Where a source-timed observation lands in the output: one entry per kept piece it overlaps, clipped and
 * shifted. Untimed (whole-clip) observations apply to the whole output. An observation in removed footage
 * maps nowhere (empty array).
 */
export function remapEvidence(ev: Evidence, timeline: readonly TimelinePiece[]): Interval[] {
  const total = timeline.length ? timeline[timeline.length - 1].outEnd : 0;
  if (ev.start === undefined && ev.end === undefined) return [{ start: 0, end: total }];
  const start = ev.start ?? 0;
  const end = ev.end ?? Number.POSITIVE_INFINITY;
  const out: Interval[] = [];
  for (const p of timeline) {
    const s = Math.max(start, p.sourceStart);
    const e = Math.min(end, p.sourceEnd);
    if (start === end ? start >= p.sourceStart && start < p.sourceEnd : s < e) {
      out.push({ start: ms(p.outStart + (s - p.sourceStart)), end: ms(p.outStart + (Math.max(e, s) - p.sourceStart)) });
    }
  }
  return out;
}

/**
 * Build an EDL that keeps `range` minus `removals`. Kept pieces shorter than `minPieceSec` are dropped (and
 * recorded as removed). Returns undefined when nothing usable is left.
 */
export function buildEdl(input: {
  id: string;
  sourceAssetId: string;
  sourceTitle: string;
  range: Interval;
  removals: readonly Removal[];
  minPieceSec: number;
}): Edl | undefined {
  const { range, minPieceSec } = input;
  const removed: Removal[] = [...input.removals]
    .map((r) => ({ ...r, start: ms(Math.max(r.start, range.start)), end: ms(Math.min(r.end, range.end)) }))
    .filter((r) => r.end > r.start);
  const pieces = subtractIntervals(range, removed);
  const retained = pieces.filter((p) => p.end - p.start >= minPieceSec);
  for (const p of pieces) {
    if (p.end - p.start < minPieceSec) {
      removed.push({ start: p.start, end: p.end, reason: `Leftover of ${(p.end - p.start).toFixed(2)} s is too short to keep (minimum ${minPieceSec} s).`, ruleIds: [], evidence: [] });
    }
  }
  if (retained.length === 0) return undefined;
  removed.sort((a, b) => a.start - b.start);
  return {
    id: input.id,
    sourceAssetId: input.sourceAssetId,
    sourceTitle: input.sourceTitle,
    sourceRange: { start: ms(range.start), end: ms(range.end) },
    removed,
    retained,
    timeline: buildTimeline(retained),
    durationSec: totalDuration(retained),
    originalDurationSec: ms(range.end - range.start),
    minPieceSec,
    execution: "PLAN_NOT_RENDERED",
  };
}

/** The derived edit the rights engine evaluates: one segment per kept source interval. */
export function edlToEditPlan(edl: Edl, title?: string): EditPlan {
  return {
    id: edl.id,
    title: title ?? `${edl.sourceTitle} (edit plan)`,
    segments: edl.retained.map((r, i) => ({ scoreplayMediaId: edl.sourceAssetId, start: r.start, end: r.end, label: `kept ${i + 1}/${edl.retained.length}` })),
    derived: true,
    derivedFrom: edl.sourceAssetId,
  };
}
