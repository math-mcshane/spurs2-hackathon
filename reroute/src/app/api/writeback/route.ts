import type { z } from "zod";
import { RightsReceiptSchema, WritebackRequestSchema, type RightsReceipt, type WritebackResponseSchema } from "@/lib/contracts";
import {
  applyWriteback,
  getScorePlayHttpClient,
  planWriteback,
  toScorePlayActions,
  writebackMode,
  writebackTargets,
  type MediaReadBack,
} from "@/lib/scoreplay";
import { requireReviewer } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { writebackAttempts } from "@/lib/server/repositories";
import { getReceipt, updateReceipt } from "@/lib/server/store";

type Entry = RightsReceipt["writeback"][number];
const SEVERITY: Record<Entry["status"], number> = { VERIFIED: 0, DRY_RUN: 0, REFUSED: 0, WRITTEN: 1, FAILED: 2 };

/**
 * POST /api/writeback {receiptId} — reviewer only. Always plans the documented ScorePlay mutations.
 * LIVE only when SCOREPLAY_WRITEBACK_MODE=live AND the policy is verified (not fictional) AND the receipt
 * was reviewed (APPROVED|REJECTED); otherwise DRY_RUN (nothing sent) with `refusedReason` when relevant.
 * Every attempt is recorded (writebackAttempts) and appended to receipt.writeback per source media.
 */
export const POST = route(async (req: Request) => {
  const { reviewer: actor } = await requireReviewer(req);
  const { receiptId } = await parseBody(req, WritebackRequestSchema);
  const stored = await getReceipt(receiptId);
  const receipt = RightsReceiptSchema.parse(stored);
  const lastReview = stored.reviews.at(-1);
  const plan = planWriteback(receipt, { reviewer: lastReview?.reviewer, reviewedAt: lastReview?.at });
  const planned = toScorePlayActions(plan);
  const decided = writebackMode(receipt);
  const targets = writebackTargets(receipt);

  let entries: Entry[];
  let readBack: Record<string, MediaReadBack> | undefined;
  if (decided.mode === "DRY_RUN") {
    const at = new Date().toISOString();
    const detail = decided.refusedReason ?? "Dry-run (SCOREPLAY_WRITEBACK_MODE is not live): nothing sent to ScorePlay";
    entries = targets.map((scoreplayMediaId) => ({ scoreplayMediaId, status: decided.status, at, detail }));
  } else {
    try {
      readBack = await applyWriteback(receipt, plan, getScorePlayHttpClient());
      const at = new Date().toISOString();
      entries = targets.map((scoreplayMediaId) => {
        const r = readBack?.[scoreplayMediaId];
        return r
          ? { scoreplayMediaId, status: r.status, at: r.at, ...(r.detail ? { detail: r.detail } : {}) }
          : { scoreplayMediaId, status: "FAILED", at, detail: "No read-back returned for this media" };
      });
    } catch (err) {
      const at = new Date().toISOString();
      const detail = err instanceof Error ? err.message : String(err);
      entries = targets.map((scoreplayMediaId) => ({ scoreplayMediaId, status: "FAILED", at, detail }));
    }
  }

  const worst = entries.reduce<Entry | undefined>((a, e) => (!a || SEVERITY[e.status] > SEVERITY[a.status] ? e : a), undefined);
  await writebackAttempts.record({
    receiptId,
    mode: decided.mode,
    planned,
    status: worst?.status ?? (decided.mode === "DRY_RUN" ? decided.status : "VERIFIED"),
    ...(worst?.detail ? { detail: worst.detail } : {}),
    actor,
  });
  const updated = await updateReceipt(receiptId, (r) => ({ ...r, writeback: [...r.writeback, ...entries] }));
  return Response.json({
    mode: decided.mode,
    receipt: updated,
    planned,
    ...(decided.mode === "DRY_RUN" && decided.refusedReason ? { refusedReason: decided.refusedReason } : {}),
    ...(readBack ? { readBack } : {}),
  } satisfies z.infer<typeof WritebackResponseSchema>);
});
