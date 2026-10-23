# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Sync Supabase scoreplay_webhook_events → bronze.scoreplay_webhooks
# MAGIC Net-new path: ScorePlay → REROUTE → Supabase → UC bronze.
# MAGIC Secrets: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` in scope `spurs2-hackathon`.

# COMMAND ----------

import json
from datetime import datetime, timezone

import requests
from pyspark.sql import Row, functions as F
from pyspark.sql.types import StringType, StructField, StructType, TimestampType

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("secret_scope", "spurs2-hackathon")
dbutils.widgets.text("page_size", "200")

catalog = dbutils.widgets.get("catalog")
secret_scope = dbutils.widgets.get("secret_scope")
page_size = int(dbutils.widgets.get("page_size"))

bronze = f"{catalog}.bronze.scoreplay_webhooks"
supabase_url = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_URL").rstrip("/")
supabase_key = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_SECRET_KEY")

BRONZE_SCHEMA = StructType(
    [
        StructField("event_id", StringType(), False),
        StructField("event_type", StringType(), True),
        StructField("occurred_at", TimestampType(), True),
        StructField("received_at", TimestampType(), True),
        StructField("company_id", StringType(), True),
        StructField("media_id", StringType(), True),
        StructField("payload", StringType(), False),
        StructField("headers_json", StringType(), True),
        StructField("source_ip", StringType(), True),
        StructField("raw_path", StringType(), True),
    ]
)

# COMMAND ----------

have = {
    r.event_id
    for r in spark.table(bronze).select("event_id").distinct().collect()
    if r.event_id
}
print(f"[supabase_sync] bronze event_ids={len(have)}")

headers = {
    "apikey": supabase_key,
    "Authorization": f"Bearer {supabase_key}",
    "Accept": "application/json",
}

rows_out = []
offset = 0
now = datetime.now(timezone.utc).replace(tzinfo=None)

while True:
    resp = requests.get(
        f"{supabase_url}/rest/v1/scoreplay_webhook_events",
        headers=headers,
        params={
            "select": "event_id,event,media_id,company_id,payload,headers,received_at",
            "order": "received_at.asc",
            "limit": page_size,
            "offset": offset,
        },
        timeout=60,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Supabase HTTP {resp.status_code}: {resp.text[:500]}")
    batch = resp.json()
    if not batch:
        break

    for ev in batch:
        eid = ev.get("event_id")
        if not eid or eid in have:
            continue
        payload = ev.get("payload")
        if payload is not None and not isinstance(payload, str):
            payload = json.dumps(payload)
        headers_json = ev.get("headers")
        if headers_json is not None and not isinstance(headers_json, str):
            headers_json = json.dumps(headers_json)
        received_raw = ev.get("received_at")
        received_ts = now
        if isinstance(received_raw, str) and received_raw:
            try:
                received_ts = datetime.fromisoformat(received_raw.replace("Z", "+00:00")).replace(
                    tzinfo=None
                )
            except ValueError:
                received_ts = now
        rows_out.append(
            Row(
                event_id=str(eid),
                event_type=str(ev.get("event") or "unknown"),
                occurred_at=None,
                received_at=received_ts,
                company_id=str(ev["company_id"]) if ev.get("company_id") is not None else None,
                media_id=str(ev["media_id"]) if ev.get("media_id") is not None else None,
                payload=payload or "{}",
                headers_json=headers_json,
                source_ip=None,
                raw_path="supabase:scoreplay_webhook_events",
            )
        )
        have.add(str(eid))

    offset += len(batch)
    print(f"[supabase_sync] fetched={offset} staged_new={len(rows_out)}")
    if len(batch) < page_size:
        break

print(f"[supabase_sync] new rows={len(rows_out)}")
if rows_out:
    spark.createDataFrame(rows_out, schema=BRONZE_SCHEMA).write.mode("append").saveAsTable(bronze)
    print(f"[supabase_sync] appended → {bronze}")
else:
    print("[supabase_sync] nothing new")

display(spark.table(bronze).orderBy(F.col("received_at").desc()).limit(20))
