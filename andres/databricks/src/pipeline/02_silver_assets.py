# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Silver — project `assets` from bronze webhooks
# MAGIC Best-effort JSON extraction. Missing fields stay null (never invent rights).
# MAGIC `run_mode=full` ignores lookback (full-catalog / backfill).

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.window import Window

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("lookback_hours", "24")
dbutils.widgets.dropdown("run_mode", "incremental", ["incremental", "full"])
dbutils.widgets.text("media_id", "")

catalog = dbutils.widgets.get("catalog")
lookback_hours = int(dbutils.widgets.get("lookback_hours"))
run_mode = dbutils.widgets.get("run_mode").strip().lower()
media_id = dbutils.widgets.get("media_id").strip()

bronze = f"{catalog}.bronze.scoreplay_webhooks"
assets = f"{catalog}.silver.assets"

# COMMAND ----------

raw = spark.table(bronze).where(F.col("media_id").isNotNull())
if media_id:
    raw = raw.where(F.col("media_id") == media_id)
    print(f"[silver] scoped to media_id={media_id}")
elif run_mode != "full":
    cutoff = F.current_timestamp() - F.expr(f"INTERVAL {lookback_hours} HOURS")
    raw = raw.where(F.col("received_at") >= cutoff)

# Prefer get_json_object — ScorePlay payloads are nested objects, not flat string maps
parsed = raw.select(
    F.col("media_id"),
    F.coalesce(
        F.col("company_id"),
        F.get_json_object(F.col("payload"), "$.company_id"),
        F.get_json_object(F.col("payload"), "$.companyId"),
    ).alias("company_id"),
    F.coalesce(
        F.get_json_object(F.col("payload"), "$.name"),
        F.get_json_object(F.col("payload"), "$.title"),
        F.get_json_object(F.col("payload"), "$.media.name"),
    ).alias("title"),
    F.coalesce(
        F.get_json_object(F.col("payload"), "$.description"),
        F.get_json_object(F.col("payload"), "$.media.description"),
    ).alias("description"),
    F.coalesce(
        F.get_json_object(F.col("payload"), "$.type"),
        F.get_json_object(F.col("payload"), "$.media_type"),
        F.get_json_object(F.col("payload"), "$.media.type"),
    ).alias("media_type"),
    F.get_json_object(F.col("payload"), "$.status").alias("status"),
    F.coalesce(
        F.get_json_object(F.col("payload"), "$.streaming_url"),
        F.get_json_object(F.col("payload"), "$.proxy_large"),
        F.get_json_object(F.col("payload"), "$.cdn_url"),
        F.get_json_object(F.col("payload"), "$.url"),
    ).alias("cdn_url"),
    F.coalesce(
        F.get_json_object(F.col("payload"), "$.thumbnail_url"),
        F.get_json_object(F.col("payload"), "$.proxy_small"),
    ).alias("thumbnail_url"),
    F.col("event_id").alias("source_event_id"),
    F.col("payload").alias("attrs_json"),
    F.col("received_at"),
)

w = (
    parsed.withColumn(
        "rn",
        F.row_number().over(
            Window.partitionBy("media_id").orderBy(F.col("received_at").desc())
        ),
    )
    .where(F.col("rn") == 1)
    .drop("rn")
)

staged = w.select(
    "media_id",
    "company_id",
    "title",
    "description",
    "media_type",
    "status",
    "cdn_url",
    "thumbnail_url",
    F.lit(None).cast("double").alias("duration_sec"),
    F.lit(None).cast("int").alias("width"),
    F.lit(None).cast("int").alias("height"),
    F.lit(None).cast("string").alias("mime_type"),
    F.lit(None).cast("timestamp").alias("created_at"),
    F.col("received_at").alias("updated_at"),
    "source_event_id",
    "attrs_json",
    F.current_timestamp().alias("ingested_at"),
)

n = staged.count()
print(f"[silver_assets] run_mode={run_mode} candidates={n} → {assets}")

if n == 0:
    print("[silver_assets] nothing to merge")
else:
    staged.createOrReplaceTempView("_assets_stage")
    spark.sql(
        f"""
        MERGE INTO {assets} AS t
        USING _assets_stage AS s
        ON t.media_id = s.media_id
        WHEN MATCHED THEN UPDATE SET
          t.company_id = coalesce(s.company_id, t.company_id),
          t.title = coalesce(s.title, t.title),
          t.description = coalesce(s.description, t.description),
          t.media_type = coalesce(s.media_type, t.media_type),
          t.status = coalesce(s.status, t.status),
          t.cdn_url = coalesce(s.cdn_url, t.cdn_url),
          t.thumbnail_url = coalesce(s.thumbnail_url, t.thumbnail_url),
          t.updated_at = s.updated_at,
          t.source_event_id = s.source_event_id,
          t.attrs_json = s.attrs_json,
          t.ingested_at = s.ingested_at
        WHEN NOT MATCHED THEN INSERT *
        """
    )
    print("[silver_assets] merge complete")

display(spark.table(assets).orderBy(F.col("ingested_at").desc()).limit(20))
