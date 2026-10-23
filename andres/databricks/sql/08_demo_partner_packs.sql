-- DEMO L2 advertiser packs (Nike × SAS / TOT) — fictional; app also ships JSON packs

MERGE INTO spurs2.rules.l2_policy_packs AS t
USING (
  SELECT * FROM VALUES
    (
      'l2-advertiser-nike-sas',
      '0.1.0',
      'DEMO Nike advertiser — San Antonio Spurs',
      'FICTIONAL: Nike partner window for SAS club channels',
      'active',
      timestamp'2026-10-01 00:00:00',
      timestamp'2026-12-31 23:59:59',
      '{"dimensions":["sponsor","usage","territory","platform","expiry"]}',
      '{"partner":"nike","club":"SAS","usage":["ORGANIC","SPONSORED"],"territories":["FR","US"]}',
      true,
      current_timestamp(),
      'seed'
    ),
    (
      'l2-advertiser-nike-tot',
      '0.1.0',
      'DEMO Nike advertiser — Tottenham Hotspur',
      'FICTIONAL: Nike partner window for TOT club channels',
      'active',
      timestamp'2026-10-01 00:00:00',
      timestamp'2026-12-31 23:59:59',
      '{"dimensions":["sponsor","usage","territory","platform","expiry"]}',
      '{"partner":"nike","club":"TOT","usage":["ORGANIC","SPONSORED"],"territories":["GB","FR","US"]}',
      true,
      current_timestamp(),
      'seed'
    )
  AS v(
    pack_id, version, name, description, status, effective_from, effective_to,
    dimensions_json, rules_json, demo_seed, created_at, created_by
  )
) AS s
ON t.pack_id = s.pack_id AND t.version = s.version
WHEN MATCHED THEN UPDATE SET
  t.name = s.name,
  t.description = s.description,
  t.status = s.status,
  t.rules_json = s.rules_json,
  t.dimensions_json = s.dimensions_json,
  t.demo_seed = s.demo_seed
WHEN NOT MATCHED THEN INSERT *;
