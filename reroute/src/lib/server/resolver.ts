import type { z } from "zod";
import type { Asset, Candidate, EditPlan, PublishIntent, ResolveResponseSchema, SearchHit, Segment } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { classifyBlocker } from "@/lib/rights";
import { loadDecisionContext } from "./context";
import { evaluateEditInContext, type DecideOptions } from "./decide";

export interface ResolveInput {
  edit: EditPlan;
  intent: PublishIntent;
  segmentIndex: number;
  query?: string;
  limit: number;
}

export type ResolveResult = z.infer<typeof ResolveResponseSchema>;

/** Marengo hits fetched per requested candidate: headroom for hits dropped by exclusion/duplicates/fit. */
const OVERFETCH = 4;
/** Renditions of the same clip differ by a few frames at most. */
const DUPLICATE_DURATION_SEC = 0.5;

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
 * "Find another way" for one segment. First classifies what blocks it:
 * - CAMPAIGN (territory/platform/usage/date/no policy): every clip would fail the same way → no candidates,
 *   a concrete `suggestion` for the intent instead.
 * - CLIP (people/brands/asset rules/analysis/identity): search comparable footage with Marengo. Each candidate
 *   is re-checked alone AND inside the full proposed edit, under the policy selected for ITS asset; only
 *   full-edit ALLOWED candidates are eligible. Similarity is never permission.
 * Works for BLOCKED and NEEDS_REVIEW segments. The original asset and its probable duplicates are excluded.
 */
export async function resolve(input: ResolveInput, opts: DecideOptions = {}): Promise<ResolveResult> {
  const { edit, intent, segmentIndex, limit } = input;
  const target = edit.segments[segmentIndex];
  if (!target) {
    throw new AppError("BAD_REQUEST", `segmentIndex ${segmentIndex} out of range (edit has ${edit.segments.length})`);
  }
  const now = opts.now ?? new Date();
  const ctx = await loadDecisionContext(edit, { deps: opts.deps, club: intent.club });
  const original = ctx.assets[target.scoreplayMediaId];
  const query = input.query?.trim() || target.label?.trim() || original.title.trim();

  const current = evaluateEditInContext(ctx, edit, intent, { now, policies: opts.policies });
  const blocker = classifyBlocker(current.segments[segmentIndex].decision, intent, opts.policies);
  if (blocker.scope !== "CLIP") return { query, blocker, candidates: [] };

  const video = ctx.video();
  if ("status" in video) throw new AppError("NOT_CONFIGURED", `Marengo search unavailable: ${video.detail}`);

  const duration = target.end - target.start;
  const hits = await video.search(query, { limit: Math.min(limit * OVERFETCH, 50), excludeMediaIds: [original.id] });

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
    const segmentDecision = evaluateEditInContext(ctx, alone, intent, { now, policies: opts.policies }).segments[0].decision;
    const editDecision = evaluateEditInContext(ctx, proposedEdit, intent, { now, policies: opts.policies });
    candidates.push({ hit, proposedEdit, segmentDecision, editDecision, eligible: editDecision.decision.verdict === "ALLOWED" });
  }

  candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.hit.rank - b.hit.rank);
  const ranked = candidates.slice(0, limit);
  return { query, blocker, candidates: ranked, ...(ranked[0]?.eligible ? { best: ranked[0] } : {}) };
}
