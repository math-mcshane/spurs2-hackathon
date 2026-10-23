import { connection } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseBody, route } from "@/lib/server/http";
import { triggerComplianceJob, complianceJobConfigured } from "@/lib/databricks/jobs";

const BodySchema = z.object({
  mediaId: z.string().min(1),
  force: z.boolean().optional(),
});

/**
 * POST /api/l2/enqueue — trigger Databricks compliance pipeline for one media
 * (L1 → enrich → enqueue L2 → passport → Supabase sync).
 */
export const POST = route(async (req: Request) => {
  await connection();
  if (!complianceJobConfigured()) {
    throw new AppError(
      "NOT_CONFIGURED",
      "DATABRICKS_HOST/URL, DATABRICKS_TOKEN/API_KEY, DATABRICKS_COMPLIANCE_JOB_ID required",
    );
  }
  const { mediaId, force } = await parseBody(req, BodySchema);
  const result = await triggerComplianceJob({
    mediaId,
    force: force ?? true,
    runMode: "incremental",
  });
  if (!result.ok) throw new AppError("UPSTREAM", result.error);
  if (result.skipped) {
    return Response.json({ ok: true, skipped: true, reason: result.reason });
  }
  return Response.json({
    ok: true,
    skipped: false,
    runId: result.runId,
    jobId: result.jobId,
    note: "Pipeline will enqueue L2 passport after enrich; poll GET /api/passport?mediaId=",
  });
});
