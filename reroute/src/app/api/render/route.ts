import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { RenderRequestSchema, canPublish, type EditPlan, type RenderResponseSchema } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getScorePlayClient } from "@/lib/scoreplay";
import { requireReviewer } from "@/lib/server/auth";
import { loadDecisionContext } from "@/lib/server/context";
import { evaluateEditInContext } from "@/lib/server/decide";
import { parseBody, route } from "@/lib/server/http";
import { mediaProcessingApproved, renderEdit } from "@/lib/server/render";
import { createReceipt, updateReceipt } from "@/lib/server/store";

/**
 * POST /api/render — derivative MP4, only if MEDIA_PROCESSING_APPROVED=true AND the access gate
 * grants RENDER (fresh server-side verdict ALLOWED). The output is a NEW asset with its own
 * decision and a PENDING review receipt. It is uploaded to ScorePlay only when that receipt passes
 * `canPublish` (verified clearance + human approval) AND SCOREPLAY_UPLOAD_APPROVED=true — a fresh
 * PENDING receipt never does, so demo/unreviewed derivatives are never uploaded.
 */
export const POST = route(async (req: Request) => {
  await requireReviewer(req);
  // Checked first: when disabled, nothing is parsed, rendered or written to disk.
  if (!mediaProcessingApproved()) {
    throw new AppError("FORBIDDEN", "Media processing is not approved (MEDIA_PROCESSING_APPROVED != true)");
  }
  const { edit, intent } = await parseBody(req, RenderRequestSchema);

  const ctx = await loadDecisionContext(edit, { club: intent.club });
  const gate = evaluateEditInContext(ctx, edit, intent, { now: new Date() });
  if (gate.decision.verdict !== "ALLOWED") {
    throw new AppError("FORBIDDEN", `Render denied: edit is ${gate.decision.verdict} for this intent`);
  }

  // The rendered file is a distinct asset: its own plan, its own decision, its own review.
  const derivative: EditPlan = {
    ...edit,
    title: `${edit.title} (derivative render)`,
    derived: true,
    derivedFrom: edit.derived ? (edit.derivedFrom ?? edit.id) : edit.id,
  };
  const { decision } = evaluateEditInContext(ctx, derivative, intent, { now: new Date() });
  const id = randomUUID();
  const file = await renderEdit(id, derivative.segments, ctx.assets);
  const media = ctx.mediaRefs(derivative.segments.map((s) => s.scoreplayMediaId));
  let receipt = await createReceipt({ id, edit: derivative, intent, decision, media });

  const scoreplay = getScorePlayClient();
  if (scoreplay.uploadDerivative && canPublish(receipt)) {
    try {
      const uploaded = await scoreplay.uploadDerivative({ path: file, title: derivative.title }, receipt);
      receipt = await updateReceipt(id, (r) => ({ ...r, derivativeAssetId: uploaded.id }));
    } catch (err) {
      if (!(err instanceof AppError && err.code === "NOT_CONFIGURED")) throw err;
    }
  }

  return Response.json(
    { receipt, outputUrl: `/api/render/${id}` } satisfies z.infer<typeof RenderResponseSchema>,
    { status: 201 },
  );
});
