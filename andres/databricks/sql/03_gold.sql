-- spurs2.gold — L1/L2 decisions + reject triage

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
