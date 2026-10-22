import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { RenderRequestSchema, type EditPlan, type RenderResponseSchema } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { loadPolicy } from "@/lib/rights";
import { getScorePlayClient } from "@/lib/scoreplay";
import { loadDecisionContext } from "@/lib/server/context";
import { evaluateEditInContext } from "@/lib/server/decide";
import { parseBody, route } from "@/lib/server/http";
import { mediaProcessingApproved, renderEdit } from "@/lib/server/render";
import { createReceipt, updateReceipt } from "@/lib/server/store";

/**
 * POST /api/render — derivative MP4, only if MEDIA_PROCESSING_APPROVED=true AND the access gate
 * grants RENDER (fresh server-side verdict ALLOWED). The output is a NEW asset with its own
 * decision and a PENDING review receipt; uploaded to ScorePlay only if that is permitted.
 */
export const POST = route(async (req: Request) => {
  const { edit, intent } = await parseBody(req, RenderRequestSchema);
  if (!mediaProcessingApproved()) {
    throw new AppError("FORBIDDEN", "Media processing is not approved (MEDIA_PROCESSING_APPROVED != true)");
  }

  const policy = loadPolicy();
  const ctx = await loadDecisionContext(edit);
  const gate = evaluateEditInContext(ctx, edit, intent, policy, new Date());
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
  const { decision } = evaluateEditInContext(ctx, derivative, intent, policy, new Date());
  const id = randomUUID();
  const file = await renderEdit(id, derivative.segments, ctx.assets);
  let receipt = await createReceipt({ id, edit: derivative, intent, decision });

  const scoreplay = getScorePlayClient();
  if (scoreplay.uploadDerivative) {
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
