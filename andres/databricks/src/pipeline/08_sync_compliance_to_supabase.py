# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Sync L1 compliance gold → Supabase
# MAGIC Upserts `compliance_rejected`, `l1_decisions`, `compliance_summary` for Studio APIs.
# MAGIC Secrets: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` in `spurs2-hackathon`.

# COMMAND ----------

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests
from pyspark.sql import functions as F

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("secret_scope", "spurs2-hackathon")
dbutils.widgets.text("max_rows", "500")

catalog = dbutils.widgets.get("catalog")
secret_scope = dbutils.widgets.get("secret_scope")
max_rows = max(1, int(dbutils.widgets.get("max_rows") or "500"))

rejected_v = f"{catalog}.gold.compliance_rejected"
l1_t = f"{catalog}.gold.l1_decisions"
summary_v = f"{catalog}.gold.compliance_summary"

supabase_url = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_URL").rstrip("/")
supabase_key = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_SECRET_KEY")

headers = {
    "apikey": supabase_key,
    "Authorization": f"Bearer {supabase_key}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}


def _iso(ts) -> Optional[str]:
    if ts is None:
        return None
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        return ts.isoformat()
    return str(ts)


def upsert(table: str, payload: List[Dict[str, Any]], on_conflict: str) -> None:
    if not payload:
        return
    chunk = 100
    for i in range(0, len(payload), chunk):
        part = payload[i : i + chunk]
        resp = requests.post(
            f"{supabase_url}/rest/v1/{table}",
            headers=headers,
            params={"on_conflict": on_conflict},
            json=part,
            timeout=60,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Supabase {table} upsert HTTP {resp.status_code}: {resp.text[:500]}")
        print(f"[sync_compliance] upserted {len(part)} → {table}")


now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

# COMMAND ----------

# Rejected — do not overwrite Studio triage when triage_dirty (handled by Prefer merge;
# we omit triage_* when row already dirty via a two-step: upsert base fields only if needed).
# Simple path: upsert all UC fields; triage_dirty rows get overwritten unless we PATCH carefully.
# Hackathon: upsert UC triage only when Studio has not marked dirty — fetch dirty ids first.

dirty_ids = set()
try:
    r = requests.get(
        f"{supabase_url}/rest/v1/compliance_rejected",
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Accept": "application/json",
        },
        params={"select": "media_id", "triage_dirty": "eq.true", "limit": "1000"},
        timeout=30,
    )
    if r.status_code < 400:
        dirty_ids = {row["media_id"] for row in r.json() if row.get("media_id")}
except Exception as e:
    print(f"[sync_compliance] dirty fetch skip: {e}")

rejected_rows = (
    spark.table(rejected_v).orderBy(F.col("last_rejected_at").desc_nulls_last()).limit(max_rows).collect()
)
print(f"[sync_compliance] rejected={len(rejected_rows)} dirty_protected={len(dirty_ids)}")

rej_payload = []
for r in rejected_rows:
    mid = r.media_id
    evidence = {}
    if getattr(r, "evidence_json", None):
        try:
            evidence = json.loads(r.evidence_json) if isinstance(r.evidence_json, str) else r.evidence_json
        except Exception:
            evidence = {"raw": str(r.evidence_json)}
    row = {
        "media_id": mid,
        "company_id": r.company_id,
        "title": r.title,
        "media_type": r.media_type,
        "cdn_url": r.cdn_url,
        "verdict": r.verdict or "AUTO_REJECT",
        "reason_codes": list(r.reason_codes) if r.reason_codes else [],
        "reason_summary": r.reason_summary,
        "latest_decision_id": r.latest_decision_id,
        "first_rejected_at": _iso(r.first_rejected_at),
        "last_rejected_at": _iso(r.last_rejected_at),
        "policy_pack_id": r.policy_pack_id,
        "policy_version": r.policy_version,
        "evidence_json": evidence or {},
        "job_run_id": r.job_run_id,
        "synced_at": now_iso,
        "updated_at": now_iso,
    }
    if mid not in dirty_ids:
        row["triage_status"] = r.triage_status or "new"
        row["triage_notes"] = r.triage_notes
    rej_payload.append(row)

upsert("compliance_rejected", rej_payload, "media_id")

# COMMAND ----------

l1_rows = spark.table(l1_t).orderBy(F.col("decided_at").desc()).limit(max_rows).collect()
print(f"[sync_compliance] l1_decisions={len(l1_rows)}")

l1_payload = []
for d in l1_rows:
    evidence = {}
    if getattr(d, "evidence_json", None):
        try:
            evidence = json.loads(d.evidence_json) if isinstance(d.evidence_json, str) else d.evidence_json
        except Exception:
            evidence = {"raw": str(d.evidence_json)}
    l1_payload.append(
        {
            "decision_id": d.decision_id,
            "media_id": d.media_id,
            "company_id": d.company_id,
            "decided_at": _iso(d.decided_at),
            "verdict": d.verdict,
            "policy_pack_id": d.policy_pack_id,
            "policy_version": d.policy_version,
            "reason_codes": list(d.reason_codes) if d.reason_codes else [],
            "reason_summary": d.reason_summary,
            "evidence_json": evidence or {},
            "input_event_id": d.input_event_id,
            "job_run_id": d.job_run_id,
            "synced_at": now_iso,
        }
    )

upsert("l1_decisions", l1_payload, "decision_id")

# COMMAND ----------

summary_rows = spark.table(summary_v).collect()
sum_payload = [
    {
        "bucket": s.bucket,
        "n_artifacts": int(s.n_artifacts or 0),
        "as_of": _iso(s.as_of),
        "synced_at": now_iso,
    }
    for s in summary_rows
]
upsert("compliance_summary", sum_payload, "bucket")
print(f"[sync_compliance] summary_buckets={len(sum_payload)}")
