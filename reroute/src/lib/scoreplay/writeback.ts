/**
 * Pure builders for the REROUTE → ScorePlay writeback (no I/O). What gets written is defined by
 * `SCOREPLAY_TAXONOMY` (PENDING CONFIRMATION WITH SCOREPLAY STAFF).
 */
import type { RightsReceipt } from "@/lib/contracts";
import { SCOREPLAY_TAXONOMY as T } from "./taxonomy";

/** One timecoded video log to write (`POST /video/logs`, offset modes, seconds from video start). */
export type PlannedAction = {
  /** Offset range when `end` is set, offset single otherwise. */
  start: number;
  end?: number;
  comment: string;
  rawTags: string[];
};

/** Status mirrors `RightsReceipt.writeback[].status`. */
export type MediaReadBack = {
  status: "VERIFIED" | "WRITTEN" | "FAILED";
  at: string;
  detail?: string;
  verdictTag?: string;
  /** REROUTE-managed tag names present on the media when re-read. */
  tags: string[];
  /** REROUTE video logs of THIS receipt present on the media when re-read. */
  actions: { id: number; start?: number; end?: number; comment: string }[];
};

export function writebackTargets(receipt: RightsReceipt): string[] {
  return receipt.derivativeAssetId ? [receipt.derivativeAssetId] : [...new Set(receipt.sourceAssetIds)];
}

export function desiredTagNames(receipt: RightsReceipt): string[] {
  const names: string[] = [T.verdictTags[receipt.decision.verdict], T.reviewTags[receipt.humanReviewStatus]];
  if (receipt.decision.policyFictional) names.push(T.fictionalPolicyTag);
  return names;
}

export function receiptMarker(receiptId: string): string {
  return `${T.commentPrefix}${receiptId} |`;
}

/**
 * Summary log at 0 s + one log per DENY/MISSING reason range that falls on `mediaId`.
 * For a derivative target, source ranges are translated onto the output timeline via `receipt.edit.segments`.
 */
export function planActions(receipt: RightsReceipt, mediaId: string): PlannedAction[] {
  const d = receipt.decision;
  const i = receipt.intent;
  const policy = `policy ${d.policyId}@${d.policyVersion}${d.policyFictional ? ` | ${T.fictionalBanner}` : ""}`;
  const intent = `intent ${i.platform}/${i.territory}/${i.usage}/${i.competition} @ ${i.publishAt}`;
  const marker = receiptMarker(receipt.id);

  const reasonsText = d.reasons
    .filter((r) => r.outcome !== "PERMIT")
    .map((r) => `[${r.outcome} ${r.dimension}] ${r.ruleId}: ${r.explanation}`)
    .join("; ");
  const summary: PlannedAction = {
    start: 0,
    comment: clip(
      [
        marker.slice(0, -2),
        `${d.verdict} (edit ${receipt.edit.id}${receipt.derivativeAssetId ? `, derivative of ${receipt.sourceAssetIds.join(",")}` : ""})`,
        policy,
        intent,
        `review ${receipt.humanReviewStatus}`,
        d.missingFacts.length ? `missing: ${d.missingFacts.join(", ")}` : undefined,
        reasonsText ? `reasons: ${reasonsText}` : undefined,
      ]
        .filter(Boolean)
        .join(" | "),
    ),
    rawTags: [...T.logRawTags.summary],
  };

  const ranges = new Map<string, PlannedAction>();
  for (const r of d.reasons) {
    if (r.outcome === "PERMIT" || r.scoreplayMediaId === undefined || r.start === undefined || r.end === undefined) continue;
    for (const [start, end] of placeRange(receipt, mediaId, r.scoreplayMediaId, r.start, r.end)) {
      const label = r.outcome === "DENY" ? "BLOCKED" : "NEEDS_REVIEW";
      const comment = clip(
        `${marker} ${label} ${fmt(start)}-${fmt(end)}s | rule ${r.ruleId} (${r.dimension}): ${r.explanation} | ${policy} | ${intent}`,
      );
      const key = `${r.outcome}|${r.ruleId}|${fmt(start)}|${fmt(end)}`;
      if (!ranges.has(key)) {
        ranges.set(key, { start, end: end > start ? end : undefined, comment, rawTags: [...T.logRawTags[r.outcome]] });
      }
    }
  }
  return [summary, ...[...ranges.values()].sort((a, b) => a.start - b.start)];
}

/** Where a reason range on `sourceId` lands on the target media's timeline. */
function placeRange(receipt: RightsReceipt, targetId: string, sourceId: string, start: number, end: number): [number, number][] {
  if (!receipt.derivativeAssetId) return sourceId === targetId ? [[start, end]] : [];
  if (targetId !== receipt.derivativeAssetId) return [];
  const placed: [number, number][] = [];
  let cursor = 0;
  for (const seg of receipt.edit.segments) {
    const from = Math.max(start, seg.start);
    const to = Math.min(end, seg.end);
    if (seg.scoreplayMediaId === sourceId && from <= to) placed.push([cursor + from - seg.start, cursor + to - seg.start]);
    cursor += seg.end - seg.start;
  }
  return placed;
}

function fmt(seconds: number): string {
  return seconds.toFixed(2);
}

function clip(text: string): string {
  return text.length <= T.maxCommentChars ? text : `${text.slice(0, T.maxCommentChars - 1)}…`;
}
