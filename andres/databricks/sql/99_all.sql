-- spurs2 policy-engine CDM — run entire DDL once
-- Prefer numbered scripts for incremental apply; this file is convenience only.

-- ========== 00_catalog_schemas ==========
CREATE CATALOG IF NOT EXISTS spurs2
COMMENT 'Spurs² hackathon — ScorePlay policy engine lakehouse';

CREATE SCHEMA IF NOT EXISTS spurs2.bronze
COMMENT 'Raw ScorePlay webhooks and TwelveLabs API payloads';

CREATE SCHEMA IF NOT EXISTS spurs2.silver
COMMENT 'Normalized assets, eligible pool, observations';

CREATE SCHEMA IF NOT EXISTS spurs2.gold
COMMENT 'L1/L2 decisions, reject triage, L2 requests';

CREATE SCHEMA IF NOT EXISTS spurs2.rules
COMMENT 'Versioned L1 safety packs and L2 contextual packs';

-- ========== 01_bronze ==========
CREATE TABLE IF NOT EXISTS spurs2.bronze.scoreplay_webhooks (
  event_id STRING COMMENT 'Idempotency key from ScorePlay when present; else hash of payload',
  event_type STRING COMMENT 'ingest | tag | transform | publish | archive | unknown',
  occurred_at TIMESTAMP COMMENT 'Event time from payload if available',
  received_at TIMESTAMP NOT NULL COMMENT 'Ingest wall clock (UTC)',
  company_id STRING COMMENT 'ScorePlay organization / company id',
  media_id STRING COMMENT 'ScorePlay media id when present on the event',
  payload STRING NOT NULL COMMENT 'Full webhook JSON body',
  headers_json STRING COMMENT 'Redacted request headers JSON',
  source_ip STRING,
  raw_path STRING COMMENT 'Autoloader / Volume path when landed as files'
)
USING DELTA
COMMENT 'All ScorePlay Connect webhooks — never filter at write time'
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

CREATE TABLE IF NOT EXISTS spurs2.bronze.tl_api_raw (
  request_id STRING NOT NULL,
  media_id STRING COMMENT 'ScorePlay media id (custom_id)',
  request_type STRING NOT NULL COMMENT 'asset_create | index | search | analyze | other',
  request_json STRING,
  response_json STRING,
  http_status INT,
  model_name STRING COMMENT 'marengo / pegasus version when known',
  received_at TIMESTAMP NOT NULL,
  job_run_id STRING
)
USING DELTA
COMMENT 'Raw TwelveLabs API request/response logs for audit and replay';

-- ========== 02_silver ==========
CREATE TABLE IF NOT EXISTS spurs2.silver.assets (
  media_id STRING NOT NULL COMMENT 'ScorePlay media id (PK)',
  company_id STRING,
  title STRING,
  description STRING,
  media_type STRING COMMENT 'video | image | audio | document | other',
  status STRING COMMENT 'ScorePlay lifecycle status if known',
  cdn_url STRING COMMENT 'Preferred delivery URL for TL ingest',
  thumbnail_url STRING,
  duration_sec DOUBLE,
  width INT,
  height INT,
  mime_type STRING,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  source_event_id STRING COMMENT 'Last webhook that refreshed this row',
  attrs_json STRING COMMENT 'Extra ScorePlay fields as JSON',
  ingested_at TIMESTAMP NOT NULL
)
USING DELTA
COMMENT 'Current ScorePlay media projection (upsert by media_id in jobs)'
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true'
);

CREATE TABLE IF NOT EXISTS spurs2.silver.eligible_artifacts (
  media_id STRING NOT NULL COMMENT 'PK — only rows that passed L1',
  company_id STRING,
  title STRING,
  media_type STRING,
  cdn_url STRING,
  duration_sec DOUBLE,
  l1_decision_id STRING NOT NULL COMMENT 'FK → gold.l1_decisions.decision_id',
  l1_passed_at TIMESTAMP NOT NULL,
  tl_asset_id STRING COMMENT 'TwelveLabs asset id after URL ingest',
  tl_index_id STRING,
  tl_status STRING COMMENT 'pending | ready | failed | skipped',
  attrs_json STRING,
  updated_at TIMESTAMP NOT NULL
)
USING DELTA
COMMENT 'Publish / search eligible pool — L1 AUTO_REJECT never lands here'
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true'
);

CREATE TABLE IF NOT EXISTS spurs2.silver.observations (
  observation_id STRING NOT NULL COMMENT 'UUID',
  media_id STRING NOT NULL,
  source STRING NOT NULL COMMENT 'scoreplay_tag | twelvelabs | manual | other',
  observed_at TIMESTAMP NOT NULL,
  label STRING COMMENT 'Entity or concept label',
  label_type STRING COMMENT 'person | brand | rival | sponsor | location | other',
  confidence DOUBLE,
  start_sec DOUBLE,
  end_sec DOUBLE,
  evidence_json STRING COMMENT 'Bounding boxes, quotes, TL hit payload',
  job_run_id STRING
)
USING DELTA
COMMENT 'Normalized detections used by L2 contextual packs';

-- ========== 03_gold ==========
CREATE TABLE IF NOT EXISTS spurs2.gold.l1_decisions (
  decision_id STRING NOT NULL COMMENT 'UUID',
  media_id STRING NOT NULL,
  company_id STRING,
  decided_at TIMESTAMP NOT NULL,
  verdict STRING NOT NULL COMMENT 'AUTO_REJECT | PASS_L1',
  policy_pack_id STRING NOT NULL,
  policy_version STRING NOT NULL,
  reason_codes ARRAY<STRING> COMMENT 'Machine codes e.g. L1_NSFW, L1_VIOLENCE',
  reason_summary STRING COMMENT 'Short human-readable summary',
  evidence_json STRING COMMENT 'Snippets / scores that fired',
  input_event_id STRING COMMENT 'bronze.scoreplay_webhooks.event_id',
  job_run_id STRING,
  model_name STRING COMMENT 'Optional classifier / TL model'
)
USING DELTA
COMMENT 'Append-only L1 safety gate outcomes';

CREATE TABLE IF NOT EXISTS spurs2.gold.rejected_artifacts (
  media_id STRING NOT NULL,
  company_id STRING,
  latest_decision_id STRING NOT NULL,
  verdict STRING NOT NULL COMMENT 'Always AUTO_REJECT for this table',
  first_rejected_at TIMESTAMP NOT NULL,
  last_rejected_at TIMESTAMP NOT NULL,
  reason_codes ARRAY<STRING>,
  reason_summary STRING,
  title STRING,
  media_type STRING,
  cdn_url STRING COMMENT 'May be present but must not enter eligible pool',
  triage_status STRING COMMENT 'new | acknowledged | appealed | closed',
  triage_notes STRING,
  updated_at TIMESTAMP NOT NULL
)
USING DELTA
COMMENT 'Ops / compliance reject triage — never mirrored into silver.eligible_artifacts';

CREATE TABLE IF NOT EXISTS spurs2.gold.l2_requests (
  request_id STRING NOT NULL COMMENT 'UUID — PublishIntent / review request',
  media_id STRING NOT NULL,
  company_id STRING,
  requested_at TIMESTAMP NOT NULL,
  channel STRING COMMENT 'social | ooh | broadcast | partner | other',
  territory STRING COMMENT 'ISO country or region code',
  window_start TIMESTAMP,
  window_end TIMESTAMP,
  intent_json STRING COMMENT 'Full PublishIntent / context payload',
  status STRING NOT NULL COMMENT 'queued | running | decided | failed',
  job_run_id STRING
)
USING DELTA
COMMENT 'Inbound L2 evaluation requests (from Studio or batch)';

CREATE TABLE IF NOT EXISTS spurs2.gold.l2_decisions (
  decision_id STRING NOT NULL COMMENT 'UUID',
  request_id STRING COMMENT 'FK → gold.l2_requests when applicable',
  media_id STRING NOT NULL,
  company_id STRING,
  decided_at TIMESTAMP NOT NULL,
  verdict STRING NOT NULL COMMENT 'ALLOWED | BLOCKED | NEEDS_REVIEW',
  policy_pack_id STRING NOT NULL,
  policy_version STRING NOT NULL,
  reason_codes ARRAY<STRING>,
  reason_summary STRING,
  dimensions_json STRING COMMENT 'Per-dimension ALLOW/BLOCK/REVIEW + evidence',
  observations_used ARRAY<STRING> COMMENT 'observation_id list',
  receipt_json STRING COMMENT 'REROUTE-style decision receipt for audit',
  job_run_id STRING
)
USING DELTA
COMMENT 'Append-only L2 contextual rights outcomes';

-- ========== 04_rules ==========
CREATE TABLE IF NOT EXISTS spurs2.rules.l1_policy_packs (
  pack_id STRING NOT NULL COMMENT 'e.g. l1-safety-v1',
  version STRING NOT NULL COMMENT 'Semver or date stamp',
  name STRING NOT NULL,
  description STRING,
  status STRING NOT NULL COMMENT 'draft | active | retired',
  effective_from TIMESTAMP NOT NULL,
  effective_to TIMESTAMP,
  rules_json STRING NOT NULL COMMENT 'Ordered L1 rules: code, severity, matcher, action',
  created_at TIMESTAMP NOT NULL,
  created_by STRING,
  CONSTRAINT pk_l1_packs PRIMARY KEY (pack_id, version) RELY
)
USING DELTA
COMMENT 'L1 AUTO_REJECT safety packs — no contextual rights';

CREATE TABLE IF NOT EXISTS spurs2.rules.l2_policy_packs (
  pack_id STRING NOT NULL COMMENT 'e.g. brand-rival-sponsor',
  version STRING NOT NULL,
  name STRING NOT NULL,
  description STRING,
  status STRING NOT NULL COMMENT 'draft | active | retired',
  effective_from TIMESTAMP NOT NULL,
  effective_to TIMESTAMP,
  dimensions_json STRING NOT NULL COMMENT 'Dimension defs: brand, rival, sponsor, territory, window',
  rules_json STRING NOT NULL COMMENT 'Contextual rules evaluated after L1 PASS',
  demo_seed BOOLEAN COMMENT 'True for hackathon fictional packs',
  created_at TIMESTAMP NOT NULL,
  created_by STRING,
  CONSTRAINT pk_l2_packs PRIMARY KEY (pack_id, version) RELY
)
USING DELTA
COMMENT 'L2 ALLOWED / BLOCKED / NEEDS_REVIEW packs';

CREATE TABLE IF NOT EXISTS spurs2.rules.policy_activations (
  activation_id STRING NOT NULL,
  layer STRING NOT NULL COMMENT 'L1 | L2',
  pack_id STRING NOT NULL,
  version STRING NOT NULL,
  company_id STRING COMMENT 'NULL = catalog-wide default',
  activated_at TIMESTAMP NOT NULL,
  activated_by STRING,
  notes STRING
)
USING DELTA
COMMENT 'Which pack version is live per company (append; latest wins in jobs)';
