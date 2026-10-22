-- spurs2 policy-engine CDM — catalog + schemas
-- Databricks SQL / Unity Catalog

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
