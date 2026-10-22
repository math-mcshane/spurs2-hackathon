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
import {
  campaigns,
  events,
  humanObservationRecords,
  receiptRecords,
  type AuditEvent,
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

/** Receipt as returned by the API: the contract shape plus the review audit trail. */
export type StoredReceipt = RightsReceipt & { reviews: ReviewRecord[] };

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
export async function createReceipt(input: {
  id?: string;
  edit: EditPlan;
  intent: PublishIntent;
  decision: Decision;
  /** Campaign this receipt belongs to (goal flow); omitted for the advanced rights desk. */
  campaignId?: string;
  /** MediaRefs whose evidence informed the decision. */
  media?: MediaRef[];
  actor?: string;
}): Promise<StoredReceipt> {
  const receipt: RightsReceipt = RightsReceiptSchema.parse({
    id: input.id ?? randomUUID(),
    campaignId: input.campaignId,
    sourceAssetIds: [...new Set(input.edit.segments.map((s) => s.scoreplayMediaId))],
    intent: input.intent,
    decision: input.decision,
    edit: input.edit,
    media: z.array(MediaRefSchema).parse(input.media ?? []),
    humanReviewStatus: "PENDING",
    createdAt: new Date().toISOString(),
    writeback: [],
  });
  await receiptRecords.insert(receipt);
  if (receipt.campaignId) await campaigns.setState(receipt.campaignId, { receiptId: receipt.id, reviewStatus: "PENDING" });
  await events.append({
    subjectType: "receipt",
    subjectId: receipt.id,
    type: "RECEIPT_CREATED",
    actor: input.actor ?? SYSTEM_ACTOR,
    payload: {
      campaignId: receipt.campaignId ?? null,
      verdict: receipt.decision.verdict,
      clearance: receipt.decision.clearance,
      policyId: receipt.decision.policyId,
      policyFictional: receipt.decision.policyFictional,
      sourceAssetIds: receipt.sourceAssetIds,
    },
  });
  return { ...receipt, reviews: [] };
}

export async function getReceipt(id: string): Promise<StoredReceipt> {
  const [{ receipt }, reviews] = await Promise.all([receiptRecords.load(id), receiptRecords.listReviews(id)]);
  return { ...receipt, reviews };
}

/** Latest receipt created for a campaign, or null if it was never submitted. */
export async function findReceiptForCampaign(campaignId: string): Promise<StoredReceipt | null> {
  const receipt = await receiptRecords.latestForCampaign(campaignId);
  return receipt && { ...receipt, reviews: await receiptRecords.listReviews(receipt.id) };
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
  const receipt = (await receiptRecords.findForEdit(q.editId, q.policyVersion)).find((r) => sameUse(r.intent));
  return receipt ? { ...receipt, reviews: await receiptRecords.listReviews(receipt.id) } : null;
}

/** Hash-chained audit events recorded for one receipt, in chain order. */
export function listReceiptAudit(id: string): Promise<AuditEvent[]> {
  return events.list("receipt", id);
}

/** Apply a mutation to one receipt; the result is re-validated against the contract before saving. */
export async function updateReceipt(id: string, mutate: (r: RightsReceipt) => RightsReceipt): Promise<StoredReceipt> {
  const next = await mutateReceipt(id, mutate);
  return { ...next, reviews: await receiptRecords.listReviews(id) };
}

/** Record a human review decision (status + reviewer + time) on a receipt. */
export async function recordReview(
  id: string,
  review: { status: Exclude<HumanReviewStatus, "PENDING">; reviewer: string },
  guard: (r: RightsReceipt) => void,
): Promise<StoredReceipt> {
  const at = new Date().toISOString();
  const next = await mutateReceipt(id, (current) => {
    guard(current);
    return { ...current, humanReviewStatus: review.status };
  });
  await receiptRecords.addReview(id, { status: review.status, reviewer: review.reviewer, at });
  if (next.campaignId) await campaigns.setState(next.campaignId, { reviewStatus: review.status });
  await events.append({
    subjectType: "receipt",
    subjectId: id,
    type: "REVIEW_RECORDED",
    actor: review.reviewer,
    payload: { status: review.status, verdict: next.decision.verdict, clearance: next.decision.clearance },
  });
  return { ...next, reviews: await receiptRecords.listReviews(id) };
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
