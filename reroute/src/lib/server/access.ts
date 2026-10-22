import type { z } from "zod";
import { canPublish, type AccessActionSchema, type AccessResponseSchema, type EditPlan, type PublishIntent } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { decideEdit, type DecideOptions } from "./decide";
import { createReceipt, findReceiptFor, type StoredReceipt } from "./store";

type AccessAction = z.infer<typeof AccessActionSchema>;
type AccessResponse = z.infer<typeof AccessResponseSchema>;

/** Actions that put the edit in front of an audience: governed by `canPublish` (verified clearance + approval). */
const PUBLISHING: Record<AccessAction, boolean> = { PREVIEW: false, RENDER: false, EXPORT: true, DELIVER: true };

/** Store unavailable ⇒ no receipt bookkeeping (never a fake id); every other error propagates. */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_CONFIGURED") return null;
    throw err;
  }
}

/**
 * App-level gate (spec §4.6). Always re-evaluates server-side; a client-sent verdict is never trusted.
 * - BLOCKED ⇒ BLOCKED.
 * - PREVIEW/RENDER need ALLOWED, or a human APPROVED receipt for this exact edit + intent + policy version.
 * - EXPORT/DELIVER need `canPublish` (ALLOWED under a VERIFIED policy AND approved) — demo clearance never publishes.
 * - Otherwise REQUEST_REVIEW, reusing the matching receipt or creating one PENDING receipt (no duplicates).
 * This gates REROUTE actions only; it does not change ScorePlay ACLs.
 */
export async function checkAccess(edit: EditPlan, intent: PublishIntent, action: AccessAction, opts: DecideOptions = {}): Promise<AccessResponse> {
  const decided = await decideEdit(edit, intent, opts);
  const { decision } = decided;
  if (decision.verdict === "BLOCKED") return { granted: false, uiAction: "BLOCKED", decision };

  const found = await orNull(findReceiptFor({ editId: edit.id, intent, policyVersion: decision.policyVersion }));
  // Same id but different cut ⇒ a different edit; its review does not carry over.
  const receipt: StoredReceipt | null = found && JSON.stringify(found.edit.segments) === JSON.stringify(edit.segments) ? found : null;
  const status = receipt?.humanReviewStatus ?? "PENDING";
  const withReceipt = receipt ? { receiptId: receipt.id } : {};

  if (status === "REJECTED") return { granted: false, uiAction: "BLOCKED", decision, ...withReceipt };
  if (PUBLISHING[action]) {
    if (canPublish({ decision, humanReviewStatus: status })) return { granted: true, uiAction: "USE", decision, ...withReceipt };
    // Reviewed already, yet not publishable (demo clearance or not ALLOWED): another review cannot change that.
    if (status === "APPROVED") return { granted: false, uiAction: "BLOCKED", decision, ...withReceipt };
  } else if (decision.verdict === "ALLOWED" || status === "APPROVED") {
    return { granted: true, uiAction: "USE", decision, ...withReceipt };
  }

  if (receipt) return { granted: false, uiAction: "REQUEST_REVIEW", decision, receiptId: receipt.id };
  const created = await orNull(createReceipt({ edit, intent, decision, media: decided.media }));
  return { granted: false, uiAction: "REQUEST_REVIEW", decision, ...(created ? { receiptId: created.id } : {}) };
}
