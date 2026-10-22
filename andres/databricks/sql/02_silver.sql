-- spurs2.silver — normalized assets + eligible pool + observations

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
