# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # L2 — Rights Passport evaluate
# MAGIC Processes `gold.l2_requests` with `status = queued`.
# MAGIC Composes active G/N/P/C/F packs; strictest cell wins; uncovered → review.

# COMMAND ----------

import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pyspark.sql import Row, functions as F
from pyspark.sql.types import (
    ArrayType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("bundle_root", "")
catalog = dbutils.widgets.get("catalog")
bundle_root = dbutils.widgets.get("bundle_root").strip()

requests_t = f"{catalog}.gold.l2_requests"
decisions_t = f"{catalog}.gold.l2_decisions"
eligible_t = f"{catalog}.silver.eligible_artifacts"
assets_t = f"{catalog}.silver.assets"
observations_t = f"{catalog}.silver.observations"

_policy_roots = []
if bundle_root:
    _policy_roots.append(Path(bundle_root) / "src")
    _policy_roots.append(Path("/Workspace") / bundle_root.lstrip("/") / "src")
_policy_roots.extend(
    [
        Path.cwd() / "src",
        Path.cwd().parent / "src",
        Path.cwd().parent.parent / "src",
        Path("/Workspace") / "src",
    ]
)
# Notebook lives at …/files/src/pipeline/ → parent.src
try:
    nb_path = Path(
        dbutils.notebook.entry_point.getDbutils()
        .notebook()
        .getContext()
        .notebookPath()
        .get()
    )
    _policy_roots.insert(0, nb_path.parent.parent)  # …/src
except Exception:
    pass

_found = None
for _root in _policy_roots:
    if (_root / "policy").exists():
        sys.path.insert(0, str(_root))
        _found = _root
        break
print(f"[l2] policy_root={_found}")

from policy.engine import evaluate_passport, flatten_rules, overall_verdict
from policy.resolve import compose_pack_ids_for_club, load_composed_rules
from policy.uc_seed import resolve_active_l2_packs

# COMMAND ----------

DECISION_SCHEMA = StructType(
    [
        StructField("decision_id", StringType(), False),
        StructField("request_id", StringType(), True),
        StructField("media_id", StringType(), False),
        StructField("company_id", StringType(), True),
        StructField("decided_at", TimestampType(), False),
        StructField("verdict", StringType(), False),
        StructField("policy_pack_id", StringType(), False),
        StructField("policy_version", StringType(), False),
        StructField("reason_codes", ArrayType(StringType()), True),
        StructField("reason_summary", StringType(), True),
        StructField("dimensions_json", StringType(), True),
        StructField("observations_used", ArrayType(StringType()), True),
        StructField("receipt_json", StringType(), True),
        StructField("job_run_id", StringType(), True),
        StructField("passport_json", StringType(), True),
    ]
)


def _infer_club(eligible_row, asset_row) -> str | None:
    if eligible_row and getattr(eligible_row, "club_code", None):
        return eligible_row.club_code
    title = (getattr(asset_row, "title", None) or "") if asset_row else ""
    blob = title.lower()
    if "tottenham" in blob or "hotspur" in blob:
        return "TOT"
    if "san antonio" in blob or "wemby" in blob or "nba" in blob:
        return "SAS"
    if "spurs" in blob:
        return "SAS"
    return None


def _facts_from_rows(eligible_row, asset_row, obs_labels: list[str], intent: dict) -> dict:
    attrs = {}
    if asset_row and asset_row.attrs_json:
        try:
            attrs = json.loads(asset_row.attrs_json)
        except Exception:
            attrs = {}
    facts = {
        "club_code": _infer_club(eligible_row, asset_row),
        "source": (intent.get("source") or attrs.get("source") or "broadcast").lower()
        if eligible_row
        else (intent.get("source") or "unknown"),
        "duration_sec": getattr(eligible_row, "duration_sec", None)
        if eligible_row
        else getattr(asset_row, "duration_sec", None),
        "game_date": str(getattr(eligible_row, "game_date", None) or attrs.get("game_date") or "")
        or None,
        "usage": (intent.get("usage") or "ORGANIC").upper(),
        "rights_partner": attrs.get("rights_partner") or intent.get("rights_partner"),
        "published_on": (intent.get("published_on") or attrs.get("published_on") or "").lower()
        or None,
        "upload_date": intent.get("upload_date") or attrs.get("upload_date"),
        "hours_since_final_whistle": intent.get("hours_since_final_whistle", attrs.get("hours_since_final_whistle")),
        "game_still_live": bool(intent.get("game_still_live", attrs.get("game_still_live", False))),
        "official_watch_party": bool(
            intent.get("official_watch_party", attrs.get("official_watch_party", False))
        ),
        "fan_consent": intent.get("fan_consent", attrs.get("fan_consent")),
        "guardian_consent": intent.get("guardian_consent", attrs.get("guardian_consent")),
        "minor_visible": intent.get("minor_visible", attrs.get("minor_visible")),
        "rival_logo_visible": intent.get("rival_logo_visible", attrs.get("rival_logo_visible")),
        "rival_logos": intent.get("rival_logos") or attrs.get("rival_logos") or [],
        "shirt_sponsor_visible": intent.get(
            "shirt_sponsor_visible", attrs.get("shirt_sponsor_visible")
        ),
        "broadcaster_graphics": intent.get(
            "broadcaster_graphics", attrs.get("broadcaster_graphics")
        ),
        "player_visible": intent.get("player_visible", attrs.get("player_visible")),
        "opponent_visible": intent.get("opponent_visible", attrs.get("opponent_visible")),
        "venue_sponsor_conflict": intent.get(
            "venue_sponsor_conflict", attrs.get("venue_sponsor_conflict")
        ),
        "music": intent.get("music") or attrs.get("music"),
        "unknown_people_count": intent.get(
            "unknown_people_count", attrs.get("unknown_people_count", 0)
        ),
        "use_commercial": (intent.get("usage") or "").upper() in ("SPONSORED", "COMMERCIAL"),
    }
    # Observation labels → light fact enrichment
    labels = {x.lower() for x in obs_labels}
    if any("broadcaster" in x or "scorebug" in x for x in labels):
        facts["broadcaster_graphics"] = True
    if any("rival" in x for x in labels):
        facts["rival_logo_visible"] = True
    if any("minor" in x or "child" in x for x in labels):
        facts["minor_visible"] = True
    if any(x.startswith("brand:") or "sponsor" in x for x in labels):
        if facts.get("shirt_sponsor_visible") is None:
            facts["shirt_sponsor_visible"] = True
    # Drop Nones for optional booleans that should not false-match
    clean = {}
    for k, v in facts.items():
        if v is None and k in (
            "fan_consent",
            "guardian_consent",
            "minor_visible",
            "rival_logo_visible",
            "shirt_sponsor_visible",
            "broadcaster_graphics",
            "player_visible",
            "opponent_visible",
            "venue_sponsor_conflict",
            "published_on",
            "music",
            "game_date",
            "hours_since_final_whistle",
        ):
            continue
        clean[k] = v
    # Defaults for broadcast when not fan
    if clean.get("source") == "broadcast":
        clean.setdefault("official_watch_party", False)
        clean.setdefault("game_still_live", False)
    return clean


# COMMAND ----------

queued = spark.table(requests_t).where(F.col("status") == "queued")
reqs = queued.collect()

eligible_map = {
    r.media_id: r for r in spark.table(eligible_t).collect()
}
asset_map = {}
try:
    for r in spark.table(assets_t).collect():
        asset_map[r.media_id] = r
except Exception:
    pass

obs_by_media: dict[str, list[str]] = {}
try:
    for r in spark.table(observations_t).select("media_id", "label").collect():
        obs_by_media.setdefault(r.media_id, []).append(r.label or "")
except Exception:
    pass

print(f"[l2] queued_requests={len(reqs)} eligible_pool={len(eligible_map)}")

try:
    ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
    job_run_id = str(ctx.currentRunId().get()) if ctx.currentRunId().isDefined() else "local"
except Exception:
    job_run_id = "local"

decision_rows = []
now = datetime.now(timezone.utc).replace(tzinfo=None)

for req in reqs:
    elig = eligible_map.get(req.media_id)
    asset = asset_map.get(req.media_id)
    intent = {}
    if req.intent_json:
        try:
            intent = json.loads(req.intent_json)
        except Exception:
            intent = {}

    if not elig:
        verdict = "BLOCKED"
        codes = ["L2_NOT_ELIGIBLE"]
        summary = "Media not in L1 eligible pool (or L1 rejected)"
        dims = {"eligibility": "BLOCKED"}
        passport = None
        pack_id = "l2-passport"
        pack_ver = "0.1.0"
        fired = []
    else:
        club = _infer_club(elig, asset)
        packs = resolve_active_l2_packs(spark, club, catalog)
        if packs:
            rules = flatten_rules(packs)
            pack_id = "+".join(compose_pack_ids_for_club(club)[:3])
            pack_ver = packs[0].get("version") or "0.1.0"
        else:
            rules = load_composed_rules(club)
            pack_id = "l2-passport-local"
            pack_ver = "0.1.0"
        facts = _facts_from_rows(elig, asset, obs_by_media.get(req.media_id, []), intent)
        passport = evaluate_passport(rules, facts, now=datetime.now(timezone.utc))
        verdict = overall_verdict(passport)
        fired = passport.get("rules_fired") or []
        codes = fired[:20] or ["L2_PASSPORT"]
        summary = (
            f"Passport evaluated ({len(fired)} rules fired); "
            f"usable_until={passport.get('usable_until')}"
        )
        dims = {
            "passport": True,
            "club_code": club,
            "worst": verdict,
        }

    decision_id = str(uuid.uuid4())
    receipt = {
        "decision_id": decision_id,
        "request_id": req.request_id,
        "media_id": req.media_id,
        "verdict": verdict,
        "policy_pack_id": pack_id,
        "policy_version": pack_ver,
        "demo": True,
        "rules_fired": fired,
    }
    decision_rows.append(
        Row(
            decision_id=decision_id,
            request_id=req.request_id,
            media_id=req.media_id,
            company_id=req.company_id,
            decided_at=now,
            verdict=verdict,
            policy_pack_id=pack_id,
            policy_version=pack_ver,
            reason_codes=codes,
            reason_summary=summary,
            dimensions_json=json.dumps(dims),
            observations_used=[],
            receipt_json=json.dumps(receipt),
            job_run_id=job_run_id,
            passport_json=json.dumps(passport) if passport else None,
        )
    )

# COMMAND ----------

if decision_rows:
    # Prefer writing with passport_json; fall back if column missing
    try:
        spark.createDataFrame(decision_rows, schema=DECISION_SCHEMA).write.mode("append").saveAsTable(
            decisions_t
        )
    except Exception as e:
        print(f"[l2] write with passport_json failed ({e}); retrying without column")
        slim = []
        for d in decision_rows:
            slim.append(
                Row(
                    decision_id=d.decision_id,
                    request_id=d.request_id,
                    media_id=d.media_id,
                    company_id=d.company_id,
                    decided_at=d.decided_at,
                    verdict=d.verdict,
                    policy_pack_id=d.policy_pack_id,
                    policy_version=d.policy_version,
                    reason_codes=d.reason_codes,
                    reason_summary=d.reason_summary,
                    dimensions_json=d.dimensions_json,
                    observations_used=d.observations_used,
                    receipt_json=d.receipt_json,
                    job_run_id=d.job_run_id,
                )
            )
        spark.createDataFrame(slim).write.mode("append").saveAsTable(decisions_t)

    ids = [d.request_id for d in decision_rows]
    spark.sql(
        f"""
        UPDATE {requests_t}
        SET status = 'decided'
        WHERE request_id IN ({",".join(repr(i) for i in ids)})
        """
    )

print(f"[l2] decisions_written={len(decision_rows)}")
