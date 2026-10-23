# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Sync eligible + TL evidence → Supabase
# MAGIC Upserts `eligible_media` and `evidence` for Studio discover (idempotent on media_id / observation_id).
# MAGIC Secrets: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` in `spurs2-hackathon`.

# COMMAND ----------

import json
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

import requests
from pyspark.sql import functions as F

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("secret_scope", "spurs2-hackathon")
dbutils.widgets.text("max_rows", "500")
dbutils.widgets.text("club_code_default", "")  # optional SAS|TOT when facet null

catalog = dbutils.widgets.get("catalog")
secret_scope = dbutils.widgets.get("secret_scope")
max_rows = max(1, int(dbutils.widgets.get("max_rows") or "500"))
club_default = dbutils.widgets.get("club_code_default").strip().upper() or None

eligible_t = f"{catalog}.silver.eligible_artifacts"
assets_t = f"{catalog}.silver.assets"
obs_t = f"{catalog}.silver.observations"

supabase_url = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_URL").rstrip("/")
supabase_key = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_SECRET_KEY")

headers = {
    "apikey": supabase_key,
    "Authorization": f"Bearer {supabase_key}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}

# COMMAND ----------

# Refresh brands_seen from observations before sync
spark.sql(
    f"""
    MERGE INTO {eligible_t} AS t
    USING (
      SELECT
        media_id,
        collect_set(regexp_replace(lower(label), '^brand:', '')) AS brands_seen
      FROM {obs_t}
      WHERE source = 'twelvelabs' AND label LIKE 'brand:%'
      GROUP BY media_id
    ) AS s
    ON t.media_id = s.media_id
    WHEN MATCHED THEN UPDATE SET
      t.brands_seen = array_distinct(concat(coalesce(t.brands_seen, array()), s.brands_seen)),
      t.updated_at = current_timestamp()
    """
)

elig = (
    spark.table(eligible_t)
    .alias("e")
    .join(spark.table(assets_t).alias("a"), on="media_id", how="left")
    .select(
        F.col("e.media_id"),
        F.col("e.company_id"),
        F.coalesce(F.col("e.title"), F.col("a.title")).alias("title"),
        F.coalesce(F.col("e.media_type"), F.col("a.media_type")).alias("media_type"),
        F.coalesce(F.col("e.cdn_url"), F.col("a.cdn_url")).alias("cdn_url"),
        F.col("a.thumbnail_url"),
        F.col("e.club_code"),
        F.col("e.event_label"),
        F.col("e.game_date"),
        F.col("e.sponsors"),
        F.col("e.brands_seen"),
        F.col("e.tl_status"),
        F.col("e.tl_asset_id"),
        F.col("e.tl_index_id"),
        F.col("e.l1_passed_at"),
    )
    .orderBy(F.col("e.updated_at").desc())
    .limit(max_rows)
)

rows = elig.collect()
print(f"[sync_sb] eligible candidates={len(rows)}")


def _iso(ts) -> Optional[str]:
    if ts is None:
        return None
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        return ts.isoformat()
    return str(ts)


def _date(d) -> Optional[str]:
    if d is None:
        return None
    if isinstance(d, date):
        return d.isoformat()
    return str(d)[:10]


def upsert(table: str, payload: List[Dict[str, Any]], on_conflict: str) -> None:
    if not payload:
        return
    # PostgREST upsert in chunks
    chunk = 100
    for i in range(0, len(payload), chunk):
        part = payload[i : i + chunk]
        resp = requests.post(
            f"{supabase_url}/rest/v1/{table}",
            headers={**headers, "Prefer": f"resolution=merge-duplicates,return=minimal"},
            params={"on_conflict": on_conflict},
            json=part,
            timeout=60,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Supabase {table} upsert HTTP {resp.status_code}: {resp.text[:500]}")
        print(f"[sync_sb] upserted {len(part)} → {table}")


eligible_payload = []
for r in rows:
    club = (r.club_code or club_default or "").upper() or None
    if club and club not in ("SAS", "TOT"):
        club = None
    sponsors = list(r.sponsors) if r.sponsors else []
    brands = list(r.brands_seen) if r.brands_seen else []
    eligible_payload.append(
        {
            "media_id": r.media_id,
            "club_code": club,
            "company_id": r.company_id,
            "title": r.title,
            "media_type": r.media_type,
            "cdn_url": r.cdn_url,
            "thumbnail_url": r.thumbnail_url,
            "event_label": r.event_label or "last_night_game",
            "game_date": _date(r.game_date),
            "sponsors": sponsors,
            "brands_seen": brands,
            "tl_status": r.tl_status,
            "tl_asset_id": r.tl_asset_id,
            "tl_index_id": r.tl_index_id,
            "l1_passed_at": _iso(r.l1_passed_at),
            "synced_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
    )

upsert("eligible_media", eligible_payload, "media_id")

# COMMAND ----------

obs = (
    spark.table(obs_t)
    .where(F.col("source") == "twelvelabs")
    .orderBy(F.col("observed_at").desc())
    .limit(max_rows * 20)
    .collect()
)
print(f"[sync_sb] TL observations={len(obs)}")

evidence_payload = []
for o in obs:
    evidence_json = {}
    if o.evidence_json:
        try:
            evidence_json = json.loads(o.evidence_json)
        except json.JSONDecodeError:
            evidence_json = {"raw": o.evidence_json}
    label = o.label or ""
    observation = evidence_json.get("description") or evidence_json.get("summary") or label
    if evidence_json.get("entity"):
        observation = f"{evidence_json.get('entity')}: {evidence_json.get('description') or label}"
    evidence_payload.append(
        {
            "observation_id": o.observation_id,
            "scoreplay_media_id": o.media_id,
            "start_sec": o.start_sec,
            "end_sec": o.end_sec,
            "observation": observation or label or "twelvelabs observation",
            "source": "TWELVELABS",
            "label": label,
            "label_type": o.label_type,
            "confidence": o.confidence,
            "origin": "CACHED",
            "evidence_json": evidence_json,
            "job_run_id": o.job_run_id,
            "observed_at": _iso(o.observed_at),
        }
    )

upsert("evidence", evidence_payload, "observation_id")
print("[sync_sb] done")
