-- spurs2.rules — versioned policy packs (DEMO / fictional for hackathon)

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
