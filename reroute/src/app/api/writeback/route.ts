import { z } from "zod";
import {
  RightsReceiptSchema,
  WritebackRequestSchema,
  type RightsReceipt,
  type WritebackResponseSchema,
} from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getScorePlayClient } from "@/lib/scoreplay";
import { parseBody, route } from "@/lib/server/http";
import { getReceipt, updateReceipt } from "@/lib/server/store";

/** Per-asset outcome ScorePlay's writeDecision reports after re-reading each target. */
const ReadBackSchema = z.record(
  z.string(),
  z.looseObject({
    status: z.enum(["WRITTEN", "VERIFIED", "FAILED"]),
    at: z.string(),
    detail: z.string().optional(),
  }),
);

/**
 * POST /api/writeback — write the receipt's verdict + reasoning to ScorePlay, re-read it,
 * and append per-asset WRITTEN/VERIFIED/FAILED entries to the receipt.
 */
export const POST = route(async (req: Request) => {
  const { receiptId } = await parseBody(req, WritebackRequestSchema);
  // Contract shape only (drops the local review trail) — that is what ScorePlay records.
  const receipt = RightsReceiptSchema.parse(await getReceipt(receiptId));
  const readBack = await getScorePlayClient().writeDecision(receipt);

  const parsed = ReadBackSchema.safeParse(readBack);
  if (!parsed.success) {
    throw new AppError("UPSTREAM", `Unexpected ScorePlay read-back: ${z.prettifyError(parsed.error)}`);
  }
  const targets = receipt.derivativeAssetId ? [receipt.derivativeAssetId] : receipt.sourceAssetIds;
  const at = new Date().toISOString();
  const entries: RightsReceipt["writeback"] = targets.map((id) => {
    const r = parsed.data[id];
    return r
      ? { scoreplayMediaId: id, status: r.status, at: r.at, ...(r.detail ? { detail: r.detail } : {}) }
      : { scoreplayMediaId: id, status: "FAILED", at, detail: "No read-back returned for this asset" };
  });
  const updated = await updateReceipt(receiptId, (r) => ({ ...r, writeback: [...r.writeback, ...entries] }));
  return Response.json({ receipt: updated, readBack } satisfies z.infer<typeof WritebackResponseSchema>);
});
