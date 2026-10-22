-- spurs2.bronze — append-only landings

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
