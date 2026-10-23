# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Backfill ScorePlay media → bronze.scoreplay_webhooks
# MAGIC Pages `POST /media/search`, writes synthetic `event_type=backfill` rows.
# MAGIC Secrets: scope `spurs2-hackathon` → `SCOREPLAY_API_KEY`.

# COMMAND ----------

import json
import uuid
from datetime import datetime, timezone

import requests
from pyspark.sql import Row, functions as F
from pyspark.sql.types import StringType, StructField, StructType, TimestampType

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("secret_scope", "spurs2-hackathon")
dbutils.widgets.text("per_page", "50")
dbutils.widgets.text("max_pages", "200")
dbutils.widgets.text("scoreplay_base_url", "https://media.scoreplay.io/v1")

catalog = dbutils.widgets.get("catalog")
secret_scope = dbutils.widgets.get("secret_scope")
per_page = int(dbutils.widgets.get("per_page"))
max_pages = int(dbutils.widgets.get("max_pages"))
base_url = dbutils.widgets.get("scoreplay_base_url").rstrip("/")

bronze = f"{catalog}.bronze.scoreplay_webhooks"
api_key = dbutils.secrets.get(scope=secret_scope, key="SCOREPLAY_API_KEY")

BRONZE_SCHEMA = StructType(
    [
        StructField("event_id", StringType(), False),
        StructField("event_type", StringType(), True),
        StructField("occurred_at", TimestampType(), True),
        StructField("received_at", TimestampType(), False),
        StructField("company_id", StringType(), True),
        StructField("media_id", StringType(), True),
        StructField("payload", StringType(), False),
        StructField("headers_json", StringType(), True),
        StructField("source_ip", StringType(), True),
        StructField("raw_path", StringType(), True),
    ]
)

# COMMAND ----------

existing = {
    r.media_id
    for r in spark.table(bronze)
    .where(F.col("event_type") == "backfill")
    .select("media_id")
    .distinct()
    .collect()
    if r.media_id
}
print(f"[backfill] existing backfill media_ids={len(existing)}")

session = requests.Session()
session.headers.update({"X-ScorePlay-Api-Key": api_key, "Accept": "application/json"})

now = datetime.now(timezone.utc).replace(tzinfo=None)
rows_out = []
page = 1

while page <= max_pages:
    resp = session.post(
        f"{base_url}/media/search",
        params={"page": page, "per_page": per_page},
        json={"smart_filter": True, "order_by": "relevance"},
        timeout=60,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"ScorePlay search HTTP {resp.status_code}: {resp.text[:500]}")
    body = resp.json()
    media = body.get("media") or []
    if not media:
        print(f"[backfill] page={page} empty — stop")
        break

    for m in media:
        mid = m.get("ID") or m.get("id")
        if mid is None:
            continue
        media_id = str(mid)
        if media_id in existing:
            continue
        company = m.get("company_id")
        event_id = f"backfill:{media_id}:{uuid.uuid4().hex[:12]}"
        rows_out.append(
            Row(
                event_id=event_id,
                event_type="backfill",
                occurred_at=None,
                received_at=now,
                company_id=str(company) if company is not None else None,
                media_id=media_id,
                payload=json.dumps(m),
                headers_json=None,
                source_ip=None,
                raw_path=None,
            )
        )
        existing.add(media_id)

    total_pages = body.get("total_pages")
    print(f"[backfill] page={page}/{total_pages or '?'} batch={len(media)} staged_total={len(rows_out)}")
    if total_pages is not None and page >= int(total_pages):
        break
    if len(media) < per_page:
        break
    page += 1

print(f"[backfill] new rows={len(rows_out)}")

if rows_out:
    spark.createDataFrame(rows_out, schema=BRONZE_SCHEMA).write.mode("append").saveAsTable(bronze)
    print(f"[backfill] appended → {bronze}")
else:
    print("[backfill] nothing new to append")

display(
    spark.table(bronze)
    .where(F.col("event_type") == "backfill")
    .orderBy(F.col("received_at").desc())
    .limit(20)
)
