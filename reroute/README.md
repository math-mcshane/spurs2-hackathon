# PULSE — rights-aware sports media campaigns

Spurs² Hackathon · Rights & Compliance. **From business objective to rights-aware campaign — and automatically to a
better alternative when something cannot be used.** Goal → Media → Campaign → Compliance → Resolution → Review: one
goal, three real moments, one campaign checked by PULSE's rights engine (REROUTE, this package) for every channel ×
territory, and a Media Compliance Recovery Engine that finds and re-checks the best way to use it anyway.
Architecture: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). Design: [`../docs/design/`](../docs/design/). Integration history: [`../INTEGRATION_LOG.md`](../INTEGRATION_LOG.md).

## Quick start

```bash
pnpm install
cp .env.example .env.local                 # fill ScorePlay + TwelveLabs keys, reviewer hashes + session secret
~/.local/bin/supabase start                # local Docker Supabase (prints URL + secret key)
~/.local/bin/supabase db reset             # applies supabase/migrations/*.sql in order
# .env.local: SUPABASE_URL=http://127.0.0.1:54321, SUPABASE_SECRET_KEY=<local secret key>
pnpm dev                                   # http://localhost:3000
pnpm test && pnpm typecheck && pnpm lint
```

Every variable is listed with its meaning and safe default in `.env.example`. Without ScorePlay/TwelveLabs keys the
integration routes return `503 NOT_CONFIGURED`; there are no mock adapters in the app.

## Product journey (`/`, the Studio)

1. **Goal** — free text + club, e.g. "Promote Tottenham merchandise to UK supporters". `objective-parser.ts` reads
   market / product / KPI; `goal-intents.ts` turns it into weighted visual questions.
2. **Three moments** — ScorePlay lists the club's videos; each question is a live TwelveLabs Marengo search in those
   videos; hits are linked back to ScorePlay assets by `MediaResolver` (filename + duration, unique both ways) with exact
   timestamps; `moment-ranking.ts` picks the top three distinct assets. Video previews are off unless
   `MEDIA_PREVIEW_ENABLED=true` (then only for a signed-in reviewer, resolved per request, never stored or downloaded);
   while off, no footage URL appears in any API response. Below the moments, up to three **ScorePlay photos** of the
   same club are suggested from metadata only (captions, person tags, event, orientation — never visually analysed,
   no image URL in any response), each with the rights engine's verdict for the planned uses (typically NEEDS_REVIEW
   for sales/sponsored posts: who and which brands appear can't be confirmed without analysis).
3. **Campaign** — localized Instagram / Facebook / X copy (e.g. es-MX for Mexico), cut, CTA, intents for every
   channel × territory. Each edit is a new campaign version. The CTA links only to a configured
   `PULSE_COMMERCE_DESTINATIONS` entry (e.g. `tottenham:tickets:*=https://…`) or a producer link on the club's site.
   Sponsor goals use usage SPONSORED. A partner the goal names ("Promote our partner AIA …") is the run's
   `targetSponsor` (carried to every intent; never a search term); PULSE never picks one ("Partner credit" stays MISSING).
   The KPI has no value: it reads "Sales attribution not connected." (jersey / merch / tickets / subscriptions),
   "Engagement measurement not connected." (engagement / followers), "Sponsor delivery tracking not connected."
   (sponsor goals) or "Business results not connected." (no product named).
4. **Rights check** — REROUTE `decideCampaign` evaluates every use under the run's rule package (Policy Center; the
   club's workspace default unless the run switched). ALLOWED / NEEDS_REVIEW / BLOCKED with reasons and evidence
   (ScorePlay facts, TwelveLabs observations from the product's Pegasus run and the recorded second run). A brand on
   screen is never a conflict by itself: the target sponsor a partner rule names is permitted, other brands get exactly
   the configured rule (e.g. THFC-13 exclusivity), and a target the rules don't describe (Kraken under
   `demo-tottenham-pl`) is NEEDS_REVIEW, never DENY/PERMIT. People named only by AI that ScorePlay tags can't confirm
   are unverified identifications (MISSING, a reviewer verifies), never a rights verdict.
5. **Recovery ("Find a way to use it")** — `lib/rights/recovery` localizes each restriction in time (every elementary
   interval between observation boundaries is evaluated for every use; ±0.5 s margin; minimum post 3 s or 40 %;
   pieces < 1 s dropped) and proposes TRIM (edit decision list, "Edit plan — not rendered"), SAFE_SECTION, REPLACE
   (Marengo moments mapped to ScorePlay), ADAPT_CAMPAIGN (licensed subset, e.g. "Limit to licensed markets: GB, US"),
   CHANGE_USAGE (flagged as changing the goal) and REQUEST_CLEARANCE. Every option is re-evaluated by the same engine
   (re-check counts: allowed · restricted · unresolved). Only an option whose re-check is ALLOWED for every use and keeps
   the goal is recommended; review-required candidates are listed as such, never as a fix ("No verified replacement
   available"); NOT_VIABLE / STILL_BLOCKED / NEXT_STEP options are never applicable. Applying one writes a new campaign version and re-evaluates it
   from scratch (before/after). A licence gap (no licensed market or channel, e.g. "Sell more Spurs jerseys in
   Mexico") offers only "Request additional usage rights" and the campaign cannot be submitted; PULSE never re-targets
   the goal to other countries. Switching the rule package (`setPolicy`) marks the verdict stale until re-checked.
6. **Review** — submit → a named reviewer signs in (Reviewer id + personal passcode) → approve/reject → receipt with
   every use, the reviewer's configured name and a hash-chained audit trail.
7. **Writeback** — ScorePlay writeback plan (dry run by default).

All bundled policies are fictional: verdicts show **DEMO POLICY — NOT VERIFIED LEGAL CLEARANCE** and `publishable`
stays false. Unknown never becomes ALLOWED; an AI observation is evidence about content, never a licence.

## Routes

| Route | What |
|---|---|
| `/` | Studio (the product journey above) |
| `/desk` | Advanced rights desk: asset search (competition + club prefilled from ScorePlay), segment decisions, **recovery panel** (Find a way to use it → Apply cut / Use this clip / Apply to intent, via `/api/recover`), receipts (previews only with `MEDIA_PREVIEW_ENABLED=true` + reviewer sign-in) |
| `/policies` | Policy Center: preset and uploaded rule packages (all DEMO), package detail, JSON upload + workspace default (signed-in reviewer) |
| `/pulse/board`, `/pulse/opportunity/[id]` | Fan-signal board with **SIMULATED** signals; 404 unless `PULSE_BOARD_ENABLED=true` |
| `/api/pulse/goal` | Studio actions: `run`, `select`, `draft`, `checkRights`, `findRecovery`, `applyRecovery`, `setPolicy`, `submitForReview`; `GET ?id=`. All but `run` need `expectedVersion` |
| `/api/recover` | Read-only recovery plan for any clip + cut + uses (`{ edit (1 segment), intents (1..21), packageId? }` → `{ recovery, media, notes, policy }`); nothing persisted; 10/min per IP |
| `/api/policies` | `GET` library + defaults; `POST` JSON upload (reviewer, ≤ 200 KB, forced DEMO, sha256 + uploader; PDF/DOCX/TXT/CSV → 422); `/select` workspace default; `/sample`; `/[id]` |
| `/api/{decide,access,assets}` | REROUTE engine |
| `/api/{receipts,observations,auth/session}` | Receipts, reviews, HUMAN observations, reviewer session |
| `/api/writeback` | `GET ?receiptId=` preview, `POST` plan/apply (reviewer-only) |
| `/api/render` | FFmpeg derivative; disabled unless `MEDIA_PROCESSING_APPROVED=true` (not available on Vercel) |

## Tests

- `pnpm test` — mocked unit/integration tests; repository tests use the local Supabase from `.env.local`
  (they refuse a non-local URL).
- `LIVE_SMOKE=1 pnpm exec vitest run` — adds read-only live ScorePlay/TwelveLabs checks (e.g. 58/58 SP↔TL links).
- `pnpm typecheck` runs `next typegen` first (Next route types).

## Scripts (read-only externally; never print secrets; never download media)

```bash
# Scenarios A–E end to end through the service layer (writes only to LOCAL Supabase; writeback printed as dry run).
# Pass scenario letters to run a subset, e.g. `… live-walkthrough.ts A B`.
pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/live-walkthrough.ts
pnpm exec tsx --env-file=.env.local scripts/scoreplay-smoke.ts spurs
pnpm exec tsx --env-file=.env.local scripts/twelvelabs-smoke.ts "celebration"
# Record demo replay (needs local Supabase): A merch, B global engagement, C Mexico, D tickets, E sponsor,
# F jerseys UK, G UK followers, H Spurs France (not indexed), I Solanke sponsor flagship, J Wembanyama × Ledger (Spurs,
# not indexed: whole clips ranked on ScorePlay tags) — incl. recovery searches
pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/record-demo-cache.ts [A … J]
```

**Demo replay:** `record-demo-cache.ts` records real, read-only TwelveLabs + ScorePlay responses into `demo-cache/`
(query strings stripped; meant to be committed) and re-verifies the recording in a fresh `DEMO_REPLAY=true` process
before replacing the directory. `DEMO_REPLAY=true` serves every read from those recordings (labeled CACHED with
`recordedAt`; a missing recording is an `UPSTREAM` error; previews unavailable). Without it the app is live and falls
back per call to a recording on network error, HTTP 429 or 5xx. `DEMO_CACHE_DIR` overrides the directory (tests only).

**Other clubs' indexes:** `PULSE_TWELVELABS_INDEX_ID_<CLUB>` + optional `PULSE_TWELVELABS_API_KEY_<CLUB>` (for an
index in another TwelveLabs account; falls back to `TWELVELABS_API_KEY`).

### Public integration probes

Hit these after deploy (add Vercel protection bypass query if Deployment Protection is on):

| Endpoint | Checks |
|---|---|
| `GET /api/test` | Catalog + env flags; `?run=1` runs all probes |
| `GET /api/test/scoreplay` | ScorePlay `whoami` |
| `GET /api/test/twelvelabs` | Index describe |
| `GET /api/test/supabase` | CDM table counts |
| `GET /api/test/databricks` | Job id + latest run (read-only) |
| `GET /api/test/cdm` | Funnel: inbound → eligible → evidence → discover |

CDM mirror reads (match Databricks `sync_eligible_supabase` outputs):

| Endpoint | Source |
|---|---|
| `GET /api/eligible?club=SAS` | `eligible_media` |
| `GET /api/partners?club=TOT` | `partners` + `partnership_agreements` |
| `GET /api/evidence?mediaId=` | `evidence` |
| `GET /api/discover?q=Nike&club=SAS` | partner-aware ranking |
| `GET /api/passport?mediaId=` | Rights Passport 7×3 grid (Supabase mirror) |
| `POST /api/l2/enqueue` | `{ "mediaId" }` → Databricks pipeline + L2 passport |

Paste `supabase/migrations/20261022240000_media_passports.sql` after the partner migrations for passport sync.

Optional: set `REROUTE_TEST_SECRET` and pass `Authorization: Bearer …` (or `?token=`) to lock `/api/test/*`.

## Storage (Supabase)

Migrations in `supabase/migrations/` (apply in filename order): `…190000_reroute_store` (receipts, reviews,
observations), `…200000_reroute_workflow` (goal runs, campaigns + versions, evaluations, alternatives, append-only
hash-chained events, writeback attempts, observation cache), `…210000_reroute_campaign_receipt_version`,
`20261023000000_reroute_policy_packages` (uploaded rule packages + per-club workspace default; without it uploads and
the workspace default answer `NOT_CONFIGURED`, presets still work), plus CDM / webhook tables
(`…210000_scoreplay_webhook_events`, `…220000_twelvelabs_evidence`, `…230000_partners_eligible_media`,
`…240000_media_passports`, `…250000_cdm_studio_ops`). Apply with `pnpm db:migrate` when using the remote project.
All app tables are RLS on, no `anon`/`authenticated` grants; access is server-only with the secret key.
Only ids, timestamps, decisions and evidence text are stored — never media or preview URLs.

## Deploy (Vercel)

- Root directory `reroute`, framework Next.js. Set env vars per deployment (deploy-time env or project env);
  **never commit `.env*`** files.
- Keep `SCOREPLAY_WRITEBACK_MODE=dry-run`, `MEDIA_PROCESSING_APPROVED=false`, `SCOREPLAY_UPLOAD_APPROVED=false`,
  `PULSE_BOARD_ENABLED=false`, `MEDIA_PREVIEW_ENABLED` unset/false until playback rights are confirmed.
- Also set `SCOREPLAY_WEBHOOK_SECRET`, `DATABRICKS_HOST` / `DATABRICKS_TOKEN` / `DATABRICKS_COMPLIANCE_JOB_ID`
  (optional `DATABRICKS_WAREHOUSE_ID`) for inbound media → policy pipeline.
- Reviewers: `pnpm exec tsx scripts/reviewer-credentials.ts <id>="<Display Name>" …` prints `REROUTE_REVIEWERS`
  (scrypt hashes only) and writes the personal passcodes to the gitignored `reroute/.reviewers.local.txt` (mode 600)
  for out-of-band handover. Plus a ≥ 32-char `REROUTE_SESSION_SECRET`. Never put passcodes in env files or docs.
- Per-IP API rate limits (`src/lib/server/rate-limit.ts`) are in memory per instance — best-effort on serverless.
  Recommended: Vercel Deployment Protection and a Firewall rate-limit rule on `/api/*`.
  **ScorePlay webhooks:** exclude `/api/webhooks/scoreplay/*` from protection, or append
  `?x-vercel-protection-bypass=<VERCEL_AUTOMATION_BYPASS_SECRET>` to the webhook URLs in ScorePlay.
- Demo replay reads the committed `demo-cache/` (set `DEMO_REPLAY=true` for a network-independent demo); FFmpeg
  render is unavailable on Vercel.

### ScorePlay webhook URLs (production)

| ScorePlay event | Endpoint |
|---|---|
| `media.create` | `https://spurs2-hackathon.vercel.app/api/webhooks/scoreplay/media-create` |
| `media.update` | `https://spurs2-hackathon.vercel.app/api/webhooks/scoreplay/media-update` |

Auth in ScorePlay: Bearer / Basic / custom header with `SCOREPLAY_WEBHOOK_SECRET`.  
`GET` on either path returns the config JSON. `POST` appends to `.data/webhooks.json` (ephemeral on Vercel `/tmp`), upserts **Supabase** tables `scoreplay_webhook_events` + `scoreplay_inbound_media`, optionally re-fetches the media via ScorePlay API, then calls Databricks `jobs/run-now` for `DATABRICKS_COMPLIANCE_JOB_ID` with `media_id` (and `force=true` on updates). Job trigger failures are reported in the JSON body and do **not** fail the webhook.

Browse inbound files: Supabase Table Editor → `scoreplay_inbound_media`, or `GET /api/webhooks/scoreplay/inbound`.

### Supabase migrations (SQL Editor)

CLI migrate is optional — paste each file in **Supabase → SQL Editor → Run**, in order:

1. `supabase/migrations/20261022210000_scoreplay_webhook_events.sql` — webhook landings  
2. `supabase/migrations/20261022220000_twelvelabs_evidence.sql` — `evidence` + `tl_*` on inbound  
3. `supabase/migrations/20261022230000_partners_eligible_media.sql` — partners, agreements, `eligible_media`  
4. `supabase/migrations/20261022230100_seed_demo_partners.sql` — **DEMO** SAS/TOT × Nike (+ seed eligible rows)  
5. `supabase/migrations/20261022240000_media_passports.sql` — L2 passport mirror  
6. `supabase/migrations/20261022250000_cdm_studio_ops.sql` — receipts, compliance mirrors, L2 request staging

All partnership rows are **FICTIONAL DEMO** — not real club or Nike contracts.

### Partner discover demo (Studio)

1. Run the four SQL files above.  
2. Deploy/run Databricks `policy_engine_pipeline` (enrich + `sync_eligible_supabase`) so real L1-pass media upsert into `eligible_media` (seed rows work without this).  
3. `pnpm dev` → **Partner discover** mode → club **SAS** or **TOT**.  
4. Query: `Nike partner photos from last night we can post this weekend`.  
5. Select a `partner_safe` card → intent presets Nike + weekend → **Decide**.

API: `GET /api/discover?q=...&club=SAS`.

With Supabase configured, **receipts / reviews / HUMAN evidence** persist in Postgres (CDM SoR).
Without Supabase, those fall back to `.data/store.json` (ephemeral on Vercel `/tmp`).
TwelveLabs cache and FFmpeg renders still use local/tmp; FFmpeg stays disabled on Vercel.

## Layout

| Path | Role |
|---|---|
| `src/lib/contracts.ts` | Shared types, Zod schemas, API request/response contracts |
| `src/lib/rights/` | Deterministic policy engine + fictional demo policies (`policies/*.json`) |
| `src/lib/scoreplay/` | ScorePlay client, asset mapping, writeback taxonomy (`API_NOTES.md`) |
| `src/lib/twelvelabs/` | Marengo search, Pegasus observations, record/replay cache (`API_NOTES.md`) |
| `src/lib/server/` | Decision context, resolver, store (Supabase SoR / `.data/` fallback), FFmpeg render |
| `src/app/api/` | `assets`, `discover`, `eligible`, `partners`, `evidence`, `compliance/*`, `rejected/*`, `lake/compliance`, `decide`, `resolve`, `access`, `receipts`, `observations`, `writeback`, `render`, `policies`, `test/*`, `webhooks/scoreplay/*` |
| `src/lib/discover/` | NL parse + Supabase eligible/partner ranking |
| `src/components/reroute/` | One-screen producer UI |

## Invariants

- Explicit DENY → BLOCKED; unknown mandatory fact/permission or missing analysis → NEEDS_REVIEW; ALLOWED only when
  every dimension is affirmatively permitted. `canPublish()` is the only publication gate.
- A player's club is never asserted without ScorePlay identity; TwelveLabs `user_metadata` ids are never identity.
- Market/fan signals on the board are SIMULATED and labeled; no sales, conversion or ROI figure is ever computed.
