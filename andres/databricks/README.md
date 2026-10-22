# spurs2 — Databricks Asset Bundle (policy engine)

Catalog: **`spurs2`**. Aligned with [POLICY_ENGINE_PIPELINE.md](../POLICY_ENGINE_PIPELINE.md).

## Layout

| Path | Role |
|------|------|
| `databricks.yml` | Bundle + targets (`dev` / `prod`) |
| `sql/` | Unity Catalog DDL (`00`–`04`, `99_all.sql`) |
| `resources/seed.job.yml` | Seed job (empty placeholder) |
| `resources/policy_engine.job.yml` | Policy engine pipeline job |
| `src/seed/` | Seed notebooks |
| `src/pipeline/` | Pipeline notebooks |

## Jobs

### `seed` → workspace name `spurs2-seed`

No-op for now. Later: DEMO `rules.*` packs + fixture webhooks.

### `policy_engine_pipeline` → `spurs2-policy-engine-pipeline`

| Task | Notebook | What |
|------|----------|------|
| `ensure_ddl` | `00_ensure_ddl.py` | Apply `sql/0*.sql` |
| `bronze_webhooks` | `01_bronze_webhooks.py` | Validate / report bronze volume |
| `silver_assets` | `02_silver_assets.py` | MERGE `silver.assets` from webhooks |
| `l1_preprocess` | `03_l1_preprocess.py` | DEMO L1 → decisions + eligible / rejected |
| `enrich_eligible` | `04_enrich_eligible.py` | Stub TL enrich (`pending` → `skipped`) |
| `l2_contextual` | `05_l2_contextual.py` | Queued L2 → `NEEDS_REVIEW` / not-eligible `BLOCKED` |

Job params: `catalog` (default `spurs2`), `lookback_hours` (default `24`).

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

Keys: `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `SCOREPLAY_API_KEY`, `TWELVELABS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_URL`, `SCOREPLAY_WEBHOOK_SECRET`.

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
