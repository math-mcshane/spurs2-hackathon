# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Sync Studio triage patches → gold.rejected_artifacts
# MAGIC Reads `compliance_rejected` where `triage_dirty=true` and updates UC.

# COMMAND ----------

from datetime import datetime, timezone

import requests

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("secret_scope", "spurs2-hackathon")

catalog = dbutils.widgets.get("catalog")
secret_scope = dbutils.widgets.get("secret_scope")
rejected_t = f"{catalog}.gold.rejected_artifacts"

supabase_url = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_URL").rstrip("/")
supabase_key = dbutils.secrets.get(scope=secret_scope, key="SUPABASE_SECRET_KEY")

headers = {
    "apikey": supabase_key,
    "Authorization": f"Bearer {supabase_key}",
    "Accept": "application/json",
    "Content-Type": "application/json",
}

resp = requests.get(
    f"{supabase_url}/rest/v1/compliance_rejected",
    headers=headers,
    params={
        "select": "media_id,triage_status,triage_notes,reviewed_by,reviewed_at",
        "triage_dirty": "eq.true",
        "limit": "500",
    },
    timeout=60,
)
if resp.status_code >= 400:
    raise RuntimeError(f"Supabase HTTP {resp.status_code}: {resp.text[:500]}")

rows = resp.json()
print(f"[triage_sync] dirty_rows={len(rows)}")

cleared = []
for row in rows:
    mid = row.get("media_id")
    if not mid:
        continue
    status = (row.get("triage_status") or "new").replace("'", "\\'")
    notes = row.get("triage_notes")
    notes_sql = "NULL" if notes is None else "'" + str(notes).replace("'", "\\'") + "'"
    spark.sql(
        f"""
        UPDATE {rejected_t}
        SET
          triage_status = '{status}',
          triage_notes = {notes_sql},
          updated_at = current_timestamp()
        WHERE media_id = '{str(mid).replace("'", "\\'")}'
        """
    )
    cleared.append(mid)

# Clear dirty flags
for mid in cleared:
    patch = requests.patch(
        f"{supabase_url}/rest/v1/compliance_rejected",
        headers={**headers, "Prefer": "return=minimal"},
        params={"media_id": f"eq.{mid}"},
        json={"triage_dirty": False, "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")},
        timeout=30,
    )
    if patch.status_code >= 400:
        print(f"[triage_sync] clear dirty failed {mid}: {patch.status_code}")

print(f"[triage_sync] updated_uc={len(cleared)}")
