# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # L1 — safety preprocess
# MAGIC DEMO deterministic pack until `rules.l1_policy_packs` is seeded.
# MAGIC `AUTO_REJECT` → `gold.rejected_artifacts` · `PASS_L1` → `silver.eligible_artifacts`.

# COMMAND ----------

import json
import uuid
from datetime import datetime, timezone

from pyspark.sql import Row, functions as F

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("lookback_hours", "24")

catalog = dbutils.widgets.get("catalog")
lookback_hours = int(dbutils.widgets.get("lookback_hours"))

assets_t = f"{catalog}.silver.assets"
decisions_t = f"{catalog}.gold.l1_decisions"
rejected_t = f"{catalog}.gold.rejected_artifacts"
eligible_t = f"{catalog}.silver.eligible_artifacts"

POLICY_PACK_ID = "l1-safety-demo"
POLICY_VERSION = "0.1.0"

# Substrings in title/attrs that force AUTO_REJECT (DEMO ONLY — not legal guidance)
REJECT_TOKENS = (
    "nsfw",
    "nude",
    "nudity",
    "gore",
    "graphic_violence",
    "hate_symbol",
    "drug_use",
    "csam",
)

# COMMAND ----------

already = spark.table(decisions_t).select("media_id").distinct()
cutoff = F.current_timestamp() - F.expr(f"INTERVAL {lookback_hours} HOURS")

candidates = (
    spark.table(assets_t)
    .where(F.col("ingested_at") >= cutoff)
    .join(already, on="media_id", how="left_anti")
)

rows = candidates.collect()
print(f"[l1] candidates without prior decision={len(rows)}")

try:
    ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
    job_run_id = str(ctx.currentRunId().get()) if ctx.currentRunId().isDefined() else "local"
except Exception:
    job_run_id = "local"

# COMMAND ----------

def evaluate(row) -> dict:
    blob = " ".join(
        [
            (row.title or ""),
            (row.description or ""),
            (row.attrs_json or ""),
            (row.media_type or ""),
        ]
    ).lower()
    hits = [t for t in REJECT_TOKENS if t in blob]
    if hits:
        return {
            "verdict": "AUTO_REJECT",
            "reason_codes": [f"L1_{h.upper()}" for h in hits],
            "reason_summary": f"DEMO L1 reject tokens: {', '.join(hits)}",
            "evidence_json": json.dumps({"tokens": hits}),
        }
    return {
        "verdict": "PASS_L1",
        "reason_codes": ["L1_CLEAR"],
        "reason_summary": "DEMO L1: no hard-reject tokens matched",
        "evidence_json": json.dumps({"tokens": []}),
    }


decision_rows = []
reject_rows = []
eligible_rows = []

now = datetime.now(timezone.utc).replace(tzinfo=None)

for r in rows:
    ev = evaluate(r)
    decision_id = str(uuid.uuid4())
    decision_rows.append(
        Row(
            decision_id=decision_id,
            media_id=r.media_id,
            company_id=r.company_id,
            decided_at=now,
            verdict=ev["verdict"],
            policy_pack_id=POLICY_PACK_ID,
            policy_version=POLICY_VERSION,
            reason_codes=ev["reason_codes"],
            reason_summary=ev["reason_summary"],
            evidence_json=ev["evidence_json"],
            input_event_id=r.source_event_id,
            job_run_id=job_run_id,
            model_name="l1-demo-token-v0",
        )
    )
    if ev["verdict"] == "AUTO_REJECT":
        reject_rows.append(
            Row(
                media_id=r.media_id,
                company_id=r.company_id,
                latest_decision_id=decision_id,
                verdict="AUTO_REJECT",
                first_rejected_at=now,
                last_rejected_at=now,
                reason_codes=ev["reason_codes"],
                reason_summary=ev["reason_summary"],
                title=r.title,
                media_type=r.media_type,
                cdn_url=r.cdn_url,
                triage_status="new",
                triage_notes=None,
                updated_at=now,
            )
        )
    else:
        eligible_rows.append(
            Row(
                media_id=r.media_id,
                company_id=r.company_id,
                title=r.title,
                media_type=r.media_type,
                cdn_url=r.cdn_url,
                duration_sec=r.duration_sec,
                l1_decision_id=decision_id,
                l1_passed_at=now,
                tl_asset_id=None,
                tl_index_id=None,
                tl_status="pending",
                attrs_json=r.attrs_json,
                updated_at=now,
            )
        )

# COMMAND ----------

if decision_rows:
    spark.createDataFrame(decision_rows).write.mode("append").saveAsTable(decisions_t)
    print(f"[l1] appended {len(decision_rows)} → {decisions_t}")
else:
    print("[l1] no new decisions")

if reject_rows:
    spark.createDataFrame(reject_rows).createOrReplaceTempView("_reject_stage")
    spark.sql(
        f"""
        MERGE INTO {rejected_t} AS t
        USING _reject_stage AS s
        ON t.media_id = s.media_id
        WHEN MATCHED THEN UPDATE SET
          t.latest_decision_id = s.latest_decision_id,
          t.last_rejected_at = s.last_rejected_at,
          t.reason_codes = s.reason_codes,
          t.reason_summary = s.reason_summary,
          t.title = coalesce(s.title, t.title),
          t.updated_at = s.updated_at
        WHEN NOT MATCHED THEN INSERT *
        """
    )
    print(f"[l1] upserted {len(reject_rows)} → {rejected_t}")

if eligible_rows:
    spark.createDataFrame(eligible_rows).createOrReplaceTempView("_elig_stage")
    spark.sql(
        f"""
        MERGE INTO {eligible_t} AS t
        USING _elig_stage AS s
        ON t.media_id = s.media_id
        WHEN MATCHED THEN UPDATE SET
          t.l1_decision_id = s.l1_decision_id,
          t.l1_passed_at = s.l1_passed_at,
          t.title = coalesce(s.title, t.title),
          t.cdn_url = coalesce(s.cdn_url, t.cdn_url),
          t.attrs_json = coalesce(s.attrs_json, t.attrs_json),
          t.updated_at = s.updated_at
        WHEN NOT MATCHED THEN INSERT *
        """
    )
    print(f"[l1] upserted {len(eligible_rows)} → {eligible_t}")

print(
    f"[l1] summary pass={len(eligible_rows)} reject={len(reject_rows)} "
    f"pack={POLICY_PACK_ID}@{POLICY_VERSION} DEMO ONLY"
)
