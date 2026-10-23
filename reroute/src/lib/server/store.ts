import { randomUUID } from "node:crypto";
import {
  EvidenceSchema,
  MediaRefSchema,
  RightsReceiptSchema,
  type Decision,
  type EditPlan,
  type Evidence,
  type HumanReviewStatus,
  type MediaRef,
  type PublishIntent,
  type RightsReceipt,
} from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import {
  campaigns,
  events,
  humanObservationRecords,
  receiptRecords,
  type AuditEvent,
  type ReceiptRow,
  type ReviewRecord,
} from "@/lib/server/repositories";
import { casUpdate } from "@/lib/server/repositories/shared";
import { z } from "zod";

/**
 * Receipt workflow on the persistent store (Supabase; schema in supabase/migrations): receipts, review
 * log, HUMAN observations, each change recorded as a hash-chained audit event. ScorePlay remains the
 * system of record for media — only ids, decisions and evidence text live here.
 */

export type { ReviewRecord };

/**
 * Receipt as returned by the API: the contract shape plus the review audit trail and, for campaign receipts,
 * the campaign version it covers.
 */
export type StoredReceipt = RightsReceipt & { reviews: ReviewRecord[]; campaignVersion?: number };

async function stored(row: ReceiptRow): Promise<StoredReceipt> {
  return { ...row.receipt, campaignVersion: row.campaignVersion, reviews: await receiptRecords.listReviews(row.receipt.id) };
}

/** Audit actor for changes made by the server itself rather than a signed-in reviewer. */
export const SYSTEM_ACTOR = "system";

/**
 * Optimistic read-modify-write: the update only lands if nobody bumped the version in between;
 * otherwise re-read and retry. `mutate` may throw (e.g. a review guard) to abort.
 */
async function mutateReceipt(id: string, mutate: (r: RightsReceipt) => RightsReceipt): Promise<RightsReceipt> {
  const { value } = await casUpdate(
    `Receipt ${id}`,
    async () => {
      const { receipt, version } = await receiptRecords.load(id);
      return { value: receipt, version };
    },
    (next, version) => receiptRecords.compareAndSet(id, version, RightsReceiptSchema.parse(next)),
    (current) => RightsReceiptSchema.parse(mutate(current)),
  );
  return value;
}

// ---------- Receipts ----------

/** `id` may be preallocated (render writes `.renders/<id>.mp4` before the receipt exists). */
export async function createReceipt(
  input: {
    id?: string;
    edit: EditPlan;
    /** The use the decision is keyed on (the worst use for a campaign). */
    intent: PublishIntent;
    /** Every use the decision covers; a campaign receipt approves all of them. */
    intents?: PublishIntent[];
    decision: Decision;
    /** MediaRefs whose evidence informed the decision. */
    media?: MediaRef[];
    actor?: string;
  } & (
    | { campaignId?: undefined; campaignVersion?: undefined }
    /** Goal flow: the campaign and the exact version this receipt covers (must be the current one). */
    | { campaignId: string; campaignVersion: number }
  ),
): Promise<StoredReceipt> {
  const receipt: RightsReceipt = RightsReceiptSchema.parse({
    id: input.id ?? randomUUID(),
    campaignId: input.campaignId,
    sourceAssetIds: [...new Set(input.edit.segments.map((s) => s.scoreplayMediaId))],
    intent: input.intent,
    intents: input.intents,
    decision: input.decision,
    edit: input.edit,
    media: z.array(MediaRefSchema).parse(input.media ?? []),
    humanReviewStatus: "PENDING",
    createdAt: new Date().toISOString(),
    writeback: [],
  });
  if (input.campaignId !== undefined) {
    const { currentVersion } = await campaigns.get(input.campaignId);
    if (currentVersion !== input.campaignVersion) {
      throw new AppError("CONFLICT", `Campaign is at version ${currentVersion}; version ${input.campaignVersion} can no longer be submitted`);
    }
  }
  await receiptRecords.insert(receipt, input.campaignVersion);
  if (input.campaignId !== undefined) await campaigns.setState(input.campaignId, { receiptId: receipt.id, reviewStatus: "PENDING" });
  await events.append({
    subjectType: "receipt",
    subjectId: receipt.id,
    type: "RECEIPT_CREATED",
    actor: input.actor ?? SYSTEM_ACTOR,
    payload: {
      campaignId: receipt.campaignId ?? null,
      campaignVersion: input.campaignVersion ?? null,
      verdict: receipt.decision.verdict,
      clearance: receipt.decision.clearance,
      policyId: receipt.decision.policyId,
      policyFictional: receipt.decision.policyFictional,
      sourceAssetIds: receipt.sourceAssetIds,
      uses: (receipt.intents ?? [receipt.intent]).length,
    },
  });
  return { ...receipt, campaignVersion: input.campaignVersion, reviews: [] };
}

export async function getReceipt(id: string): Promise<StoredReceipt> {
  return stored(await receiptRecords.load(id));
}

/** Latest receipt created for a campaign, or null if it was never submitted. */
export async function findReceiptForCampaign(campaignId: string): Promise<StoredReceipt | null> {
  const row = await receiptRecords.latestForCampaign(campaignId);
  return row && stored(row);
}

/**
 * Latest receipt for the same edit, asked for the same use under the same policy version — lets the access
 * gate reuse a pending/approved receipt instead of creating duplicates.
 */
export async function findReceiptFor(q: { editId: string; intent: PublishIntent; policyVersion: string }): Promise<StoredReceipt | null> {
  const sameUse = (i: PublishIntent) =>
    i.territory === q.intent.territory &&
    i.platform === q.intent.platform &&
    i.usage === q.intent.usage &&
    i.competition === q.intent.competition &&
    i.club === q.intent.club &&
    Date.parse(i.publishAt) === Date.parse(q.intent.publishAt);
  const row = (await receiptRecords.findForEdit(q.editId, q.policyVersion)).find((r) => sameUse(r.receipt.intent));
  return row ? stored(row) : null;
}

/** Hash-chained audit events recorded for one receipt, in chain order. */
export function listReceiptAudit(id: string): Promise<AuditEvent[]> {
  return events.list("receipt", id);
}

/** Apply a mutation to one receipt; the result is re-validated against the contract before saving. */
export async function updateReceipt(id: string, mutate: (r: RightsReceipt) => RightsReceipt): Promise<StoredReceipt> {
  await mutateReceipt(id, mutate);
  return getReceipt(id);
}

/**
 * Record a human review decision (status + reviewer + time) on a receipt. Reviews are final: a receipt that
 * is no longer PENDING cannot be reviewed again (CONFLICT), so APPROVED/REJECTED never flip.
 */
export async function recordReview(
  id: string,
  review: { status: Exclude<HumanReviewStatus, "PENDING">; reviewer: string },
  guard: (r: RightsReceipt) => void,
): Promise<StoredReceipt> {
  let at = "";
  const next = await mutateReceipt(id, (current) => {
    if (current.humanReviewStatus !== "PENDING") {
      throw new AppError("CONFLICT", `Receipt ${id} was already ${current.humanReviewStatus}; reviews are final`);
    }
    guard(current);
    // Stamped inside the winning read-modify-write, so `at` order matches the order reviews actually landed.
    at = new Date().toISOString();
    return { ...current, humanReviewStatus: review.status };
  });
  await receiptRecords.addReview(id, { status: review.status, reviewer: review.reviewer, at });
  // The campaign row only mirrors the review while this receipt is still its current submission.
  if (next.campaignId && (await campaigns.get(next.campaignId)).receiptId === id) {
    await campaigns.setState(next.campaignId, { reviewStatus: review.status });
  }
  await events.append({
    subjectType: "receipt",
    subjectId: id,
    type: "REVIEW_RECORDED",
    actor: review.reviewer,
    payload: { status: review.status, verdict: next.decision.verdict, clearance: next.decision.clearance },
  });
  return getReceipt(id);
}

// ---------- HUMAN observations ----------

export async function addHumanObservation(evidence: Evidence, actor: string): Promise<Evidence> {
  const stored: Evidence = EvidenceSchema.parse({ ...evidence, source: "HUMAN", origin: "HUMAN" });
  await humanObservationRecords.add(stored);
  await events.append({
    subjectType: "media",
    subjectId: stored.scoreplayMediaId,
    type: "HUMAN_OBSERVATION_ADDED",
    actor,
    payload: stored,
  });
  return stored;
}

export function listHumanObservations(scoreplayMediaId: string): Promise<Evidence[]> {
  return humanObservationRecords.list(scoreplayMediaId);
}
