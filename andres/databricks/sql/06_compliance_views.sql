-- Compliance reporting views (read L1 outputs — no second write path)
-- PASS_L1 / eligible = downstream_ok for L2/Studio search, NOT publish clearance.

CREATE OR REPLACE VIEW spurs2.gold.compliance_rejected
COMMENT 'Rejected artifacts with reasons for compliance triage'
AS
SELECT
  r.media_id,
  r.company_id,
  r.title,
  r.media_type,
  r.cdn_url,
  r.verdict,
  r.reason_codes,
  r.reason_summary,
  r.triage_status,
  r.triage_notes,
  r.latest_decision_id,
  r.first_rejected_at,
  r.last_rejected_at,
  r.updated_at,
  d.policy_pack_id,
  d.policy_version,
  d.decided_at AS latest_decided_at,
  d.evidence_json,
  d.job_run_id
FROM spurs2.gold.rejected_artifacts r
LEFT JOIN spurs2.gold.l1_decisions d
  ON r.latest_decision_id = d.decision_id;

CREATE OR REPLACE VIEW spurs2.gold.compliance_eligible
COMMENT 'L1_PASS pool — safe for downstream L2/Studio retrieval (not publish clearance)'
AS
SELECT
  e.media_id,
  e.company_id,
  coalesce(e.title, a.title) AS title,
  coalesce(e.media_type, a.media_type) AS media_type,
  coalesce(e.cdn_url, a.cdn_url) AS cdn_url,
  a.thumbnail_url,
  e.duration_sec,
  e.club_code,
  e.event_label,
  e.game_date,
  e.sponsors,
  e.brands_seen,
  e.l1_decision_id,
  e.l1_passed_at,
  e.tl_status,
  e.tl_asset_id,
  e.updated_at,
  'L1_PASS' AS compliance_grade,
  true AS downstream_ok,
  d.policy_pack_id,
  d.policy_version,
  d.reason_codes,
  d.reason_summary
FROM spurs2.silver.eligible_artifacts e
LEFT JOIN spurs2.silver.assets a
  ON e.media_id = a.media_id
LEFT JOIN spurs2.gold.l1_decisions d
  ON e.l1_decision_id = d.decision_id;

CREATE OR REPLACE VIEW spurs2.gold.compliance_summary
COMMENT 'Rollup counts: rejected pool, eligible L1_PASS pool, and L1 verdicts'
AS
SELECT
  'rejected' AS bucket,
  cast(count(*) AS BIGINT) AS n_artifacts,
  max(last_rejected_at) AS as_of
FROM spurs2.gold.rejected_artifacts
UNION ALL
SELECT
  'eligible_l1_pass' AS bucket,
  cast(count(*) AS BIGINT) AS n_artifacts,
  max(l1_passed_at) AS as_of
FROM spurs2.silver.eligible_artifacts
UNION ALL
SELECT
  concat('l1_', lower(verdict)) AS bucket,
  cast(count(DISTINCT media_id) AS BIGINT) AS n_artifacts,
  max(decided_at) AS as_of
FROM spurs2.gold.l1_decisions
GROUP BY verdict;
