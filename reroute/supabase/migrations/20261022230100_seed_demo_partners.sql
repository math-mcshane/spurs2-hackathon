-- DEMO seed: San Antonio Spurs + Tottenham Hotspur × Nike
-- FICTIONAL — not real club or Nike agreements. Paste after partners DDL migration.
-- Window covers "this weekend" relative to hackathon week (Oct 2026).

insert into public.partners (id, brand_slug, display_name, scoreplay_sponsor_label, demo)
values
  ('partner-nike', 'nike', 'Nike', 'Nike', true),
  ('partner-rival-demo', 'rival-sponsor', 'Rival Sponsor (DEMO)', 'Rival Sponsor', true)
on conflict (id) do update set
  brand_slug = excluded.brand_slug,
  display_name = excluded.display_name,
  scoreplay_sponsor_label = excluded.scoreplay_sponsor_label,
  demo = excluded.demo;

-- SAS × Nike — sponsored social FR/US through end of 2026
insert into public.partnership_agreements (
  id, partner_id, club_code, usage_allowed, territories, platforms,
  window_start, window_end, exclusivity_notes, demo
) values (
  'agree-sas-nike-2026',
  'partner-nike',
  'SAS',
  array['ORGANIC', 'SPONSORED'],
  array['FR', 'US'],
  array['instagram', 'youtube', 'x'],
  '2026-10-01T00:00:00Z',
  '2026-12-31T23:59:59Z',
  'FICTIONAL DEMO: Nike kit/lifestyle partner for Spurs club channels. Rival brand marks block SPONSORED posts.',
  true
)
on conflict (id) do update set
  partner_id = excluded.partner_id,
  club_code = excluded.club_code,
  usage_allowed = excluded.usage_allowed,
  territories = excluded.territories,
  platforms = excluded.platforms,
  window_start = excluded.window_start,
  window_end = excluded.window_end,
  exclusivity_notes = excluded.exclusivity_notes,
  demo = excluded.demo;

-- TOT × Nike — sponsored social GB/FR/US (demo kit story; not a real PL kit deal)
insert into public.partnership_agreements (
  id, partner_id, club_code, usage_allowed, territories, platforms,
  window_start, window_end, exclusivity_notes, demo
) values (
  'agree-tot-nike-2026',
  'partner-nike',
  'TOT',
  array['ORGANIC', 'SPONSORED'],
  array['GB', 'FR', 'US'],
  array['instagram', 'youtube', 'x', 'tiktok'],
  '2026-10-01T00:00:00Z',
  '2026-12-31T23:59:59Z',
  'FICTIONAL DEMO: Nike lifestyle partner for Tottenham club channels. Not a real Premier League kit agreement.',
  true
)
on conflict (id) do update set
  partner_id = excluded.partner_id,
  club_code = excluded.club_code,
  usage_allowed = excluded.usage_allowed,
  territories = excluded.territories,
  platforms = excluded.platforms,
  window_start = excluded.window_start,
  window_end = excluded.window_end,
  exclusivity_notes = excluded.exclusivity_notes,
  demo = excluded.demo;

-- Optional: seed a few eligible_media rows so Studio discover works before Databricks sync.
-- Replace media_id values with real ScorePlay ids from your inbound/backfill pool when known.
-- These rows are safe no-ops if sync overwrites them later.
insert into public.eligible_media (
  media_id, club_code, title, media_type, event_label, game_date,
  sponsors, brands_seen, tl_status, l1_passed_at, synced_at
) values
  (
    'demo-sas-nike-001',
    'SAS',
    'DEMO Spurs — Nike courtside (seed)',
    'image',
    'last_night_game',
    current_date - 1,
    array['Nike'],
    array['nike'],
    'ready',
    now(),
    now()
  ),
  (
    'demo-tot-nike-001',
    'TOT',
    'DEMO Tottenham — Nike lifestyle (seed)',
    'image',
    'last_night_game',
    current_date - 1,
    array['Nike'],
    array['nike'],
    'ready',
    now(),
    now()
  )
on conflict (media_id) do update set
  club_code = excluded.club_code,
  title = excluded.title,
  brands_seen = excluded.brands_seen,
  sponsors = excluded.sponsors,
  event_label = excluded.event_label,
  game_date = excluded.game_date,
  tl_status = excluded.tl_status,
  synced_at = now();

insert into public.evidence (
  observation_id, scoreplay_media_id, observation, source, label, label_type,
  confidence, origin, evidence_json, observed_at
) values
  (
    'seed-sas-nike-brand',
    'demo-sas-nike-001',
    'Nike: DEMO seed brand mark on kit/signage',
    'TWELVELABS',
    'brand:nike',
    'brand',
    0.9,
    'CACHED',
    '{"category":"sponsor_brand","entity":"Nike","origin":"CACHED","demo":true}'::jsonb,
    now()
  ),
  (
    'seed-tot-nike-brand',
    'demo-tot-nike-001',
    'Nike: DEMO seed brand mark on kit/signage',
    'TWELVELABS',
    'brand:nike',
    'brand',
    0.9,
    'CACHED',
    '{"category":"sponsor_brand","entity":"Nike","origin":"CACHED","demo":true}'::jsonb,
    now()
  )
on conflict (observation_id) do update set
  observation = excluded.observation,
  label = excluded.label,
  evidence_json = excluded.evidence_json,
  observed_at = excluded.observed_at;
