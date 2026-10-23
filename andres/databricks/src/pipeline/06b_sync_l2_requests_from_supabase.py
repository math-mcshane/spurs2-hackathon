# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Sync Supabase l2_requests (Studio decide) → gold.l2_requests
# MAGIC Pulls `status=queued` rows staged by REROUTE `/api/decide`.

# COMMAND ----------

import json
from datetime import datetime, timezone

import requests
from pyspark.sql import Row
from pyspark.sql.types import StringType, StructField, StructType, TimestampType

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("secret_scope", "spurs2-hackathon")
dbutils.widgets.text("page_size", "200")

catalog = dbutils.widgets.get("catalog")
secret_scope = dbutils.widgets.get("secret_scope")
page_size = int(dbutils.widgets.get("page_size") or "200")

requests_t = f"{catalog}.gold.l2_requests"
supabase_url = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_URL").rstrip("/")
supabase_key = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_SECRET_KEY")

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

have = {
    r.request_id
    for r in spark.table(requests_t).select("request_id").distinct().collect()
    if r.request_id
}
print(f"[l2_req_sync] gold request_ids={len(have)}")

headers = {
    "apikey": supabase_key,
    "Authorization": f"Bearer {supabase_key}",
    "Accept": "application/json",
    "Content-Type": "application/json",
}

resp = requests.get(
    f"{supabase_url}/rest/v1/l2_requests",
    headers=headers,
    params={
        "select": "request_id,media_id,company_id,requested_at,channel,territory,intent_json,status,job_run_id",
        "status": "eq.queued",
        "order": "requested_at.asc",
        "limit": page_size,
    },
    timeout=60,
)
if resp.status_code >= 400:
    raise RuntimeError(f"Supabase HTTP {resp.status_code}: {resp.text[:500]}")

batch = resp.json()
now = datetime.now(timezone.utc).replace(tzinfo=None)
rows_out = []
synced_ids = []

for ev in batch:
    rid = ev.get("request_id")
    if not rid or rid in have:
        if rid:
            synced_ids.append(str(rid))
        continue
    intent = ev.get("intent_json")
    if intent is not None and not isinstance(intent, str):
        intent = json.dumps(intent)
    requested_raw = ev.get("requested_at")
    requested_ts = now
    if isinstance(requested_raw, str) and requested_raw:
        try:
            requested_ts = datetime.fromisoformat(requested_raw.replace("Z", "+00:00")).replace(
                tzinfo=None
            )
        except ValueError:
            requested_ts = now
    rows_out.append(
        Row(
            request_id=str(rid),
            media_id=str(ev["media_id"]),
            company_id=str(ev["company_id"]) if ev.get("company_id") is not None else None,
            requested_at=requested_ts,
            channel=ev.get("channel"),
            territory=ev.get("territory"),
            window_start=None,
            window_end=None,
            intent_json=intent or "{}",
            status="queued",
            job_run_id=ev.get("job_run_id"),
        )
    )
    synced_ids.append(str(rid))
    have.add(str(rid))

if rows_out:
    spark.createDataFrame(rows_out, schema=SCHEMA).write.mode("append").saveAsTable(requests_t)

# Mark Supabase rows as synced (still queued in UC until l2_contextual decides)
for rid in synced_ids:
    patch = requests.patch(
        f"{supabase_url}/rest/v1/l2_requests",
        headers={**headers, "Prefer": "return=minimal"},
        params={"request_id": f"eq.{rid}"},
        json={"status": "synced"},
        timeout=30,
    )
    if patch.status_code >= 400:
        print(f"[l2_req_sync] mark synced failed {rid}: {patch.status_code}")

print(f"[l2_req_sync] appended={len(rows_out)} marked_synced={len(synced_ids)}")
