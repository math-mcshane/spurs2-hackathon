-- Persist Rights Passport grid on L2 decisions (Wave 3+)
ALTER TABLE spurs2.gold.l2_decisions
  ADD COLUMNS (
    passport_json STRING COMMENT '7x3 Rights Passport cells + rules_fired + usable_until'
  );
