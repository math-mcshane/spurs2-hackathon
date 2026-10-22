# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Silver — project `assets` from bronze webhooks
# MAGIC Best-effort JSON extraction. Missing fields stay null (never invent rights).

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.window import Window

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("lookback_hours", "24")

catalog = dbutils.widgets.get("catalog")
lookback_hours = int(dbutils.widgets.get("lookback_hours"))

bronze = f"{catalog}.bronze.scoreplay_webhooks"
assets = f"{catalog}.silver.assets"

# COMMAND ----------

cutoff = F.current_timestamp() - F.expr(f"INTERVAL {lookback_hours} HOURS")
raw = (
    spark.table(bronze)
    .where(F.col("received_at") >= cutoff)
    .where(F.col("media_id").isNotNull())
)

# ScorePlay payloads vary; pull common keys when present
parsed = (
    raw.withColumn("j", F.from_json(F.col("payload"), "MAP<STRING,STRING>"))
    .select(
        F.col("media_id"),
        F.coalesce(F.col("company_id"), F.col("j")["company_id"], F.col("j")["companyId"]).alias(
            "company_id"
        ),
        F.coalesce(F.col("j")["title"], F.col("j")["name"]).alias("title"),
        F.col("j")["description"].alias("description"),
        F.coalesce(F.col("j")["media_type"], F.col("j")["type"], F.col("j")["mediaType"]).alias(
            "media_type"
        ),
        F.coalesce(F.col("j")["status"]).alias("status"),
        F.coalesce(
            F.col("j")["cdn_url"],
            F.col("j")["url"],
            F.col("j")["download_url"],
            F.col("j")["cdnUrl"],
        ).alias("cdn_url"),
        F.coalesce(F.col("j")["thumbnail_url"], F.col("j")["thumbnailUrl"]).alias(
            "thumbnail_url"
        ),
        F.col("event_id").alias("source_event_id"),
        F.col("payload").alias("attrs_json"),
        F.col("received_at"),
    )
)

# Keep latest event per media_id in the window
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
print(f"[silver_assets] candidates={n} → {assets}")

if n == 0:
    print("[silver_assets] nothing to merge (bronze empty or no media_id in lookback)")
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
