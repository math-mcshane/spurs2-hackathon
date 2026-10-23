# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Sync latest L2 passports → Supabase `media_passports`

# COMMAND ----------

import json
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

import requests
from pyspark.sql import functions as F
from pyspark.sql.window import Window

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("secret_scope", "spurs2-hackathon")
dbutils.widgets.text("max_rows", "500")

catalog = dbutils.widgets.get("catalog")
secret_scope = dbutils.widgets.get("secret_scope")
max_rows = max(1, int(dbutils.widgets.get("max_rows") or "500"))

decisions_t = f"{catalog}.gold.l2_decisions"
activations_t = f"{catalog}.rules.policy_activations"

supabase_url = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_URL").rstrip("/")
supabase_key = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_SECRET_KEY")

headers = {
    "apikey": supabase_key,
    "Authorization": f"Bearer {supabase_key}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}

# COMMAND ----------

w = Window.partitionBy("media_id").orderBy(F.col("decided_at").desc())
latest = (
    spark.table(decisions_t)
    .withColumn("rn", F.row_number().over(w))
    .where(F.col("rn") == 1)
    .limit(max_rows)
)
rows = latest.collect()
print(f"[sync_passport] latest decisions={len(rows)}")


def upsert(table: str, payload: List[Dict[str, Any]], on_conflict: str) -> None:
    if not payload:
        return
    for i in range(0, len(payload), 100):
        part = payload[i : i + 100]
        resp = requests.post(
            f"{supabase_url}/rest/v1/{table}",
            headers={**headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
            params={"on_conflict": on_conflict},
            json=part,
            timeout=60,
        )
        if not resp.ok:
            raise RuntimeError(f"Supabase upsert {table} failed: {resp.status_code} {resp.text[:300]}")


payload = []
for r in rows:
    passport = None
    if getattr(r, "passport_json", None):
        try:
            passport = json.loads(r.passport_json)
        except Exception:
            passport = None
    if not passport and r.receipt_json:
        try:
            receipt = json.loads(r.receipt_json)
            passport = {"rules_fired": receipt.get("rules_fired") or [], "cells": {}}
        except Exception:
            passport = {"cells": {}, "rules_fired": []}

    usable = None
    if passport and passport.get("usable_until"):
        usable = str(passport["usable_until"])[:10]

    decided = r.decided_at
    if isinstance(decided, datetime):
        decided_s = decided.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    else:
        decided_s = str(decided) if decided else None

    payload.append(
        {
            "media_id": r.media_id,
            "decision_id": r.decision_id,
            "verdict": r.verdict,
            "policy_pack_id": r.policy_pack_id,
            "policy_version": r.policy_version,
            "passport_json": passport or {},
            "rules_fired": (passport or {}).get("rules_fired") or list(r.reason_codes or []),
            "usable_until": usable,
            "demo": True,
            "decided_at": decided_s,
            "synced_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
    )

upsert("media_passports", payload, "media_id")
print(f"[sync_passport] upserted media_passports={len(payload)}")

# Also mirror full l2_decisions rows for Studio lake badge / audit APIs
l2_payload = []
now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
for r in rows:
    passport = None
    if getattr(r, "passport_json", None):
        try:
            passport = json.loads(r.passport_json)
        except Exception:
            passport = None
    dims = {}
    if getattr(r, "dimensions_json", None):
        try:
            dims = json.loads(r.dimensions_json) if isinstance(r.dimensions_json, str) else r.dimensions_json
        except Exception:
            dims = {}
    decided = r.decided_at
    if isinstance(decided, datetime):
        decided_s = decided.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    else:
        decided_s = str(decided) if decided else now_iso
    l2_payload.append(
        {
            "decision_id": r.decision_id,
            "request_id": r.request_id,
            "media_id": r.media_id,
            "company_id": r.company_id,
            "decided_at": decided_s,
            "verdict": r.verdict,
            "policy_pack_id": r.policy_pack_id,
            "policy_version": r.policy_version,
            "reason_codes": list(r.reason_codes) if r.reason_codes else [],
            "reason_summary": r.reason_summary,
            "dimensions_json": dims or {},
            "passport_json": passport,
            "job_run_id": r.job_run_id,
            "synced_at": now_iso,
        }
    )
upsert("l2_decisions", l2_payload, "decision_id")
print(f"[sync_passport] upserted l2_decisions={len(l2_payload)}")

# Sync activations snapshot for Studio
try:
    acts = spark.sql(
        f"""
        SELECT layer, pack_id, version, company_id, activated_at, notes
        FROM {activations_t}
        WHERE notes = 'wave1-demo-seed'
           OR activated_at >= current_timestamp() - INTERVAL 30 DAYS
        ORDER BY activated_at DESC
        LIMIT 50
        """
    ).collect()
    act_payload = []
    for a in acts:
        club = a.company_id if a.company_id in ("SAS", "TOT") else ""
        act_payload.append(
            {
                "layer": a.layer,
                "pack_id": a.pack_id,
                "version": a.version,
                "club_code": club,
                "activated_at": a.activated_at.isoformat() + "Z"
                if isinstance(a.activated_at, datetime)
                else str(a.activated_at),
                "notes": a.notes,
            }
        )
    # Clear+insert is awkward via REST; upsert on unique constraint
    upsert("policy_pack_activations", act_payload, "layer,pack_id,version,club_code")
    print(f"[sync_passport] activations={len(act_payload)}")
except Exception as e:
    print(f"[sync_passport] activations skip: {e}")
