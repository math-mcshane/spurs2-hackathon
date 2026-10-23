# spurs2 — Databricks Asset Bundle (policy engine)

Catalog: **`spurs2`**. Aligned with [POLICY_ENGINE_PIPELINE.md](../POLICY_ENGINE_PIPELINE.md).

## Layout

| Path | Role |
|------|------|
| `databricks.yml` | Bundle + targets (`dev` / `prod`) |
| `sql/` | Unity Catalog DDL + activations (`00`–`10`, `99_all.sql`) |
| `src/policy/` | Passport IR engine + G/N/P/C/F pack JSON |
| `tests/` | Golden passport fixtures (no Spark) |
| `resources/seed.job.yml` | Seed job (empty placeholder) |
| `resources/policy_engine.job.yml` | Policy engine pipeline job |
| `src/seed/` | Seed notebooks |
| `src/pipeline/` | Pipeline notebooks |

## Jobs

### `seed` → workspace name `spurs2-seed`

No-op for now. Later: DEMO `rules.*` packs + fixture webhooks.

### `scoreplay_backfill` → `spurs2-scoreplay-backfill`

One-shot ScorePlay library → `bronze` (`event_type=backfill`). Run before a `run_mode=full` pipeline.

### `policy_engine_pipeline` → `spurs2-policy-engine-pipeline`

| Task | Notebook | What |
|------|----------|------|
| `ensure_ddl` | `00_ensure_ddl.py` | Apply SQL + MERGE passport packs into `rules.*` |
| `sync_supabase_webhooks` | `06_sync_supabase_webhooks.py` | Supabase events → bronze |
| `bronze_webhooks` | `01_bronze_webhooks.py` | Validate / report bronze volume |
| `silver_assets` | `02_silver_assets.py` | MERGE `silver.assets` from webhooks |
| `l1_preprocess` | `03_l1_preprocess.py` | Active L1 pack tokens → eligible / rejected |
| `sync_compliance_supabase` | `08_sync_compliance_to_supabase.py` | Rejected + L1 decisions + summary → Supabase |
| `enrich_eligible` | `04_enrich_eligible.py` | TwelveLabs → `silver.observations` |
| `sync_eligible_supabase` | `07_sync_eligible_to_supabase.py` | Upsert `eligible_media` + `evidence` |
| `sync_l2_requests_supabase` | `06b_sync_l2_requests_from_supabase.py` | Studio `l2_requests` → gold |
| `enqueue_l2` | `05a_enqueue_l2.py` | Queue passport L2 for eligible media |
| `l2_contextual` | `05_l2_contextual.py` | Rights Passport evaluate → `gold.l2_decisions` |
| `sync_passport_supabase` | `07b_sync_passport_to_supabase.py` | Upsert `media_passports` + `l2_decisions` |
| `sync_triage_supabase` | `09_sync_triage_from_supabase.py` | Studio triage patches → UC rejected |

Job params: `catalog`, `lookback_hours` (default `24`), `run_mode` (`incremental`\|`full`), `force` (`true`\|`false`), `media_id`, `enrich_max_items` (default `10`), `enrich_force`, `twelvelabs_index_id` (optional override).

**Enrich:** For each eligible row with `tl_status` in `pending`/`skipped`/`failed` (or `ready` when `enrich_force=true`): look up ScorePlay id in `TWELVELABS_INDEX_ID` via `user_metadata`, else `POST /assets` from `cdn_url`, then sync Pegasus analyze (same rubric as REROUTE). Writes `bronze.tl_api_raw` + replaces prior `source=twelvelabs` rows in `silver.observations`. Sets `tl_status` to `ready` \| `failed` \| `skipped` (no URL / not in index).

Compliance views: `gold.compliance_rejected`, `gold.compliance_eligible`, `gold.compliance_summary`.

Full-catalog bootstrap:

```bash
databricks bundle run -t dev scoreplay_backfill
databricks bundle run -t dev policy_engine_pipeline --params run_mode=full
```

## Auth / deploy

Use the [Databricks CLI](https://docs.databricks.com/dev-tools/cli/index.html). Prefer env vars (do **not** commit tokens):

```text
DATABRICKS_HOST=https://adb-….azuredatabricks.net
DATABRICKS_TOKEN=dapi…
```

### Secret scope `spurs2-hackathon`

Policy-engine secrets live in Databricks scope **`spurs2-hackathon`** (workspace users: READ).  
Re-upload from `andres/.env` (never commit that file):

```powershell
cd andres/databricks
powershell -ExecutionPolicy Bypass -File scripts/upload-hackathon-secrets.ps1
```

Keys: `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `SCOREPLAY_API_KEY`, `TWELVELABS_API_KEY`, `TWELVELABS_INDEX_ID` (optional — organizer index for custom_id lookup), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_URL`, `SCOREPLAY_WEBHOOK_SECRET`.

Add `TWELVELABS_INDEX_ID=` to `andres/.env` when organizers share it, then re-run the upload script.

```python
dbutils.secrets.get(scope="spurs2-hackathon", key="SCOREPLAY_API_KEY")
```

CLI expects `DATABRICKS_HOST` + `DATABRICKS_TOKEN` (or a working `databricks auth login` profile).  
`databricks.yml` uses `profile: DEFAULT` — switch to `rob-andres` if that’s your active profile.

```bash
cd andres/databricks
databricks auth login --host https://adb-4090431820227854.14.azuredatabricks.net
databricks bundle validate -t dev
databricks bundle deploy -t dev
databricks bundle run -t dev seed
databricks bundle run -t dev policy_engine_pipeline
```

Pipeline is safe on empty bronze (creates tables, zero merges). L1/L2 packs are **DEMO** until seed is implemented.

## Conventions

- Delta UC managed tables; append-only bronze webhooks + gold decisions.  
- L1: `AUTO_REJECT` \| `PASS_L1` · L2: `ALLOWED` \| `BLOCKED` \| `NEEDS_REVIEW`  
- Missing coverage → review, never silent allow.  
