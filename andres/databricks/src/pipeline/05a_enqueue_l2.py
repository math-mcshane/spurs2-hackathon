# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Enqueue L2 requests for eligible media (Rights Passport batch)

# COMMAND ----------

import uuid
from datetime import datetime, timezone

from pyspark.sql import Row, functions as F
from pyspark.sql.types import StringType, StructField, StructType, TimestampType

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("media_id", "")
dbutils.widgets.text("max_enqueue", "200")

catalog = dbutils.widgets.get("catalog")
media_id = dbutils.widgets.get("media_id").strip()
max_enqueue = int(dbutils.widgets.get("max_enqueue") or "200")

eligible_t = f"{catalog}.silver.eligible_artifacts"
requests_t = f"{catalog}.gold.l2_requests"

SCHEMA = StructType(
    [
        StructField("request_id", StringType(), False),
        StructField("media_id", StringType(), False),
        StructField("company_id", StringType(), True),
        StructField("requested_at", TimestampType(), False),
        StructField("channel", StringType(), True),
        StructField("territory", StringType(), True),
        StructField("window_start", TimestampType(), True),
        StructField("window_end", TimestampType(), True),
        StructField("intent_json", StringType(), True),
        StructField("status", StringType(), False),
        StructField("job_run_id", StringType(), True),
    ]
)

# COMMAND ----------

elig = spark.table(eligible_t)
if media_id:
    elig = elig.where(F.col("media_id") == media_id)

# Skip media that already have a queued/running request
open_req = (
    spark.table(requests_t)
    .where(F.col("status").isin("queued", "running"))
    .select("media_id")
    .distinct()
)
candidates = elig.join(open_req, on="media_id", how="left_anti").limit(max_enqueue)
rows = candidates.collect()

try:
    ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
    job_run_id = str(ctx.currentRunId().get()) if ctx.currentRunId().isDefined() else "local"
except Exception:
    job_run_id = "local"

now = datetime.now(timezone.utc).replace(tzinfo=None)
out = []
for r in rows:
    out.append(
        Row(
            request_id=str(uuid.uuid4()),
            media_id=r.media_id,
            company_id=getattr(r, "company_id", None),
            requested_at=now,
            channel="social",
            territory=None,
            window_start=None,
            window_end=None,
            intent_json='{"source":"batch_enqueue","passport":true}',
            status="queued",
            job_run_id=job_run_id,
        )
    )

if out:
    spark.createDataFrame(out, schema=SCHEMA).write.mode("append").saveAsTable(requests_t)

print(f"[enqueue_l2] enqueued={len(out)} (max={max_enqueue})")
