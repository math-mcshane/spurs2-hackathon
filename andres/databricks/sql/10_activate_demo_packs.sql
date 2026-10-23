-- Activate DEMO policy packs (append-only; latest wins per layer+company_id+pack family).
-- company_id NULL = catalog-wide default. Club-specific L2 activations use SAS / TOT as company_id.
-- Note: Spark inline VALUES cannot evaluate uuid()/current_timestamp() — use literals.

DELETE FROM spurs2.rules.policy_activations
WHERE notes = 'wave1-demo-seed';

INSERT INTO spurs2.rules.policy_activations
  (activation_id, layer, pack_id, version, company_id, activated_at, activated_by, notes)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'L1', 'l1-safety-demo', '0.1.0', NULL, timestamp'2026-10-01 00:00:00', 'seed', 'wave1-demo-seed'),
  ('a1000000-0000-4000-8000-000000000002', 'L2', 'l2-passport-g-common', '0.1.0', NULL, timestamp'2026-10-01 00:00:00', 'seed', 'wave1-demo-seed'),
  ('a1000000-0000-4000-8000-000000000003', 'L2', 'l2-passport-c-club', '0.1.0', NULL, timestamp'2026-10-01 00:00:00', 'seed', 'wave1-demo-seed'),
  ('a1000000-0000-4000-8000-000000000004', 'L2', 'l2-passport-f-fan', '0.1.0', NULL, timestamp'2026-10-01 00:00:00', 'seed', 'wave1-demo-seed'),
  ('a1000000-0000-4000-8000-000000000005', 'L2', 'l2-passport-n-spurs', '0.1.0', 'SAS', timestamp'2026-10-01 00:00:00', 'seed', 'wave1-demo-seed'),
  ('a1000000-0000-4000-8000-000000000006', 'L2', 'l2-advertiser-nike-sas', '0.1.0', 'SAS', timestamp'2026-10-01 00:00:00', 'seed', 'wave1-demo-seed'),
  ('a1000000-0000-4000-8000-000000000007', 'L2', 'l2-passport-p-tottenham', '0.1.0', 'TOT', timestamp'2026-10-01 00:00:00', 'seed', 'wave1-demo-seed'),
  ('a1000000-0000-4000-8000-000000000008', 'L2', 'l2-advertiser-nike-tot', '0.1.0', 'TOT', timestamp'2026-10-01 00:00:00', 'seed', 'wave1-demo-seed');
