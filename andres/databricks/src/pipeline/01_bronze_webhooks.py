# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Bronze — ScorePlay webhooks
# MAGIC Validates landing table; reports recent volume. Ingest/Autoloader writes stay append-only upstream.

# COMMAND ----------

from pyspark.sql import functions as F

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("lookback_hours", "24")

catalog = dbutils.widgets.get("catalog")
lookback_hours = int(dbutils.widgets.get("lookback_hours"))
table = f"{catalog}.bronze.scoreplay_webhooks"

# COMMAND ----------

df = spark.table(table)
cutoff = F.current_timestamp() - F.expr(f"INTERVAL {lookback_hours} HOURS")

recent = df.where(F.col("received_at") >= cutoff)
stats = recent.agg(
    F.count("*").alias("events"),
    F.countDistinct("media_id").alias("media_ids"),
    F.countDistinct("event_type").alias("event_types"),
).collect()[0]

print(
    f"[bronze] table={table} lookback_h={lookback_hours} "
    f"events={stats['events']} media_ids={stats['media_ids']} event_types={stats['event_types']}"
)

# Soft quality flags (do not drop rows)
missing_media = recent.where(F.col("media_id").isNull()).count()
missing_payload = recent.where(
    F.col("payload").isNull() | (F.length(F.col("payload")) == 0)
).count()
print(f"[bronze] recent missing media_id={missing_media} empty_payload={missing_payload}")

display(recent.orderBy(F.col("received_at").desc()).limit(20))
