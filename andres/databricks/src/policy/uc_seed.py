"""MERGE local pack JSON files into UC rules.l1_policy_packs / l2_policy_packs."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .resolve import PACKS_DIR, load_all_local_packs


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def seed_packs_via_spark(spark: Any, catalog: str = "spurs2") -> list[str]:
    """Idempotent MERGE of pack files. Returns pack_ids seeded."""
    seeded: list[str] = []
    for pack in load_all_local_packs():
        pack_id = pack["pack_id"]
        version = pack["version"]
        layer = pack.get("layer") or ""
        name = pack.get("name") or pack_id
        description = pack.get("disclaimer") or ""
        rules_json = json.dumps(pack)
        dims = json.dumps({"uses": True, "regions": True, "layer": layer})
        now = _now().isoformat(sep=" ")

        if layer == "L1":
            table = f"{catalog}.rules.l1_policy_packs"
            spark.sql(
                f"""
                MERGE INTO {table} AS t
                USING (
                  SELECT
                    '{pack_id}' AS pack_id,
                    '{version}' AS version,
                    {json.dumps(name)} AS name,
                    {json.dumps(description)} AS description,
                    'active' AS status,
                    timestamp'2026-10-01 00:00:00' AS effective_from,
                    CAST(NULL AS TIMESTAMP) AS effective_to,
                    {json.dumps(rules_json)} AS rules_json,
                    timestamp'{now}' AS created_at,
                    'seed' AS created_by
                ) AS s
                ON t.pack_id = s.pack_id AND t.version = s.version
                WHEN MATCHED THEN UPDATE SET
                  t.name = s.name,
                  t.description = s.description,
                  t.status = s.status,
                  t.rules_json = s.rules_json
                WHEN NOT MATCHED THEN INSERT (
                  pack_id, version, name, description, status,
                  effective_from, effective_to, rules_json, created_at, created_by
                ) VALUES (
                  s.pack_id, s.version, s.name, s.description, s.status,
                  s.effective_from, s.effective_to, s.rules_json, s.created_at, s.created_by
                )
                """
            )
        else:
            table = f"{catalog}.rules.l2_policy_packs"
            spark.sql(
                f"""
                MERGE INTO {table} AS t
                USING (
                  SELECT
                    '{pack_id}' AS pack_id,
                    '{version}' AS version,
                    {json.dumps(name)} AS name,
                    {json.dumps(description)} AS description,
                    'active' AS status,
                    timestamp'2026-10-01 00:00:00' AS effective_from,
                    CAST(NULL AS TIMESTAMP) AS effective_to,
                    {json.dumps(dims)} AS dimensions_json,
                    {json.dumps(rules_json)} AS rules_json,
                    true AS demo_seed,
                    timestamp'{now}' AS created_at,
                    'seed' AS created_by
                ) AS s
                ON t.pack_id = s.pack_id AND t.version = s.version
                WHEN MATCHED THEN UPDATE SET
                  t.name = s.name,
                  t.description = s.description,
                  t.status = s.status,
                  t.rules_json = s.rules_json,
                  t.dimensions_json = s.dimensions_json,
                  t.demo_seed = s.demo_seed
                WHEN NOT MATCHED THEN INSERT (
                  pack_id, version, name, description, status,
                  effective_from, effective_to, dimensions_json, rules_json,
                  demo_seed, created_at, created_by
                ) VALUES (
                  s.pack_id, s.version, s.name, s.description, s.status,
                  s.effective_from, s.effective_to, s.dimensions_json, s.rules_json,
                  s.demo_seed, s.created_at, s.created_by
                )
                """
            )
        seeded.append(f"{pack_id}@{version}")
    return seeded


def resolve_active_l1(spark: Any, catalog: str = "spurs2") -> dict[str, Any] | None:
    """Latest L1 activation (company_id NULL)."""
    rows = spark.sql(
        f"""
        SELECT a.pack_id, a.version, p.rules_json
        FROM {catalog}.rules.policy_activations a
        JOIN {catalog}.rules.l1_policy_packs p
          ON a.pack_id = p.pack_id AND a.version = p.version
        WHERE a.layer = 'L1' AND a.company_id IS NULL
        ORDER BY a.activated_at DESC
        LIMIT 1
        """
    ).collect()
    if not rows:
        return None
    r = rows[0]
    try:
        return json.loads(r.rules_json)
    except Exception:
        return {"pack_id": r.pack_id, "version": r.version, "rules": []}


def resolve_active_l2_packs(
    spark: Any,
    club_code: str | None,
    catalog: str = "spurs2",
) -> list[dict[str, Any]]:
    """
    Latest activation per pack_id for catalog-default (NULL) + club company_id.
    Falls back to local JSON files when UC empty.
    """
    from .resolve import compose_pack_ids_for_club, load_pack_file

    club = (club_code or "").upper() or None
    wanted = compose_pack_ids_for_club(club)
    packs: list[dict[str, Any]] = []

    for pack_id in wanted:
        # Prefer club-specific activation, else catalog default
        q = f"""
        SELECT a.pack_id, a.version, p.rules_json, a.company_id, a.activated_at
        FROM {catalog}.rules.policy_activations a
        LEFT JOIN {catalog}.rules.l2_policy_packs p
          ON a.pack_id = p.pack_id AND a.version = p.version
        WHERE a.layer = 'L2' AND a.pack_id = '{pack_id}'
          AND (a.company_id IS NULL OR a.company_id = '{club or ""}')
        ORDER BY CASE WHEN a.company_id IS NOT NULL THEN 0 ELSE 1 END,
                 a.activated_at DESC
        LIMIT 1
        """
        try:
            rows = spark.sql(q).collect()
        except Exception:
            rows = []
        if rows and rows[0].rules_json:
            try:
                data = json.loads(rows[0].rules_json)
                # Advertiser stubs are partner metadata, not passport rules
                if data.get("rules"):
                    packs.append(data)
                continue
            except Exception:
                pass
        # Local file fallback
        path = PACKS_DIR / f"{pack_id}.json"
        if path.exists():
            packs.append(load_pack_file(pack_id))
    return packs
