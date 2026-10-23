/**
 * REROUTE → ScorePlay writeback, split in two:
 * - `planWriteback(receipt, review)` — PURE. Exactly which documented mutations would be sent (per source media).
 * - `applyWriteback(receipt, plan, client)` — LIVE. Executes a plan add-then-verify, then removes superseded
 *   REROUTE tags/logs. Only reachable when `writebackMode()` says LIVE (see app/api/writeback/route.ts).
 *
 * Rules: verdict tags ONLY for verified (non-fictional) policies; demo results are at most an informational
 * `reroute:demo-simulation` log and are never written live. Taxonomy: ./taxonomy.ts. Endpoints: ./API_NOTES.md.
 */
import { z } from "zod";
import {
  DEMO_CLEARANCE_LABEL,
  ScorePlayActionSchema,
  type Clearance,
  type Decision,
  type Reason,
  type RightsReceipt,
  type ScorePlayAction,
  type Verdict,
} from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import type { ScorePlayHttpClient } from "./client";
import type { ScorePlayVideoLog } from "./schemas";
import { SCOREPLAY_TAXONOMY as T, managedTagNames } from "./taxonomy";

// ---------- Plan types ----------

/** One timecoded video log (offset range mode, seconds from video start). */
export type PlannedLog = { start: number; end: number; comment: string; rawTags: string[] };

/** Structured form of a planned mutation; `applyWriteback` executes these. */
export type WritebackOp =
  | { kind: "ENSURE_TAG_OPTION"; name: string }
  | { kind: "ADD_MEDIA_TAGS"; mediaId: string; tagNames: string[] }
  | { kind: "ADD_VIDEO_LOGS"; mediaId: string; logs: PlannedLog[] }
  | { kind: "REMOVE_SUPERSEDED_TAGS"; mediaId: string; tagNames: string[] }
  | { kind: "REMOVE_SUPERSEDED_LOGS"; mediaId: string; receiptId: string };

/** A documented ScorePlay mutation (contract shape) plus its structured op. */
export type PlannedAction = ScorePlayAction & { op: WritebackOp };

export type PolicyKind = "VERIFIED" | "DEMO" | "UNVERIFIED";

export type ReviewInfo = { reviewer?: string; reviewedAt?: string };

/** Per-media outcome after a LIVE write; status mirrors `RightsReceipt.writeback[].status`. */
export type MediaReadBack = {
  status: "VERIFIED" | "WRITTEN" | "FAILED";
  at: string;
  detail?: string;
  /** REROUTE-managed tag names present on the media when re-read. */
  tags: string[];
  /** REROUTE video logs of THIS receipt present on the media when re-read (seconds). */
  logs: { id: number; start?: number; end?: number; comment: string }[];
};

// ---------- Classification (pure) ----------

/** DEMO = fictional policy; UNVERIFIED = no applicable policy selected; VERIFIED otherwise. */
export function policyKind(d: Decision): PolicyKind {
  if (d.policyFictional || d.clearance === "DEMO" || d.policySelection?.kind === "DEMO") return "DEMO";
  if (d.policySelection && d.policySelection.policyId === null) return "UNVERIFIED";
  return "VERIFIED";
}

/** Source media written to, in first-appearance order. Derivatives are their own assets (not written here). */
export function writebackTargets(receipt: RightsReceipt): string[] {
  return [...new Set(receipt.sourceAssetIds)];
}

function applies(r: Reason, mediaId: string, start: number, end: number): boolean {
  if (r.scoreplayMediaId !== undefined && r.scoreplayMediaId !== mediaId) return false;
  if (r.start === undefined || r.end === undefined) return true;
  return r.start <= end && r.end >= start;
}

/** DENY → BLOCKED; MISSING → NEEDS_REVIEW; ALLOWED only with ≥1 applicable reason and none negative (unknown ≠ allowed). */
function verdictOf(reasons: Reason[]): Verdict {
  if (reasons.some((r) => r.outcome === "DENY")) return "BLOCKED";
  if (reasons.some((r) => r.outcome === "MISSING")) return "NEEDS_REVIEW";
  return reasons.length > 0 ? "ALLOWED" : "NEEDS_REVIEW";
}

const SEVERITY: Record<Verdict, number> = { ALLOWED: 0, NEEDS_REVIEW: 1, BLOCKED: 2 };

/** Verdict of one media within this receipt: worst of its own segments (not the whole edit's verdict). */
export function mediaVerdict(receipt: RightsReceipt, mediaId: string): Verdict {
  const segments = receipt.edit.segments.filter((s) => s.scoreplayMediaId === mediaId);
  if (segments.length === 0) return "NEEDS_REVIEW";
  return segments
    .map((s) => verdictOf(receipt.decision.reasons.filter((r) => applies(r, mediaId, s.start, s.end))))
    .reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a));
}

function clearanceOf(verdict: Verdict, kind: PolicyKind): Clearance {
  if (verdict !== "ALLOWED") return "NONE";
  return kind === "VERIFIED" ? "VERIFIED" : kind === "DEMO" ? "DEMO" : "NONE";
}

// ---------- Mode (pure) ----------

/** Why a LIVE write must not happen for this receipt (independent of env). */
export function liveRefusal(receipt: RightsReceipt): string | undefined {
  const d = receipt.decision;
  const kind = policyKind(d);
  if (kind === "DEMO") return `Demo policy ${d.policyId}@${d.policyVersion}: ${DEMO_CLEARANCE_LABEL}. Demo results are never written to ScorePlay as metadata.`;
  if (kind === "UNVERIFIED") return "No verified policy applies to this receipt; nothing authoritative to write.";
  if (receipt.humanReviewStatus === "PENDING") return "Receipt has not been reviewed; live writeback requires an APPROVED or REJECTED human review.";
  return undefined;
}

export type WritebackModeResult =
  | { mode: "LIVE" }
  | { mode: "DRY_RUN"; status: "DRY_RUN" | "REFUSED"; refusedReason?: string };

/** LIVE only when `SCOREPLAY_WRITEBACK_MODE=live` AND verified policy AND reviewed; otherwise DRY_RUN. */
export function writebackMode(receipt: RightsReceipt, envMode = process.env.SCOREPLAY_WRITEBACK_MODE): WritebackModeResult {
  const liveRequested = envMode?.trim().toLowerCase() === "live";
  const refusedReason = liveRefusal(receipt);
  if (liveRequested && !refusedReason) return { mode: "LIVE" };
  return { mode: "DRY_RUN", status: liveRequested ? "REFUSED" : "DRY_RUN", ...(refusedReason ? { refusedReason } : {}) };
}

/** `GET /api/writeback?receiptId=` — what POST would do right now. No side effects (no ScorePlay call, no record). */
export const WritebackPreviewSchema = z.object({
  mode: z.enum(["DRY_RUN", "LIVE"]),
  planned: z.array(ScorePlayActionSchema),
  refusedReason: z.string().optional(),
  /** ScorePlay media ids that would be written. */
  targets: z.array(z.string()),
});
export type WritebackPreview = z.infer<typeof WritebackPreviewSchema>;

// ---------- Plan (pure) ----------

export function receiptMarker(receiptId: string): string {
  return `${T.commentPrefix}${receiptId} |`;
}

const OUTCOME_ORDER: Record<Reason["outcome"], number> = { DENY: 0, MISSING: 1, PERMIT: 2 };

/** One log per segment of `mediaId`: status, clearance, top reasons, policy, receipt, reviewer, segment range. */
function segmentLogs(receipt: RightsReceipt, mediaId: string, kind: PolicyKind, review: ReviewInfo): PlannedLog[] {
  const d = receipt.decision;
  const intents = (receipt.intents?.length ? receipt.intents : [receipt.intent])
    .map((i) => `${i.platform}/${i.territory}/${i.usage}/${i.competition}@${i.publishAt}`)
    .join(", ");
  const reviewText =
    receipt.humanReviewStatus === "PENDING"
      ? "review=PENDING"
      : `review=${receipt.humanReviewStatus} by ${review.reviewer ?? "unknown"} at ${review.reviewedAt ?? "unknown"}`;
  const rawTags = [...(kind === "VERIFIED" ? T.logRawTags.verified : kind === "DEMO" ? T.logRawTags.demo : T.logRawTags.unverified)];
  return receipt.edit.segments
    .filter((s) => s.scoreplayMediaId === mediaId && s.end > s.start)
    .map((s) => {
      const reasons = d.reasons.filter((r) => applies(r, mediaId, s.start, s.end));
      const verdict = verdictOf(reasons);
      const status = kind === "VERIFIED" ? `status=${verdict}` : `simulated-status=${verdict} (informational, not a clearance)`;
      const top = [...reasons]
        .sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome])
        .slice(0, T.maxReasonsPerLog)
        .map((r) => `[${r.outcome} ${r.dimension}] ${r.ruleId}: ${r.explanation}`)
        .join("; ");
      const comment = [
        receiptMarker(receipt.id).slice(0, -2),
        kind === "DEMO" ? DEMO_CLEARANCE_LABEL : kind === "UNVERIFIED" ? "NO VERIFIED POLICY" : undefined,
        status,
        `clearance=${clearanceOf(verdict, kind)}`,
        `policy=${d.policyId}@${d.policyVersion} (${kind})`,
        `segment=${s.start.toFixed(2)}-${s.end.toFixed(2)}s`,
        reviewText,
        top ? `reasons: ${top}` : "reasons: none recorded",
        // Last, so the cap trims the (possibly long) campaign intent list before the reasons.
        `intents=${intents}`,
      ]
        .filter(Boolean)
        .join(" | ");
      const capped = comment.length <= T.maxCommentChars ? comment : `${comment.slice(0, T.maxCommentChars - 1)}…`;
      return { start: s.start, end: s.end, comment: capped, rawTags };
    });
}

function toAction(op: WritebackOp): PlannedAction {
  switch (op.kind) {
    case "ENSURE_TAG_OPTION":
      return {
        method: "POST",
        path: "/tag/options",
        body: { name: op.name, label: op.name, type: T.tagOptionType },
        purpose: `Create tag option "${op.name}" only if GET /tag/options?query= finds no exact match`,
        op,
      };
    case "ADD_MEDIA_TAGS":
      return {
        method: "POST",
        path: `/media/${op.mediaId}/tags`,
        body: { tag_option_ids: op.tagNames.map((n) => `<tag_option_id of "${n}">`) },
        purpose: `Tag media ${op.mediaId}: ${op.tagNames.join(", ")} (only ids not already present)`,
        op,
      };
    case "ADD_VIDEO_LOGS":
      return {
        method: "POST",
        path: "/video/logs",
        body: {
          company_id: `<company_id of media ${op.mediaId}>`,
          video_logs: op.logs.map((l) => ({
            media_id: Number(op.mediaId),
            log: { start_offset: l.start, end_offset: l.end, comment: l.comment, raw_tags: l.rawTags },
          })),
        },
        purpose: `Add ${op.logs.length} timecoded log(s) to media ${op.mediaId} (videos only), then re-read to verify`,
        op,
      };
    case "REMOVE_SUPERSEDED_TAGS":
      return {
        method: "DELETE",
        path: `/media/${op.mediaId}/tags`,
        body: { tag_option_ids: op.tagNames.map((n) => `<tag_option_id of "${n}" if present>`) },
        purpose: `After the add is verified: remove superseded REROUTE tags from media ${op.mediaId}`,
        op,
      };
    case "REMOVE_SUPERSEDED_LOGS":
      return {
        method: "DELETE",
        path: `/media/${op.mediaId}/logs`,
        body: { log_ids: [`<ids of logs starting "${receiptMarker(op.receiptId)}" that existed before this write>`] },
        purpose: `After the add is verified: remove this receipt's earlier REROUTE logs on media ${op.mediaId}`,
        op,
      };
  }
}

/**
 * Pure plan, computed per source media. VERIFIED policy: ensure tag options → per media add tags, add one
 * log per segment, then remove superseded REROUTE tags/logs. Tags: APPROVED → verdict + review:approved;
 * REJECTED → review:rejected only (a rejected use never gets a verdict tag); PENDING → none.
 * DEMO / UNVERIFIED: only an informational log per segment — never a tag.
 */
export function planWriteback(receipt: RightsReceipt, review: ReviewInfo = {}): PlannedAction[] {
  const kind = policyKind(receipt.decision);
  const targets = writebackTargets(receipt);
  const badId = targets.find((id) => !/^[1-9]\d*$/.test(id));
  if (badId !== undefined) throw new AppError("BAD_REQUEST", `Invalid ScorePlay media id "${badId}" (expected a positive integer)`);

  if (kind !== "VERIFIED") {
    return targets.flatMap((mediaId) => {
      const logs = segmentLogs(receipt, mediaId, kind, review);
      return logs.length ? [toAction({ kind: "ADD_VIDEO_LOGS", mediaId, logs })] : [];
    });
  }

  const status = receipt.humanReviewStatus;
  const perMedia = targets.map((mediaId) => {
    const tagNames =
      status === "APPROVED"
        ? [T.verifiedVerdictTags[mediaVerdict(receipt, mediaId)], T.reviewTags.APPROVED]
        : status === "REJECTED"
          ? [T.reviewTags.REJECTED]
          : [];
    return { mediaId, tagNames, logs: segmentLogs(receipt, mediaId, kind, review) };
  });
  const ensure = [...new Set(perMedia.flatMap((m) => m.tagNames))].map((name) => toAction({ kind: "ENSURE_TAG_OPTION", name }));
  const managed = managedTagNames();
  return [
    ...ensure,
    ...perMedia.flatMap(({ mediaId, tagNames, logs }) => [
      ...(tagNames.length ? [toAction({ kind: "ADD_MEDIA_TAGS", mediaId, tagNames })] : []),
      ...(logs.length ? [toAction({ kind: "ADD_VIDEO_LOGS", mediaId, logs })] : []),
      ...(tagNames.length
        ? [toAction({ kind: "REMOVE_SUPERSEDED_TAGS", mediaId, tagNames: managed.filter((n) => !tagNames.includes(n)) })]
        : []),
      ...(logs.length ? [toAction({ kind: "REMOVE_SUPERSEDED_LOGS", mediaId, receiptId: receipt.id })] : []),
    ]),
  ];
}

/** Contract shape (`WritebackResponse.planned`): strips the structured op. */
export function toScorePlayActions(plan: PlannedAction[]): ScorePlayAction[] {
  return plan.map(({ method, path, body, purpose }) => ({ method, path, body, purpose }));
}

// ---------- Apply (LIVE) ----------

/** Video-log read-back → seconds. `timestamp` is seconds; `start/end_timestamp` are milliseconds (documented). */
function logView(l: ScorePlayVideoLog): MediaReadBack["logs"][number] {
  const ranged = (l.end_timestamp ?? 0) > 0;
  return {
    id: l.id,
    start: ranged ? (l.start_timestamp ?? 0) / 1000 : (l.timestamp ?? undefined),
    end: ranged ? l.end_timestamp! / 1000 : undefined,
    comment: l.comment ?? "",
  };
}

type MediaState = { tagIds: Set<number>; tagNames: Map<number, string>; isVideo: boolean; companyId?: number | null };

async function readMedia(client: ScorePlayHttpClient, mediaId: string): Promise<MediaState> {
  const m = await client.getMedia(mediaId);
  const tagNames = new Map<number, string>();
  for (const t of m.tags ?? []) if (t.tag_option_id) tagNames.set(t.tag_option_id, (t.tag_option?.name ?? t.name ?? "").toLowerCase());
  return { tagIds: new Set([...tagNames.keys(), ...(m.tag_option_ids ?? [])]), tagNames, isVideo: m.type === "video", companyId: m.company_id };
}

/**
 * Executes a plan from `planWriteback`.
 * 1. Preflight (reads only): refusal re-check, `can_do_media_edit`, and EVERY target must be a video with a
 *    `company_id` — otherwise nothing at all is written.
 * 2. Resolve/create tag options.
 * 3. Per media: add tags → add logs → re-read. Superseded REROUTE tags are removed once the new tags are
 *    verified; this receipt's earlier logs once the new logs are verified. Never deletes before a verified add.
 * Throws for preflight failures; per-media upstream errors after preflight become FAILED.
 */
export async function applyWriteback(
  receipt: RightsReceipt,
  plan: PlannedAction[],
  client: ScorePlayHttpClient,
): Promise<Record<string, MediaReadBack>> {
  const refusal = liveRefusal(receipt);
  if (refusal) throw new AppError("FORBIDDEN", refusal);
  const who = await client.whoami();
  if (!(who.rights ?? []).includes("can_do_media_edit")) {
    throw new AppError("FORBIDDEN", "ScorePlay API key lacks can_do_media_edit (GET /whoami); live writeback not authorized");
  }

  const byMedia = new Map<string, WritebackOp[]>();
  for (const { op } of plan) {
    if (op.kind === "ENSURE_TAG_OPTION") continue;
    byMedia.set(op.mediaId, [...(byMedia.get(op.mediaId) ?? []), op]);
  }
  const initial = new Map<string, MediaState & { companyId: number }>();
  for (const mediaId of byMedia.keys()) {
    const state = await readMedia(client, mediaId);
    if (!state.isVideo) throw new AppError("BAD_REQUEST", `Media ${mediaId} is not a video; timecoded logs impossible — nothing was written`);
    if (state.companyId == null) throw new AppError("UPSTREAM", `Media ${mediaId} has no company_id (required by POST /video/logs) — nothing was written`);
    initial.set(mediaId, { ...state, companyId: state.companyId });
  }

  const tagIds = new Map<string, number>();
  for (const { op } of plan) {
    if (op.kind !== "ENSURE_TAG_OPTION") continue;
    const existing = await client.findTagOption(op.name);
    tagIds.set(op.name, existing?.ID ?? (await client.createTagOption(op.name, T.tagOptionType)).ID);
  }
  const idOf = (name: string): number => {
    const id = tagIds.get(name);
    if (id === undefined) throw new AppError("INTERNAL", `Plan has no ENSURE_TAG_OPTION for "${name}"`);
    return id;
  };

  const marker = receiptMarker(receipt.id);
  const managed = new Set(managedTagNames());
  const out: Record<string, MediaReadBack> = {};
  for (const [mediaId, ops] of byMedia) {
    try {
      const before = initial.get(mediaId)!;
      const earlierIds = new Set((await client.listVideoLogs(mediaId)).filter((l) => l.comment?.startsWith(marker)).map((l) => l.id));
      const addTags = ops.find((o) => o.kind === "ADD_MEDIA_TAGS");
      const addLogs = ops.find((o) => o.kind === "ADD_VIDEO_LOGS");

      // 1. Add.
      const missing = (addTags?.tagNames ?? []).map(idOf).filter((id) => !before.tagIds.has(id));
      if (missing.length) await client.addMediaTags(mediaId, missing);
      const plannedLogs = addLogs?.logs ?? [];
      if (plannedLogs.length) await client.addVideoLogs(before.companyId, Number(mediaId), plannedLogs);

      // 2. Verify by re-reading; tags and logs are verified independently.
      let after = await readMedia(client, mediaId);
      let logs = (await client.listVideoLogs(mediaId)).filter((l) => l.comment?.startsWith(marker));
      const problems: string[] = [];
      const absentTags = (addTags?.tagNames ?? []).filter((n) => !after.tagIds.has(idOf(n)));
      if (absentTags.length) problems.push(`tags not visible on re-read: ${absentTags.join(", ")}`);
      const newComments = logs.filter((l) => !earlierIds.has(l.id)).map((l) => l.comment ?? "");
      const absentLogs = plannedLogs.filter((p) => !newComments.includes(p.comment));
      if (absentLogs.length) problems.push(`${absentLogs.length} of ${plannedLogs.length} new log(s) not visible on re-read`);

      // 3. Remove superseded items only behind their own verified add.
      let removed = false;
      const removeTags = ops.find((o) => o.kind === "REMOVE_SUPERSEDED_TAGS");
      if (removeTags && absentTags.length === 0) {
        const names = new Set(removeTags.tagNames);
        const stale = [...after.tagNames].filter(([, n]) => names.has(n) && managed.has(n)).map(([id]) => id);
        if (stale.length) {
          await client.removeMediaTags(mediaId, stale);
          removed = true;
        }
      }
      if (ops.some((o) => o.kind === "REMOVE_SUPERSEDED_LOGS") && absentLogs.length === 0 && earlierIds.size) {
        await client.deleteVideoLogs(mediaId, [...earlierIds]);
        removed = true;
      }
      if (removed) {
        after = await readMedia(client, mediaId);
        logs = (await client.listVideoLogs(mediaId)).filter((l) => l.comment?.startsWith(marker));
        const staleTags = (removeTags?.tagNames ?? []).filter((n) => [...after.tagNames.values()].includes(n));
        if (absentTags.length === 0 && staleTags.length) problems.push(`superseded tags still present: ${staleTags.join(", ")}`);
        const lingering = absentLogs.length === 0 ? logs.filter((l) => earlierIds.has(l.id)).length : 0;
        if (lingering) problems.push(`${lingering} superseded log(s) still present`);
      }

      out[mediaId] = {
        status: problems.length === 0 ? "VERIFIED" : "WRITTEN",
        at: new Date().toISOString(),
        ...(problems.length ? { detail: problems.join("; ") } : {}),
        tags: [...new Set([...after.tagNames.values()].filter((n) => managed.has(n)))],
        logs: logs.map(logView),
      };
    } catch (err) {
      out[mediaId] = {
        status: "FAILED",
        at: new Date().toISOString(),
        detail: err instanceof Error ? err.message : String(err),
        tags: [],
        logs: [],
      };
    }
  }
  return out;
}
