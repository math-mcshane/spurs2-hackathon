# Andres — REROUTE unified model pack

Working notes for the Spurs² **Rights & Compliance** track, aligning:

| Source | Role |
|--------|------|
| [REROUTE_TEAM_WORKFLOW.md](../REROUTE_TEAM_WORKFLOW.md) | Product: intent → verdict → reroute → receipt |
| [clear/](../clear/) | UGC / consent / CLEARED·REVIEW·BLOCKED prototype |
| [twelvelabs_sampleprompts/](../twelvelabs_sampleprompts/) | Observation questionnaires (NBA / PL) |
| ScorePlay + TwelveLabs | Media SoR + vision evidence (URL ingest) |

## Contents

| Path | What |
|------|------|
| [workbook/reroute-unified-workbook.html](./workbook/reroute-unified-workbook.html) | **Open in browser** — interactive CDM, journeys, workflows, UI map |
| [JOURNEY_SIMULATION.md](./JOURNEY_SIMULATION.md) | **Pitch / dry-run script** — step state, fixtures |
| [UI_JOURNEY_ENHANCEMENTS.md](./UI_JOURNEY_ENHANCEMENTS.md) | How to enhance Studio UI for journeys + intents |
| [UNIFIED_DATA_MODEL.md](./UNIFIED_DATA_MODEL.md) | Entity catalog + invariants |
| [CDM_PLATFORM_PLAN.md](./CDM_PLATFORM_PLAN.md) | **Supabase vs Unity Catalog** placement + DDL |
| [POLICY_ENGINE_PIPELINE.md](./POLICY_ENGINE_PIPELINE.md) | **Databricks policy track** — webhooks → L1 reject → L2 intent |
| [databricks/](./databricks/) | **Asset Bundle** — UC DDL + seed job + policy-engine pipeline job |
| [USER_JOURNEYS.md](./USER_JOURNEYS.md) | Personas and end-to-end journeys |
| [WORKFLOWS_AND_UI.md](./WORKFLOWS_AND_UI.md) | System workflows + app surfaces (spec only) |
| [schemas/unified-cdm.types.ts](./schemas/unified-cdm.types.ts) | Shared TypeScript contracts for the team |

## UI status

**No Next.js / app UI in this pack yet.** Document journeys and surfaces first; implement Studio later from `JOURNEY_SIMULATION.md` + `WORKFLOWS_AND_UI.md`.

Chat-side summary canvas (optional): `reroute-spurs2.canvas.tsx` in the Cursor canvases folder.

## Partner discover (SAS + TOT)

Studio searches Supabase `eligible_media` + DEMO `partnership_agreements` (Nike). Databricks syncs the L1-pass pool:

1. **You — Supabase SQL Editor** (order matters): see `../reroute/supabase/migrations/`  
   - `…230000_partners_eligible_media.sql`  
   - `…230100_seed_demo_partners.sql`  
2. **Databricks** (`databricks/`): `bundle deploy` + `bundle run -t dev policy_engine_pipeline`  
   - New task `sync_eligible_supabase` → upserts `eligible_media` + `evidence`  
3. **Studio** (`../reroute`): Partner discover → “Nike… last night… weekend” → fit badges → decide  

## Demo disclosures

All sample policies are **DEMO POLICY — NOT AN ACTUAL TEAM OR LEAGUE AGREEMENT**.  
`ALLOWED` means eligible under supplied demo packs, not legal clearance to publish.
