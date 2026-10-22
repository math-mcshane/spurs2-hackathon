import { randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  EvidenceSchema,
  RightsReceiptSchema,
  type Decision,
  type EditPlan,
  type Evidence,
  type HumanReviewStatus,
  type PublishIntent,
  type RightsReceipt,
} from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { z } from "zod";

/**
 * Persistent store on Supabase (schema: supabase/migrations/*_reroute_store.sql): receipts, review log,
 * HUMAN observations. Shared by every teammate and deployment; survives redeploys. ScorePlay remains
 * the system of record for media — only ids, decisions and evidence text live here.
 */

const ReviewRecordSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reviewer: z.string(),
  at: z.iso.datetime({ offset: true }),
});
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;

/** Receipt as returned by the API: the contract shape plus the review audit trail. */
export type StoredReceipt = RightsReceipt & { reviews: ReviewRecord[] };

const MAX_UPDATE_ATTEMPTS = 3;

function fail(op: string, error: PostgrestError): never {
  // 42P01 / PGRST205: table missing → migration not applied yet.
  const missing = error.code === "42P01" || error.code === "PGRST205";
  throw new AppError(
    missing ? "NOT_CONFIGURED" : "UPSTREAM",
    missing
      ? `Supabase tables missing (${op}): run supabase/migrations/20261022190000_reroute_store.sql in the SQL Editor`
      : `Supabase ${op} failed: ${error.message}`,
  );
}

function row(receipt: RightsReceipt) {
  return {
    receipt,
    verdict: receipt.decision.verdict,
    human_review_status: receipt.humanReviewStatus,
    source_asset_ids: receipt.sourceAssetIds,
  };
}

async function loadReceipt(id: string): Promise<{ receipt: RightsReceipt; version: number }> {
  const { data, error } = await getSupabaseAdmin()
    .from("reroute_receipts")
    .select("receipt, version")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("read receipt", error);
  if (!data) throw new AppError("NOT_FOUND", `Receipt ${id} not found`);
  return { receipt: RightsReceiptSchema.parse(data.receipt), version: data.version as number };
}

async function loadReviews(id: string): Promise<ReviewRecord[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("reroute_reviews")
    .select("status, reviewer, at")
    .eq("receipt_id", id)
    .order("at", { ascending: true });
  if (error) fail("read reviews", error);
  return z.array(ReviewRecordSchema).parse(data.map((r) => ({ ...r, at: new Date(r.at).toISOString() })));
}

/**
 * Optimistic read-modify-write: the update only lands if nobody bumped `version` in between;
 * otherwise re-read and retry. `mutate` may throw (e.g. a review guard) to abort.
 */
async function mutateReceipt(id: string, mutate: (r: RightsReceipt) => RightsReceipt): Promise<RightsReceipt> {
  for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
    const { receipt, version } = await loadReceipt(id);
    const next = RightsReceiptSchema.parse(mutate(structuredClone(receipt)));
    const { data, error } = await getSupabaseAdmin()
      .from("reroute_receipts")
      .update({ ...row(next), version: version + 1, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("version", version)
      .select("id");
    if (error) fail("update receipt", error);
    if (data.length === 1) return next;
  }
  throw new AppError("UPSTREAM", `Receipt ${id} is being modified concurrently; retry`);
}

// ---------- Receipts ----------

/** `id` may be preallocated (render writes `.renders/<id>.mp4` before the receipt exists). */
export async function createReceipt(input: {
  id?: string;
  edit: EditPlan;
  intent: PublishIntent;
  decision: Decision;
}): Promise<StoredReceipt> {
  const receipt: RightsReceipt = RightsReceiptSchema.parse({
    id: input.id ?? randomUUID(),
    sourceAssetIds: [...new Set(input.edit.segments.map((s) => s.scoreplayMediaId))],
    intent: input.intent,
    decision: input.decision,
    edit: input.edit,
    humanReviewStatus: "PENDING",
    createdAt: new Date().toISOString(),
    writeback: [],
  });
  const { error } = await getSupabaseAdmin()
    .from("reroute_receipts")
    .insert({ id: receipt.id, ...row(receipt) });
  if (error) fail("create receipt", error);
  return { ...receipt, reviews: [] };
}

export async function getReceipt(id: string): Promise<StoredReceipt> {
  const [{ receipt }, reviews] = await Promise.all([loadReceipt(id), loadReviews(id)]);
  return { ...receipt, reviews };
}

/** Apply a mutation to one receipt; the result is re-validated against the contract before saving. */
export async function updateReceipt(id: string, mutate: (r: RightsReceipt) => RightsReceipt): Promise<StoredReceipt> {
  const next = await mutateReceipt(id, mutate);
  return { ...next, reviews: await loadReviews(id) };
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
  const { error } = await getSupabaseAdmin()
    .from("reroute_reviews")
    .insert({ receipt_id: id, status: review.status, reviewer: review.reviewer, at });
  if (error) fail("record review", error);
  return { ...next, reviews: await loadReviews(id) };
}

// ---------- HUMAN observations ----------

export async function addHumanObservation(evidence: Evidence): Promise<Evidence> {
  const stored: Evidence = EvidenceSchema.parse({ ...evidence, source: "HUMAN", origin: "HUMAN" });
  const { error } = await getSupabaseAdmin()
    .from("reroute_observations")
    .insert({ scoreplay_media_id: stored.scoreplayMediaId, evidence: stored });
  if (error) fail("add observation", error);
  return stored;
}

export async function listHumanObservations(scoreplayMediaId: string): Promise<Evidence[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("reroute_observations")
    .select("evidence")
    .eq("scoreplay_media_id", scoreplayMediaId)
    .order("created_at", { ascending: true });
  if (error) fail("list observations", error);
  return data.map((r) => EvidenceSchema.parse(r.evidence));
}
