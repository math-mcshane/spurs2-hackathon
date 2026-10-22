# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # L2 — contextual evaluate (preliminary)
# MAGIC Processes `gold.l2_requests` with `status = queued`.
# MAGIC Safe default: **NEEDS_REVIEW** when no seeded L2 pack covers the intent (NFR-3).

# COMMAND ----------

import json
import uuid
from datetime import datetime, timezone

from pyspark.sql import Row, functions as F

dbutils.widgets.text("catalog", "spurs2")
catalog = dbutils.widgets.get("catalog")

requests_t = f"{catalog}.gold.l2_requests"
decisions_t = f"{catalog}.gold.l2_decisions"
eligible_t = f"{catalog}.silver.eligible_artifacts"

POLICY_PACK_ID = "l2-contextual-demo"
POLICY_VERSION = "0.1.0"

# COMMAND ----------

queued = spark.table(requests_t).where(F.col("status") == "queued")
reqs = queued.collect()
eligible_ids = {
    r.media_id for r in spark.table(eligible_t).select("media_id").distinct().collect()
}

print(f"[l2] queued_requests={len(reqs)} eligible_pool={len(eligible_ids)}")

try:
    ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
    job_run_id = str(ctx.currentRunId().get()) if ctx.currentRunId().isDefined() else "local"
except Exception:
    job_run_id = "local"

decision_rows = []
now = datetime.now(timezone.utc).replace(tzinfo=None)

for req in reqs:
    in_pool = req.media_id in eligible_ids
    if not in_pool:
        verdict = "BLOCKED"
        codes = ["L2_NOT_ELIGIBLE"]
        summary = "Media not in L1 eligible pool (or L1 rejected)"
        dims = {"eligibility": "BLOCKED"}
    else:
        # Preliminary: no real pack evaluation yet → never silent ALLOW
        verdict = "NEEDS_REVIEW"
        codes = ["L2_PACK_NOT_SEEDED"]
        summary = "DEMO: L2 packs not seeded — human review required"
        dims = {
            "territory": "NEEDS_REVIEW",
            "platform": "NEEDS_REVIEW",
            "usage": "NEEDS_REVIEW",
            "competition": "NEEDS_REVIEW",
            "sponsor": "NEEDS_REVIEW",
            "player": "NEEDS_REVIEW",
            "expiry": "NEEDS_REVIEW",
        }

    decision_id = str(uuid.uuid4())
    receipt = {
        "decision_id": decision_id,
        "request_id": req.request_id,
        "media_id": req.media_id,
        "verdict": verdict,
        "policy_pack_id": POLICY_PACK_ID,
        "policy_version": POLICY_VERSION,
        "demo": True,
    }
    decision_rows.append(
        Row(
            decision_id=decision_id,
            request_id=req.request_id,
            media_id=req.media_id,
            company_id=req.company_id,
            decided_at=now,
            verdict=verdict,
            policy_pack_id=POLICY_PACK_ID,
            policy_version=POLICY_VERSION,
            reason_codes=codes,
            reason_summary=summary,
            dimensions_json=json.dumps(dims),
            observations_used=[],
            receipt_json=json.dumps(receipt),
            job_run_id=job_run_id,
        )
    )

# COMMAND ----------

if decision_rows:
    spark.createDataFrame(decision_rows).write.mode("append").saveAsTable(decisions_t)
    ids = [d.request_id for d in decision_rows]
    id_list = ",".join([f"'{i}'" for i in ids])
    spark.sql(
        f"""
        UPDATE {requests_t}
        SET status = 'decided',
            job_run_id = '{job_run_id}'
        WHERE request_id IN ({id_list})
        """
    )
    print(f"[l2] wrote {len(decision_rows)} decisions; marked requests decided")
else:
    print("[l2] no queued requests")

display(spark.table(decisions_t).orderBy(F.col("decided_at").desc()).limit(20))
