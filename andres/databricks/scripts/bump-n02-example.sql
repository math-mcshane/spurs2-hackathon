-- EXAMPLE (Wave 6): activate a new N-Spurs pack version without redeploying the app.
-- 1) Bump version in src/policy/packs/l2-passport-n-spurs.json and redeploy ensure_ddl (MERGE).
-- 2) Run this in SQL Editor to point SAS L2 at the new version.
-- 3) Re-run policy_engine_pipeline with force=true (or POST /api/l2/enqueue).
-- Not applied by ensure_ddl (lives under scripts/).

INSERT INTO spurs2.rules.policy_activations
  (activation_id, layer, pack_id, version, company_id, activated_at, activated_by, notes)
VALUES
  (uuid(), 'L2', 'l2-passport-n-spurs', '0.1.1', 'SAS', current_timestamp(), 'ops', 'bump N-02 max_duration demo');
