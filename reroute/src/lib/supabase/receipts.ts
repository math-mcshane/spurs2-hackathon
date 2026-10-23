import { randomUUID } from "node:crypto";
import {
  RightsReceiptSchema,
  type Decision,
  type EditPlan,
  type HumanReviewStatus,
  type PublishIntent,
  type RightsReceipt,
} from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type ReviewRecord = {
  status: "APPROVED" | "REJECTED";
  reviewer: string;
  at: string;
};

export type StoredReceipt = RightsReceipt & { reviews: ReviewRecord[] };

type ReceiptRow = {
  id: string;
  source_asset_ids: string[];
  derivative_asset_id: string | null;
  intent: unknown;
  decision: unknown;
  edit: unknown;
  human_review_status: HumanReviewStatus;
  writeback: unknown;
  created_at: string;
};

function rowToReceipt(row: ReceiptRow): RightsReceipt {
  let createdAt = row.created_at;
  if (createdAt && !/[zZ]|[+-]\d{2}:\d{2}$/.test(createdAt)) {
    createdAt = `${createdAt}Z`;
  }
  return RightsReceiptSchema.parse({
    id: row.id,
    sourceAssetIds: row.source_asset_ids ?? [],
    derivativeAssetId: row.derivative_asset_id ?? undefined,
    intent: row.intent,
    decision: row.decision,
    edit: row.edit,
    humanReviewStatus: row.human_review_status,
    createdAt,
    writeback: row.writeback ?? [],
  });
}

function receiptToRow(r: RightsReceipt) {
  return {
    id: r.id,
    source_asset_ids: r.sourceAssetIds,
    derivative_asset_id: r.derivativeAssetId ?? null,
    intent: r.intent,
    decision: r.decision,
    edit: r.edit,
    human_review_status: r.humanReviewStatus,
    writeback: r.writeback ?? [],
    created_at: r.createdAt,
  };
}

async function loadReviews(receiptId: string): Promise<ReviewRecord[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("reviews")
    .select("status,reviewer,at")
    .eq("receipt_id", receiptId)
    .order("at", { ascending: true });
  if (error) throw new AppError("UPSTREAM", error.message);
  return (data ?? []).map((r) => ({
    status: r.status as "APPROVED" | "REJECTED",
    reviewer: r.reviewer as string,
    at: r.at as string,
  }));
}

export async function createReceiptSb(input: {
  id?: string;
  edit: EditPlan;
  intent: PublishIntent;
  decision: Decision;
}): Promise<StoredReceipt> {
  const receipt: RightsReceipt = {
    id: input.id ?? randomUUID(),
    sourceAssetIds: [...new Set(input.edit.segments.map((s) => s.scoreplayMediaId))],
    intent: input.intent,
    decision: input.decision,
    edit: input.edit,
    media: [],
    humanReviewStatus: "PENDING",
    createdAt: new Date().toISOString(),
    writeback: [],
  };
  const { error } = await getSupabaseAdmin().from("receipts").upsert(receiptToRow(receipt));
  if (error) throw new AppError("UPSTREAM", error.message);
  return { ...receipt, reviews: [] };
}

export async function getReceiptSb(id: string): Promise<StoredReceipt> {
  const { data, error } = await getSupabaseAdmin().from("receipts").select("*").eq("id", id).maybeSingle();
  if (error) throw new AppError("UPSTREAM", error.message);
  if (!data) throw new AppError("NOT_FOUND", `Receipt ${id} not found`);
  const receipt = rowToReceipt(data as ReceiptRow);
  return { ...receipt, reviews: await loadReviews(id) };
}

export async function updateReceiptSb(
  id: string,
  mutate: (r: RightsReceipt) => RightsReceipt,
): Promise<StoredReceipt> {
  const current = await getReceiptSb(id);
  const next = RightsReceiptSchema.parse(mutate(structuredClone(current)));
  const { error } = await getSupabaseAdmin().from("receipts").upsert(receiptToRow(next));
  if (error) throw new AppError("UPSTREAM", error.message);
  return { ...next, reviews: current.reviews };
}

export async function recordReviewSb(
  id: string,
  review: { status: Exclude<HumanReviewStatus, "PENDING">; reviewer: string },
  guard: (r: RightsReceipt) => void,
): Promise<StoredReceipt> {
  const current = await getReceiptSb(id);
  guard(current);
  const at = new Date().toISOString();
  const next: RightsReceipt = { ...current, humanReviewStatus: review.status };
  const sb = getSupabaseAdmin();
  const { error: upErr } = await sb.from("receipts").upsert(receiptToRow(next));
  if (upErr) throw new AppError("UPSTREAM", upErr.message);
  const { error: revErr } = await sb.from("reviews").insert({
    receipt_id: id,
    status: review.status,
    reviewer: review.reviewer,
    at,
  });
  if (revErr) throw new AppError("UPSTREAM", revErr.message);
  return { ...next, reviews: [...current.reviews, { ...review, at }] };
}
