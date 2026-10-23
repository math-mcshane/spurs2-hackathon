# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Enrich eligible — TwelveLabs URL ingest + Pegasus observations
# MAGIC For `PASS_L1` rows: resolve or create a TL asset, run Pegasus (same rubric as REROUTE),
# MAGIC write `silver.observations` + `bronze.tl_api_raw`, set `tl_status` to `ready` / `failed` / `skipped`.
# MAGIC
# MAGIC Secrets (`spurs2-hackathon`): `TWELVELABS_API_KEY`, optional `TWELVELABS_INDEX_ID`.
# MAGIC Observations never grant rights — L2 packs consume them as evidence only.

# COMMAND ----------

import json
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional, Tuple
from urllib.parse import quote

import requests
from pyspark.sql import Row, functions as F
from pyspark.sql.types import (
    DoubleType,
    IntegerType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("secret_scope", "spurs2-hackathon")
dbutils.widgets.text("max_items", "10")
dbutils.widgets.dropdown("force", "false", ["false", "true"])
dbutils.widgets.text("media_id", "")
dbutils.widgets.text("index_id", "")  # optional override; else secret TWELVELABS_INDEX_ID

catalog = dbutils.widgets.get("catalog")
secret_scope = dbutils.widgets.get("secret_scope")
max_items = max(1, int(dbutils.widgets.get("max_items") or "10"))
force = dbutils.widgets.get("force").strip().lower() == "true"
media_id_filter = dbutils.widgets.get("media_id").strip()
index_id_widget = dbutils.widgets.get("index_id").strip()

eligible_t = f"{catalog}.silver.eligible_artifacts"
observations_t = f"{catalog}.silver.observations"
tl_raw_t = f"{catalog}.bronze.tl_api_raw"

API_BASE = "https://api.twelvelabs.io/v1.3"
PEGASUS_MODEL = "pegasus1.6"
ASSET_POLL_SEC = 5
ASSET_POLL_MAX = 60  # ~5 min
ANALYZE_TIMEOUT = 300

CUSTOM_ID_KEYS = (
    "custom_id",
    "customId",
    "scoreplay_id",
    "scoreplayMediaId",
    "scoreplay_media_id",
)

OBSERVATION_CATEGORIES = ("sponsor_brand", "person", "broadcaster", "onscreen_graphic")
LABEL_PREFIX = {
    "sponsor_brand": "brand",
    "person": "person",
    "broadcaster": "broadcaster",
    "onscreen_graphic": "graphic",
}
LABEL_TYPE = {
    "sponsor_brand": "brand",
    "person": "person",
    "broadcaster": "other",
    "onscreen_graphic": "other",
}
RUBRIC = {
    "broadcast_source": [
        "national",
        "regional",
        "mixed_regional",
        "league_produced",
        "international_broadcaster",
        "no_game_footage",
        "unknown",
    ],
    "scorebug_watermark": [
        "present",
        "partially_removed",
        "clean_feed",
        "produced_feature",
        "no_game_action",
    ],
    "player_focus": ["group", "no_players", "single_player", "single_player_commercial"],
    "gambling_brand": ["none", "incidental", "promotional"],
}

# Aligned with reroute/src/lib/twelvelabs/parse.ts (PEGASUS_JSON_SCHEMA / PEGASUS_PROMPT)
PEGASUS_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "observations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "enum": list(OBSERVATION_CATEGORIES)},
                    "entity": {"type": "string"},
                    "start_time": {"type": "timestamp", "format": "seconds"},
                    "end_time": {"type": "timestamp", "format": "seconds"},
                    "description": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": [
                    "category",
                    "entity",
                    "start_time",
                    "end_time",
                    "description",
                    "confidence",
                ],
            },
        },
        "rubric": {
            "type": "object",
            "properties": {k: {"type": "string", "enum": v} for k, v in RUBRIC.items()},
            "required": list(RUBRIC.keys()),
        },
        "summary": {"type": "string"},
    },
    "required": ["observations", "rubric", "summary"],
}

PEGASUS_PROMPT = """You are auditing a sports clip for media-rights clearance. Report only what you can actually see or hear; never infer from team, arena or context. Every observation MUST carry the start_time and end_time (seconds from the start of the video) during which it is visible or audible.

List observations of these categories:
- sponsor_brand: every sponsor or commercial brand mark — broadcast graphics, overlays, LED boards, prominent arena/stadium signage, logos on jerseys/kits or other team-controlled surfaces. Name the brand as written. Note in the description whether it is part of the live picture or added by the edit.
- person: every identifiable player, coach or person, identified only by name graphic, jersey/shirt name or number, or commentary. Say how they were identified.
- broadcaster: every network or broadcaster logo/bug, scorebug branding or mic flag. Only name a network you can see or hear named.
- onscreen_graphic: scorebugs, lower thirds, watermarks, title cards and other overlays (entity = short name of the graphic).

confidence = your confidence (0 to 1) that the observation is correct. Omit anything you are unsure exists.

Rubric (choose exactly one option each):
- broadcast_source: which broadcast network or production source the game footage comes from; "unknown" if game footage shows no network bug and no scorebug.
- scorebug_watermark: is game action shown with its broadcast scorebug / network watermark, or as a clean feed? Arena scoreboards and jumbotrons are NOT scorebugs.
- player_focus: is one player the clear focus, and is the clip framed as that player's endorsement?
- gambling_brand: is a gambling or betting brand shown, and is it part of the live picture (incidental) or promoted by the edit (promotional)?

summary: one paragraph for a rights reviewer: what the clip is and which rights questions it raises (sponsors, people, broadcaster, graphics)."""

OBS_SCHEMA = StructType(
    [
        StructField("observation_id", StringType(), False),
        StructField("media_id", StringType(), False),
        StructField("source", StringType(), False),
        StructField("observed_at", TimestampType(), False),
        StructField("label", StringType(), True),
        StructField("label_type", StringType(), True),
        StructField("confidence", DoubleType(), True),
        StructField("start_sec", DoubleType(), True),
        StructField("end_sec", DoubleType(), True),
        StructField("evidence_json", StringType(), True),
        StructField("job_run_id", StringType(), True),
    ]
)

RAW_SCHEMA = StructType(
    [
        StructField("request_id", StringType(), False),
        StructField("media_id", StringType(), True),
        StructField("request_type", StringType(), False),
        StructField("request_json", StringType(), True),
        StructField("response_json", StringType(), True),
        StructField("http_status", IntegerType(), True),
        StructField("model_name", StringType(), True),
        StructField("received_at", TimestampType(), False),
        StructField("job_run_id", StringType(), True),
    ]
)

# COMMAND ----------

api_key = dbutils.secrets.get(scope=secret_scope, key="TWELVELABS_API_KEY")
index_id = index_id_widget
if not index_id:
    try:
        index_id = dbutils.secrets.get(scope=secret_scope, key="TWELVELABS_INDEX_ID").strip()
    except Exception:
        index_id = ""

try:
    ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
    job_run_id = str(ctx.currentRunId().get()) if ctx.currentRunId().isDefined() else "local"
except Exception:
    job_run_id = "local"

session = requests.Session()
session.headers.update({"x-api-key": api_key, "Accept": "application/json"})

print(
    f"[enrich] catalog={catalog} max_items={max_items} force={force} "
    f"index_id={'set' if index_id else 'none'} media_id={media_id_filter or '*'}"
)

# COMMAND ----------


def slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _truncate(obj: Any, n: int = 8000) -> str:
    try:
        text = obj if isinstance(obj, str) else json.dumps(obj, default=str)
    except Exception:
        text = str(obj)
    return text if len(text) <= n else text[: n - 20] + "...<truncated>"


def log_raw(
    rows: list,
    media_id: str,
    request_type: str,
    request_body: Any,
    response_body: Any,
    http_status: Optional[int],
    model_name: Optional[str] = None,
) -> None:
    rows.append(
        Row(
            request_id=str(uuid.uuid4()),
            media_id=media_id,
            request_type=request_type,
            request_json=_truncate(request_body),
            response_json=_truncate(response_body),
            http_status=int(http_status) if http_status is not None else None,
            model_name=model_name,
            received_at=datetime.now(timezone.utc).replace(tzinfo=None),
            job_run_id=job_run_id,
        )
    )


def custom_id_from_meta(meta: Optional[dict]) -> Optional[str]:
    if not meta:
        return None
    for key in CUSTOM_ID_KEYS:
        v = meta.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return str(v)
    return None


def find_indexed_video(scoreplay_media_id: str, raw_rows: list) -> Optional[dict]:
    """Return {video_id, asset_id} from organizer index if present."""
    if not index_id:
        return None
    for key in CUSTOM_ID_KEYS:
        # SDK list filter; REST accepts user_metadata as JSON object query param in v1.3
        params = {
            "page_limit": 2,
            "user_metadata": json.dumps({key: scoreplay_media_id}),
        }
        url = f"{API_BASE}/indexes/{quote(index_id, safe='')}/videos"
        resp = session.get(url, params=params, timeout=60)
        body: Any
        try:
            body = resp.json()
        except Exception:
            body = resp.text
        log_raw(raw_rows, scoreplay_media_id, "index_lookup", {"url": url, "params": params}, body, resp.status_code)
        if resp.status_code >= 400:
            continue
        data = body.get("data") if isinstance(body, dict) else None
        if not data:
            continue
        v = data[0]
        vid = v.get("_id") or v.get("id")
        asset_id = v.get("asset_id") or v.get("assetId")
        if not asset_id:
            # retrieve for asset_id
            r2 = session.get(f"{API_BASE}/indexes/{quote(index_id, safe='')}/videos/{quote(vid, safe='')}", timeout=60)
            try:
                detail = r2.json()
            except Exception:
                detail = r2.text
            log_raw(
                raw_rows,
                scoreplay_media_id,
                "video_retrieve",
                {"video_id": vid},
                detail,
                r2.status_code,
            )
            if isinstance(detail, dict):
                asset_id = detail.get("asset_id") or detail.get("assetId")
                meta = detail.get("user_metadata") or detail.get("userMetadata") or {}
                if custom_id_from_meta(meta) and custom_id_from_meta(meta) != scoreplay_media_id:
                    print(f"[enrich] warn metadata mismatch for {vid}")
        if vid or asset_id:
            return {"video_id": vid, "asset_id": asset_id}
    return None


def create_asset_from_url(media_id: str, cdn_url: str, raw_rows: list) -> str:
    """POST /assets (multipart url method). Returns asset id when ready."""
    meta = json.dumps({"custom_id": media_id, "scoreplay_media_id": media_id})
    resp = session.post(
        f"{API_BASE}/assets",
        data={"method": "url", "url": cdn_url, "user_metadata": meta, "enable_hls": "false"},
        timeout=120,
    )
    try:
        body = resp.json()
    except Exception:
        body = resp.text
    log_raw(
        raw_rows,
        media_id,
        "asset_create",
        {"method": "url", "url": cdn_url, "user_metadata": meta},
        body,
        resp.status_code,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"asset_create HTTP {resp.status_code}: {_truncate(body, 500)}")
    asset_id = body.get("_id") or body.get("id") if isinstance(body, dict) else None
    if not asset_id:
        raise RuntimeError(f"asset_create missing id: {_truncate(body, 500)}")

    for _ in range(ASSET_POLL_MAX):
        r = session.get(f"{API_BASE}/assets/{quote(asset_id, safe='')}", timeout=60)
        try:
            st = r.json()
        except Exception:
            st = {}
        status = st.get("status") if isinstance(st, dict) else None
        if status == "ready":
            log_raw(raw_rows, media_id, "asset_ready", {"asset_id": asset_id}, st, r.status_code)
            return asset_id
        if status == "failed":
            log_raw(raw_rows, media_id, "asset_failed", {"asset_id": asset_id}, st, r.status_code)
            raise RuntimeError(f"asset {asset_id} failed: {_truncate(st, 500)}")
        time.sleep(ASSET_POLL_SEC)
    raise RuntimeError(f"asset {asset_id} not ready after poll")


def analyze_video(media_id: str, asset_id: Optional[str], video_id: Optional[str], raw_rows: list) -> str:
    """Sync Pegasus analyze; returns JSON data string."""
    common = {
        "model_name": PEGASUS_MODEL,
        "prompt": PEGASUS_PROMPT,
        "temperature": 0.1,
        "max_tokens": 4096,
        "stream": False,
        "response_format": {"type": "json_schema", "json_schema": PEGASUS_JSON_SCHEMA},
    }
    if asset_id:
        payload = {**common, "video": {"type": "asset_id", "asset_id": asset_id}}
    elif video_id:
        # Legacy indexed videos without asset_id
        payload = {
            "video_id": video_id,
            "prompt": PEGASUS_PROMPT,
            "temperature": 0.1,
            "max_tokens": 4096,
            "stream": False,
            "response_format": {"type": "json_schema", "json_schema": PEGASUS_JSON_SCHEMA},
        }
    else:
        raise RuntimeError("analyze needs asset_id or video_id")

    resp = session.post(f"{API_BASE}/analyze", json=payload, timeout=ANALYZE_TIMEOUT)
    try:
        body = resp.json()
    except Exception:
        body = resp.text
    log_raw(raw_rows, media_id, "analyze", {"has_asset": bool(asset_id), "video_id": video_id}, body, resp.status_code, PEGASUS_MODEL)
    if resp.status_code >= 400:
        raise RuntimeError(f"analyze HTTP {resp.status_code}: {_truncate(body, 800)}")
    if not isinstance(body, dict) or not isinstance(body.get("data"), str):
        raise RuntimeError(f"analyze returned no data: {_truncate(body, 500)}")
    if body.get("finish_reason") == "length":
        raise RuntimeError("Pegasus output truncated (finish_reason=length)")
    return body["data"]


def analyze_image(media_id: str, asset_id: str, raw_rows: list) -> str:
    payload = {
        "model_name": PEGASUS_MODEL,
        "image": [{"name": "scoreplay_still", "asset_id": asset_id}],
        "prompt": PEGASUS_PROMPT,
        "temperature": 0.1,
        "max_tokens": 4096,
        "stream": False,
        "response_format": {"type": "json_schema", "json_schema": PEGASUS_JSON_SCHEMA},
    }
    resp = session.post(f"{API_BASE}/analyze", json=payload, timeout=ANALYZE_TIMEOUT)
    try:
        body = resp.json()
    except Exception:
        body = resp.text
    log_raw(raw_rows, media_id, "analyze", {"image_asset_id": asset_id}, body, resp.status_code, PEGASUS_MODEL)
    if resp.status_code >= 400:
        raise RuntimeError(f"analyze image HTTP {resp.status_code}: {_truncate(body, 800)}")
    if not isinstance(body, dict) or not isinstance(body.get("data"), str):
        raise RuntimeError(f"analyze image returned no data: {_truncate(body, 500)}")
    if body.get("finish_reason") == "length":
        raise RuntimeError("Pegasus output truncated (finish_reason=length)")
    return body["data"]


def parse_observations(raw: str, media_id: str, now: datetime) -> Tuple[List[Row], int]:
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```$", "", text)
    try:
        top = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Pegasus output is not valid JSON: {e}") from e
    if not isinstance(top, dict) or "observations" not in top:
        raise RuntimeError("Pegasus output missing observations")

    rows = []  # type: List[Row]
    dropped = 0
    for item in top.get("observations") or []:
        if not isinstance(item, dict):
            dropped += 1
            continue
        cat = item.get("category")
        entity = str(item.get("entity") or "").strip()
        try:
            start = float(item.get("start_time"))
            end = float(item.get("end_time"))
            conf = float(item.get("confidence"))
        except (TypeError, ValueError):
            dropped += 1
            continue
        desc = str(item.get("description") or "").strip()
        slug = slugify(entity)
        if cat not in OBSERVATION_CATEGORIES or not slug or end < start or not desc:
            dropped += 1
            continue
        if conf < 0 or conf > 1:
            conf = max(0.0, min(1.0, conf))
        label = f"{LABEL_PREFIX[cat]}:{slug}"
        rows.append(
            Row(
                observation_id=str(uuid.uuid4()),
                media_id=media_id,
                source="twelvelabs",
                observed_at=now,
                label=label,
                label_type=LABEL_TYPE[cat],
                confidence=conf,
                start_sec=start,
                end_sec=end,
                evidence_json=json.dumps(
                    {
                        "category": cat,
                        "entity": entity,
                        "description": desc,
                        "origin": "LIVE",
                    }
                ),
                job_run_id=job_run_id,
            )
        )

    rubric = top.get("rubric") or {}
    for question, options in RUBRIC.items():
        answer = rubric.get(question)
        if isinstance(answer, str) and answer in options:
            rows.append(
                Row(
                    observation_id=str(uuid.uuid4()),
                    media_id=media_id,
                    source="twelvelabs",
                    observed_at=now,
                    label=f"rubric:{question}:{answer}",
                    label_type="other",
                    confidence=None,
                    start_sec=None,
                    end_sec=None,
                    evidence_json=json.dumps({"question": question, "answer": answer, "origin": "LIVE"}),
                    job_run_id=job_run_id,
                )
            )

    summary = top.get("summary")
    if isinstance(summary, str) and summary.strip():
        rows.append(
            Row(
                observation_id=str(uuid.uuid4()),
                media_id=media_id,
                source="twelvelabs",
                observed_at=now,
                label="summary",
                label_type="other",
                confidence=None,
                start_sec=None,
                end_sec=None,
                evidence_json=json.dumps({"summary": summary.strip(), "origin": "LIVE"}),
                job_run_id=job_run_id,
            )
        )
    return rows, dropped


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


# COMMAND ----------

elig = spark.table(eligible_t)
if media_id_filter:
    elig = elig.where(F.col("media_id") == media_id_filter)

if force:
    elig = elig.where(F.col("tl_status").isin("pending", "skipped", "failed", "ready"))
else:
    # include skipped: prior stub wrote skipped without observations
    elig = elig.where(F.col("tl_status").isin("pending", "skipped", "failed"))
    # Idempotent: do not re-call TwelveLabs when observations already exist
    already_obs = (
        spark.table(observations_t)
        .where(F.col("source") == "twelvelabs")
        .select("media_id")
        .distinct()
    )
    before = elig.count()
    elig = elig.join(already_obs, on="media_id", how="left_anti")
    print(f"[enrich] skip already-observed={before - elig.count()} (force=false)")

candidates = elig.orderBy(F.col("updated_at").asc()).limit(max_items).collect()
print(f"[enrich] candidates={len(candidates)}")

raw_log_rows: list = []
obs_rows: list = []
stats = {"ready": 0, "failed": 0, "skipped": 0}

for row in candidates:
    mid = row.media_id
    cdn = (row.cdn_url or "").strip() if row.cdn_url else ""
    mtype = (row.media_type or "").strip().lower() if row.media_type else ""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    tl_asset_id = row.tl_asset_id
    tl_index = row.tl_index_id or (index_id or None)
    status = "failed"
    err_msg = None

    try:
        asset_id = tl_asset_id
        video_id = None

        indexed = find_indexed_video(mid, raw_log_rows)
        if indexed:
            video_id = indexed.get("video_id")
            if indexed.get("asset_id"):
                asset_id = indexed["asset_id"]
            tl_index = index_id or tl_index
            print(f"[enrich] {mid}: found in index video_id={video_id} asset_id={asset_id}")

        if not asset_id and not video_id:
            if not cdn:
                status = "skipped"
                raise RuntimeError("no cdn_url and not found in TWELVELABS_INDEX_ID")
            print(f"[enrich] {mid}: creating asset from cdn_url")
            asset_id = create_asset_from_url(mid, cdn, raw_log_rows)

        if mtype == "image":
            if not asset_id:
                raise RuntimeError("image enrich requires asset_id")
            data = analyze_image(mid, asset_id, raw_log_rows)
        else:
            data = analyze_video(mid, asset_id, video_id, raw_log_rows)

        parsed, dropped = parse_observations(data, mid, now)
        if dropped:
            print(f"[enrich] {mid}: dropped {dropped} malformed observation(s)")
        if not parsed:
            raise RuntimeError("Pegasus returned zero usable observations")

        # Replace prior TL observations for this media (idempotent re-enrich)
        spark.sql(
            f"""
            DELETE FROM {observations_t}
            WHERE media_id = {sql_str(mid)} AND source = 'twelvelabs'
            """
        )
        obs_rows.extend(parsed)
        tl_asset_id = asset_id
        status = "ready"
        print(f"[enrich] {mid}: ready observations={len(parsed)}")
    except Exception as e:
        err_msg = str(e)
        if status != "skipped":
            status = "failed"
        print(f"[enrich] {mid}: {status} — {err_msg}")
        log_raw(
            raw_log_rows,
            mid,
            "enrich_error",
            {"cdn_url": cdn, "media_type": mtype},
            {"error": err_msg},
            None,
        )

    sets = [
        f"tl_status = {sql_str(status)}",
        "updated_at = current_timestamp()",
        f"tl_asset_id = {sql_str(tl_asset_id)}" if tl_asset_id else "tl_asset_id = NULL",
        f"tl_index_id = {sql_str(tl_index)}" if tl_index else "tl_index_id = NULL",
    ]
    spark.sql(f"UPDATE {eligible_t} SET {', '.join(sets)} WHERE media_id = {sql_str(mid)}")
    stats[status] = stats.get(status, 0) + 1

# COMMAND ----------

if obs_rows:
    spark.createDataFrame(obs_rows, schema=OBS_SCHEMA).write.mode("append").saveAsTable(observations_t)
    print(f"[enrich] appended {len(obs_rows)} → {observations_t}")
else:
    print("[enrich] no observations to write")

if raw_log_rows:
    spark.createDataFrame(raw_log_rows, schema=RAW_SCHEMA).write.mode("append").saveAsTable(tl_raw_t)
    print(f"[enrich] appended {len(raw_log_rows)} → {tl_raw_t}")
else:
    print("[enrich] no TL raw rows")

print(f"[enrich] done stats={stats}")
display(
    spark.table(eligible_t)
    .orderBy(F.col("updated_at").desc())
    .select("media_id", "tl_status", "tl_asset_id", "tl_index_id", "updated_at")
    .limit(30)
)
