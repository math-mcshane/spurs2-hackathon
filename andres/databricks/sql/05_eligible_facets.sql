-- Add partner-discovery facets to existing eligible_artifacts (idempotent via ensure_ddl tolerance)

ALTER TABLE spurs2.silver.eligible_artifacts ADD COLUMNS (
  club_code STRING COMMENT 'SAS | TOT when known',
  event_label STRING COMMENT 'e.g. last_night_game',
  game_date DATE,
  sponsors ARRAY<STRING> COMMENT 'ScorePlay sponsor labels',
  brands_seen ARRAY<STRING> COMMENT 'TL brand slugs e.g. nike'
);
