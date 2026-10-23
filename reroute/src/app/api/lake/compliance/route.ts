import { connection } from "next/server";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/server/http";
import { runWarehouseSql, warehouseSqlConfigured } from "@/lib/databricks/sql";

/**
 * GET /api/lake/compliance — live UC gold.compliance_summary via SQL warehouse.
 * Ops/demo path; Studio product reads prefer Supabase mirrors.
 */
export const GET = route(async () => {
  await connection();
  if (!warehouseSqlConfigured()) {
    throw new AppError(
      "NOT_CONFIGURED",
      "DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID required",
    );
  }

  const summary = await runWarehouseSql(
    `SELECT bucket, n_artifacts, as_of FROM spurs2.gold.compliance_summary ORDER BY bucket`,
  );
  const rejected = await runWarehouseSql(
    `SELECT media_id, verdict, triage_status, reason_summary, last_rejected_at
     FROM spurs2.gold.compliance_rejected
     ORDER BY last_rejected_at DESC NULLS LAST
     LIMIT 25`,
  );

  return Response.json({
    source: "databricks_warehouse",
    summary: summary.rows,
    rejectedSample: rejected.rows,
    statementIds: [summary.statementId, rejected.statementId],
  });
});
