# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # L1 — safety preprocess
# MAGIC DEMO deterministic pack until `rules.l1_policy_packs` is seeded.
# MAGIC `AUTO_REJECT` → `gold.rejected_artifacts` · `PASS_L1` → `silver.eligible_artifacts`.
# MAGIC `run_mode=full` ignores lookback; `force=true` re-evaluates even if a prior decision exists.

# COMMAND ----------

import json
import re
import uuid
from datetime import date, datetime, timezone
from typing import List, Optional, Tuple

from pyspark.sql import Row, functions as F
from pyspark.sql.types import (
    ArrayType,
    DateType,
    DoubleType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("lookback_hours", "24")
dbutils.widgets.dropdown("run_mode", "incremental", ["incremental", "full"])
dbutils.widgets.dropdown("force", "false", ["false", "true"])
dbutils.widgets.text("media_id", "")

catalog = dbutils.widgets.get("catalog")
lookback_hours = int(dbutils.widgets.get("lookback_hours"))
run_mode = dbutils.widgets.get("run_mode").strip().lower()
force = dbutils.widgets.get("force").strip().lower() == "true"
media_id = dbutils.widgets.get("media_id").strip()

assets_t = f"{catalog}.silver.assets"
decisions_t = f"{catalog}.gold.l1_decisions"
rejected_t = f"{catalog}.gold.rejected_artifacts"
eligible_t = f"{catalog}.silver.eligible_artifacts"

import sys
from pathlib import Path

_policy_roots = [
    Path.cwd() / "src",
    Path.cwd().parent / "src",
    Path("/Workspace") / "src",
]
for _root in _policy_roots:
    if (_root / "policy").exists():
        sys.path.insert(0, str(_root))
        break

try:
    from policy.resolve import fallback_l1_tokens, l1_tokens_from_pack
    from policy.uc_seed import resolve_active_l1

    _l1_pack = resolve_active_l1(spark, catalog)
    if _l1_pack:
        POLICY_PACK_ID = _l1_pack.get("pack_id") or "l1-safety-demo"
        POLICY_VERSION = _l1_pack.get("version") or "0.1.0"
        REJECT_TOKENS = l1_tokens_from_pack(_l1_pack)
        print(f"[l1] active pack {POLICY_PACK_ID}@{POLICY_VERSION} tokens={len(REJECT_TOKENS)}")
    else:
        POLICY_PACK_ID = "l1-safety-demo"
        POLICY_VERSION = "0.1.0"
        REJECT_TOKENS = fallback_l1_tokens()
        print("[l1] L1_PACK_FALLBACK — no activation; using hardcoded tokens")
except Exception as e:
    POLICY_PACK_ID = "l1-safety-demo"
    POLICY_VERSION = "0.1.0"
    REJECT_TOKENS = (
        "nsfw",
        "nude",
        "nudity",
        "gore",
        "graphic_violence",
        "hate_symbol",
        "drug_use",
        "csam",
    )
    print(f"[l1] L1_PACK_FALLBACK ({type(e).__name__}: {e})")

DECISION_SCHEMA = StructType(
    [
        StructField("decision_id", StringType(), False),
        StructField("media_id", StringType(), False),
        StructField("company_id", StringType(), True),
        StructField("decided_at", TimestampType(), False),
        StructField("verdict", StringType(), False),
        StructField("policy_pack_id", StringType(), False),
        StructField("policy_version", StringType(), False),
        StructField("reason_codes", ArrayType(StringType()), True),
        StructField("reason_summary", StringType(), True),
        StructField("evidence_json", StringType(), True),
        StructField("input_event_id", StringType(), True),
        StructField("job_run_id", StringType(), True),
        StructField("model_name", StringType(), True),
    ]
)

REJECT_SCHEMA = StructType(
    [
        StructField("media_id", StringType(), False),
        StructField("company_id", StringType(), True),
        StructField("latest_decision_id", StringType(), False),
        StructField("verdict", StringType(), False),
        StructField("first_rejected_at", TimestampType(), False),
        StructField("last_rejected_at", TimestampType(), False),
        StructField("reason_codes", ArrayType(StringType()), True),
        StructField("reason_summary", StringType(), True),
        StructField("title", StringType(), True),
        StructField("media_type", StringType(), True),
        StructField("cdn_url", StringType(), True),
        StructField("triage_status", StringType(), True),
        StructField("triage_notes", StringType(), True),
        StructField("updated_at", TimestampType(), False),
    ]
)

ELIGIBLE_SCHEMA = StructType(
    [
        StructField("media_id", StringType(), False),
        StructField("company_id", StringType(), True),
        StructField("title", StringType(), True),
        StructField("media_type", StringType(), True),
        StructField("cdn_url", StringType(), True),
        StructField("duration_sec", DoubleType(), True),
        StructField("l1_decision_id", StringType(), False),
        StructField("l1_passed_at", TimestampType(), False),
        StructField("tl_asset_id", StringType(), True),
        StructField("tl_index_id", StringType(), True),
        StructField("tl_status", StringType(), True),
        StructField("attrs_json", StringType(), True),
        StructField("club_code", StringType(), True),
        StructField("event_label", StringType(), True),
        StructField("game_date", DateType(), True),
        StructField("sponsors", ArrayType(StringType()), True),
        StructField("brands_seen", ArrayType(StringType()), True),
        StructField("updated_at", TimestampType(), False),
    ]
)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def infer_club_code(title: Optional[str], attrs_json: Optional[str]) -> Optional[str]:
    blob = f"{title or ''} {attrs_json or ''}".lower()
    if any(x in blob for x in ("tottenham", "hotspur", "thfc", "premier league")):
        return "TOT"
    if any(x in blob for x in ("san antonio", "wemby", "wembanyama", "nba")):
        return "SAS"
    # "spurs" alone is ambiguous (both clubs); prefer SAS for NBA context only
    if "spurs" in blob and "tottenham" not in blob:
        return "SAS"
    return None


def extract_sponsors(attrs_json: Optional[str]) -> List[str]:
    if not attrs_json:
        return []
    try:
        data = json.loads(attrs_json)
    except json.JSONDecodeError:
        return []
    out = []
    tags = data.get("tags") or data.get("media", {}).get("tags") or []
    if isinstance(tags, list):
        for t in tags:
            if not isinstance(t, dict):
                continue
            sponsor = t.get("sponsor") or {}
            label = sponsor.get("label") or sponsor.get("name") or t.get("label")
            if label and (sponsor or "sponsor" in str(t.get("type", "")).lower()):
                out.append(str(label))
    for key in ("sponsors", "sponsor_labels"):
        vals = data.get(key)
        if isinstance(vals, list):
            out.extend(str(v) for v in vals if v)
    # dedupe preserve order
    seen = set()
    uniq = []
    for s in out:
        k = s.lower()
        if k not in seen:
            seen.add(k)
            uniq.append(s)
    return uniq


def infer_event_facets(attrs_json: Optional[str], title: Optional[str]) -> Tuple[str, date]:
    """Best-effort event_label + game_date for partner discover."""
    event_label = None
    blob = f"{title or ''} {attrs_json or ''}".lower()
    if any(x in blob for x in ("last night", "last_night", "yesterday", "gameday", "matchday")):
        event_label = "last_night_game"
    try:
        data = json.loads(attrs_json) if attrs_json else {}
    except json.JSONDecodeError:
        data = {}
    ev = data.get("event") if isinstance(data, dict) else None
    if isinstance(ev, dict):
        name = ev.get("name") or ev.get("full_path")
        if name and not event_label:
            event_label = str(name)[:120]
    if not event_label:
        event_label = "last_night_game"
    # Hackathon: treat pool as recent game for weekend partner demos
    return event_label, date.today()

# COMMAND ----------

base = spark.table(assets_t)
if media_id:
    base = base.where(F.col("media_id") == media_id)
    print(f"[l1] scoped to media_id={media_id}")
elif run_mode != "full":
    cutoff = F.current_timestamp() - F.expr(f"INTERVAL {lookback_hours} HOURS")
    base = base.where(F.col("ingested_at") >= cutoff)

# Per-artifact webhook runs always re-evaluate that media_id.
effective_force = force or bool(media_id)

if effective_force:
    candidates = base
    print(
        f"[l1] run_mode={run_mode} force={effective_force} — re-evaluating all in scope"
    )
else:
    already = spark.table(decisions_t).select("media_id").distinct()
    candidates = base.join(already, on="media_id", how="left_anti")

rows = candidates.collect()
print(
    f"[l1] run_mode={run_mode} force={effective_force} media_id={media_id or '-'} candidates={len(rows)}"
)

try:
    ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
    job_run_id = str(ctx.currentRunId().get()) if ctx.currentRunId().isDefined() else "local"
except Exception:
    job_run_id = "local"

# COMMAND ----------

def evaluate(row) -> dict:
    blob = " ".join(
        [
            (row.title or ""),
            (row.description or ""),
            (row.attrs_json or ""),
            (row.media_type or ""),
        ]
    ).lower()
    hits = [t for t in REJECT_TOKENS if t in blob]
    if hits:
        return {
            "verdict": "AUTO_REJECT",
            "reason_codes": [f"L1_{h.upper()}" for h in hits],
            "reason_summary": f"DEMO L1 reject tokens: {', '.join(hits)}",
            "evidence_json": json.dumps({"tokens": hits}),
        }
    return {
        "verdict": "PASS_L1",
        "reason_codes": ["L1_CLEAR"],
        "reason_summary": "DEMO L1: no hard-reject tokens matched",
        "evidence_json": json.dumps({"tokens": []}),
    }


decision_rows = []
reject_rows = []
eligible_rows = []
now = datetime.now(timezone.utc).replace(tzinfo=None)

for r in rows:
    ev = evaluate(r)
    decision_id = str(uuid.uuid4())
    decision_rows.append(
        Row(
            decision_id=decision_id,
            media_id=r.media_id,
            company_id=r.company_id,
            decided_at=now,
            verdict=ev["verdict"],
            policy_pack_id=POLICY_PACK_ID,
            policy_version=POLICY_VERSION,
            reason_codes=list(ev["reason_codes"]),
            reason_summary=ev["reason_summary"],
            evidence_json=ev["evidence_json"],
            input_event_id=r.source_event_id,
            job_run_id=job_run_id,
            model_name="l1-demo-token-v0",
        )
    )
    if ev["verdict"] == "AUTO_REJECT":
        reject_rows.append(
            Row(
                media_id=r.media_id,
                company_id=r.company_id,
                latest_decision_id=decision_id,
                verdict="AUTO_REJECT",
                first_rejected_at=now,
                last_rejected_at=now,
                reason_codes=list(ev["reason_codes"]),
                reason_summary=ev["reason_summary"],
                title=r.title,
                media_type=r.media_type,
                cdn_url=r.cdn_url,
                triage_status="new",
                triage_notes=None,
                updated_at=now,
            )
        )
    else:
        dur = float(r.duration_sec) if r.duration_sec is not None else None
        sponsors = extract_sponsors(r.attrs_json)
        brands = [_slug(s) for s in sponsors if _slug(s)]
        event_label, game_date = infer_event_facets(r.attrs_json, r.title)
        eligible_rows.append(
            Row(
                media_id=r.media_id,
                company_id=r.company_id,
                title=r.title,
                media_type=r.media_type,
                cdn_url=r.cdn_url,
                duration_sec=dur,
                l1_decision_id=decision_id,
                l1_passed_at=now,
                tl_asset_id=None,
                tl_index_id=None,
                tl_status="pending",
                attrs_json=r.attrs_json,
                club_code=infer_club_code(r.title, r.attrs_json),
                event_label=event_label,
                game_date=game_date,
                sponsors=sponsors,
                brands_seen=brands,
                updated_at=now,
            )
        )

# COMMAND ----------

if decision_rows:
    spark.createDataFrame(decision_rows, schema=DECISION_SCHEMA).write.mode("append").saveAsTable(
        decisions_t
    )
    print(f"[l1] appended {len(decision_rows)} → {decisions_t}")
else:
    print("[l1] no new decisions")

if reject_rows:
    spark.createDataFrame(reject_rows, schema=REJECT_SCHEMA).createOrReplaceTempView("_reject_stage")
    spark.sql(
        f"""
        MERGE INTO {rejected_t} AS t
        USING _reject_stage AS s
        ON t.media_id = s.media_id
        WHEN MATCHED THEN UPDATE SET
          t.latest_decision_id = s.latest_decision_id,
          t.last_rejected_at = s.last_rejected_at,
          t.reason_codes = s.reason_codes,
          t.reason_summary = s.reason_summary,
          t.title = coalesce(s.title, t.title),
          t.updated_at = s.updated_at
        WHEN NOT MATCHED THEN INSERT *
        """
    )
    print(f"[l1] upserted {len(reject_rows)} → {rejected_t}")

if eligible_rows:
    spark.createDataFrame(eligible_rows, schema=ELIGIBLE_SCHEMA).createOrReplaceTempView(
        "_elig_stage"
    )
    spark.sql(
        f"""
        MERGE INTO {eligible_t} AS t
        USING _elig_stage AS s
        ON t.media_id = s.media_id
        WHEN MATCHED THEN UPDATE SET
          t.l1_decision_id = s.l1_decision_id,
          t.l1_passed_at = s.l1_passed_at,
          t.title = coalesce(s.title, t.title),
          t.cdn_url = coalesce(s.cdn_url, t.cdn_url),
          t.attrs_json = coalesce(s.attrs_json, t.attrs_json),
          t.club_code = coalesce(s.club_code, t.club_code),
          t.event_label = coalesce(s.event_label, t.event_label),
          t.game_date = coalesce(s.game_date, t.game_date),
          t.sponsors = coalesce(s.sponsors, t.sponsors),
          t.brands_seen = coalesce(s.brands_seen, t.brands_seen),
          t.updated_at = s.updated_at,
          t.tl_status = coalesce(t.tl_status, s.tl_status)
        WHEN NOT MATCHED THEN INSERT *
        """
    )
    print(f"[l1] upserted {len(eligible_rows)} → {eligible_t}")

# Repair path: PASS_L1 decisions missing from eligible (e.g. prior schema-inference failure)
spark.sql(
    f"""
    MERGE INTO {eligible_t} AS t
    USING (
      SELECT
        a.media_id,
        a.company_id,
        a.title,
        a.media_type,
        a.cdn_url,
        a.duration_sec,
        d.decision_id AS l1_decision_id,
        d.decided_at AS l1_passed_at,
        cast(null AS string) AS tl_asset_id,
        cast(null AS string) AS tl_index_id,
        'pending' AS tl_status,
        a.attrs_json,
        cast(null AS string) AS club_code,
        cast('last_night_game' AS string) AS event_label,
        current_date() AS game_date,
        cast(array() AS array<string>) AS sponsors,
        cast(array() AS array<string>) AS brands_seen,
        current_timestamp() AS updated_at
      FROM {assets_t} a
      INNER JOIN (
        SELECT media_id, decision_id, decided_at,
               row_number() OVER (PARTITION BY media_id ORDER BY decided_at DESC) AS rn
        FROM {decisions_t}
        WHERE verdict = 'PASS_L1'
      ) d ON a.media_id = d.media_id AND d.rn = 1
      LEFT ANTI JOIN {eligible_t} e ON a.media_id = e.media_id
    ) AS s
    ON t.media_id = s.media_id
    WHEN NOT MATCHED THEN INSERT *
    """
)
print("[l1] repair merge for missing eligible rows complete")

# Refresh brands_seen from TL observations (idempotent facet rollup)
spark.sql(
    f"""
    MERGE INTO {eligible_t} AS t
    USING (
      SELECT
        media_id,
        collect_set(regexp_replace(lower(label), '^brand:', '')) AS brands_seen
      FROM {catalog}.silver.observations
      WHERE source = 'twelvelabs' AND label LIKE 'brand:%'
      GROUP BY media_id
    ) AS s
    ON t.media_id = s.media_id
    WHEN MATCHED THEN UPDATE SET
      t.brands_seen = array_distinct(concat(coalesce(t.brands_seen, array()), s.brands_seen)),
      t.updated_at = current_timestamp()
    """
)
print("[l1] brands_seen refreshed from TL observations")

print(
    f"[l1] summary pass={len(eligible_rows)} reject={len(reject_rows)} "
    f"pack={POLICY_PACK_ID}@{POLICY_VERSION} DEMO ONLY"
)
