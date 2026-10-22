# REROUTE — Every clip, cleared

Spurs² Hackathon · Rights & Compliance. Spec: `REROUTE_TECHNICAL_SPEC_V1.1.md`.

## Run

```bash
pnpm install
cp .env.example .env.local   # fill ScorePlay + TwelveLabs keys
pnpm dev
pnpm test && pnpm typecheck && pnpm lint
```

Smoke the integrations once keys are set:

```bash
pnpm exec tsx --env-file=.env.local scripts/scoreplay-smoke.ts spurs
pnpm exec tsx --env-file=.env.local scripts/scoreplay-smoke.ts --writeback <assetId>
pnpm exec tsx --env-file=.env.local scripts/twelvelabs-smoke.ts "dunk"
pnpm exec tsx --env-file=.env.local scripts/twelvelabs-smoke.ts --observe <scoreplayMediaId>
```

Without keys every integration route returns `503 NOT_CONFIGURED`; there are no mock adapters.

## Deploy on Vercel

Import `math-mcshane/spurs2-hackathon` as a Vercel project, then:

1. **Root Directory:** `reroute` (framework preset Next.js; pnpm is detected from the lockfile).
2. **Environment variables** (Production + Preview), values from a teammate's `.env.local`, never from git:
   `SCOREPLAY_API_KEY`, `TWELVELABS_API_KEY`, `TWELVELABS_INDEX_ID` (once organizers share it),
   `REROUTE_POLICY_ID=demo-spurs-fr-sponsored`, `MEDIA_PROCESSING_APPROVED=false`, `SCOREPLAY_UPLOAD_APPROVED=false`.
3. **Deployment Protection:** enable Vercel Authentication for **all deployments, including Production**
   (Settings → Deployment Protection). The app displays ScorePlay event media, which must not be public (spec §9).
4. Invite teammates to the Vercel team so they can pass the protection.

On Vercel, local state (receipts, reviews, HUMAN observations, TwelveLabs cache) lives in `/tmp`: per-instance and
ephemeral. Fine for a single-user demo; use a shared store (e.g. Upstash Redis) if receipts must survive cold starts.
FFmpeg rendering is not available there and stays disabled.

## Layout

| Path | Role |
|---|---|
| `src/lib/contracts.ts` | Shared types, Zod schemas, API request/response contracts |
| `src/lib/rights/` | Deterministic policy engine + fictional demo policies (`policies/*.json`) |
| `src/lib/scoreplay/` | ScorePlay client, asset mapping, writeback taxonomy (`API_NOTES.md`) |
| `src/lib/twelvelabs/` | Marengo search, Pegasus observations, record/replay cache (`API_NOTES.md`) |
| `src/lib/server/` | Decision context, resolver, JSON store (`.data/`), FFmpeg render |
| `src/app/api/` | `assets`, `decide`, `resolve`, `access`, `receipts`, `observations`, `writeback`, `render`, `policies` |
| `src/components/reroute/` | One-screen producer UI |
| `src/features/pulse/` | PULSE (optional, flag-gated): signals, opportunity scoring, REROUTE handoff, business metrics |

## Invariants

- Explicit DENY → `BLOCKED`; unknown mandatory fact/permission or missing video analysis → `NEEDS_REVIEW`; `ALLOWED` only when all 7 dimensions are affirmatively permitted.
- An edit is judged across every segment; REROUTE alternatives are derived edits needing their own decision and human review.
- The access gate is app-level and re-evaluates server-side; it does not change ScorePlay ACLs.
- `MEDIA_PROCESSING_APPROVED` / `SCOREPLAY_UPLOAD_APPROVED` stay `false` until organizers / ScorePlay staff confirm.
- Demo policies are fictional and labeled as such in the UI, receipts and ScorePlay tags.

## PULSE (optional module)

Goal-to-action on top of REROUTE: **one goal → three real moments → one campaign proposal**, rights-checked by
REROUTE, with a “Find another way” recovery when REROUTE blocks or sends a moment to review. The earlier fan-signal
opportunity board (simulated signals, sponsor briefs, metrics) stays available at `/pulse/board`.

```env
PULSE_ENABLED=false          # missing = false; only the exact string "true" enables it
PULSE_SIGNAL_SOURCE=fixture  # board only: fixture (labeled SIMULATED demo replay) | manual (producer triggers only)
PULSE_VIDEO_PREVIEW=on       # "off" hides in-app players if organizers do not permit embedding streams
PULSE_TWELVELABS_INDEX_ID_TOTTENHAM=   # optional per-club index; default TWELVELABS_INDEX_ID
PULSE_TWELVELABS_INDEX_ID_SPURS=       # set when the Spurs (NBA) index becomes accessible — no code change needed
```

- **Off:** `/pulse`, `/pulse/board`, `/pulse/opportunity/*` and every `/api/pulse/*` return 404 (server-side check),
  no nav link, no ScorePlay/TwelveLabs calls, no PULSE state written. REROUTE renders and behaves exactly as before.
  Pages read the flag at build time (`next build` after changing it); API routes read it per request.
- **On:** `/pulse` campaign studio (guided flow), `/pulse/board` signal board, `/pulse/opportunity/[id]` detail;
  APIs `GET|POST /api/pulse/goal`, `GET|POST /api/pulse/opportunities`, `POST /api/pulse/refresh`,
  `POST /api/pulse/handoff`, `GET /api/pulse/business`.
- **Only REROUTE touchpoints:** a `PULSE` header link, and a deep link `/?pulse=&asset=&start=&end=&territory=…`
  that preloads the handed-off asset, cut and intent into the existing desk (ignored when PULSE is off).
- **No simulated data in the studio:** moments come live from ScorePlay + TwelveLabs; the simulated fan signals and
  fictional briefs are used only on the board. Goal runs (asset ids, timestamps, stream/thumbnail references and
  REROUTE verdicts — never media) are kept in `.data/pulse.json`, last 20 runs.

### Campaign studio (`/pulse`)

1. **Goal** — free text + club (`POST /api/pulse/goal {action:"run", goal, club}`). `objective-parser.ts` reads
   market / product / KPI; `goal-intents.ts` reads the named match and turns the product into 4–5 weighted visual
   questions (e.g. merchandise: player in the shirt, celebration, fans in club colours, players and fans together;
   engagement: goal, celebration, big chance, big save, atmosphere). Basketball wording exists for the Spurs.
2. **Opportunity** — `server/goal-search.ts`: ScorePlay lists the club's videos (team tag), each question is a live
   Marengo search restricted to those indexed videos, hits map back to ScorePlay assets (custom id, else exact filename
   + duration) with exact timestamps. `moment-ranking.ts`: overlapping hits are one moment; `score = (0.85 ×
   relevance + 0.15 × readiness) × context` where relevance rewards agreement across the goal's questions, readiness
   reflects 9:16 / short clips, and context is 0.6 for earlier-season footage when a match is named. The best moment
   of each distinct asset leads; the top three are shown with why-this-opportunity / why-this-media / what-to-do,
   and a preview of exactly that moment (ScorePlay proxy, else the TwelveLabs HLS stream; nothing is downloaded —
   otherwise asset metadata + where to watch it). Scores and search diagnostics are folded away.
3. **Campaign** — `goal-campaign.ts` (shares `composeCampaign` with the board): localized copy for Instagram /
   Facebook / X, creative angle, hook, CTA, club-approved destination (configured or entered), exact cut, and a
   readiness checklist (destination, inventory, rights, tracking, approval). Status: Proposed → Rights cleared →
   Ready for approval → Approved. Primary KPI is shown with no value until a verified source is connected; workflow
   time (goal submitted → proposal) is measured server-side.
- **Rights** (`checkRights`, `findAlternatives`, `approve`): every check calls REROUTE's `decideEdit` with the exact
  cut and the club's organic channel in the objective's market. `goal-view.ts` renders REROUTE's reasons in plain
  English with REROUTE's text verbatim. “Cleared” only for `ALLOWED` under a **non-fictional** policy; `ALLOWED` under
  a demo policy stays a proposal. Approval re-asks REROUTE and needs a real `ALLOWED` plus a destination.
- **Find another way:** keeps the goal, takes the next-best ranked moments (other assets first), has REROUTE evaluate
  each one independently, and groups them `ALLOWED` / `NEEDS_REVIEW` / `BLOCKED` / not checked. When every checked
  moment shares an open point, the UI says another clip will not fix it. “Use this instead” swaps the moment in the
  same draft.
- **Tottenham demo:** `PULSE_ENABLED=true REROUTE_POLICY_ID=demo-tottenham-pl pnpm build && … pnpm start`, open
  `/pulse`, run “Promote Tottenham merchandise to UK fans using the best moments from the Manchester United match.”,
  then “Maximize global engagement from the Manchester United match.” — different top three from the same 58 videos.
  Today REROUTE returns `NEEDS_REVIEW` for every moment (see dependencies), so the demo truthfully stays in review.
- **REROUTE dependencies for a real clearance** (PULSE side is complete; `decideEdit(edit, intent)` already evaluates
  each alternative independently):
  1. A non-fictional rights policy for Tottenham (only `demo-*` fictional policies exist).
  2. REROUTE video analysis for these assets: `getVideoIntelligence().observations(id)` looks up the index by
     `custom_id === <this workspace's ScorePlay id>`, but `premiere-league` stores ids from another workspace, so
     analysis is `FAILED` → sponsors/people unconfirmed → `NEEDS_REVIEW`. Needs the same filename + duration link
     PULSE uses (or a re-indexed custom id).
  3. People and sponsor metadata on the ScorePlay assets (currently “not recorded”).

### Signal board (`/pulse/board`)

- **Rights:** PULSE calls REROUTE's `decideEdit` on handoff, re-check, approve and publish; it records the verdict and
  never infers one. Approve/publish are refused unless REROUTE returns `ALLOWED`. Without REROUTE video analysis for
  an asset every verdict stays `NEEDS_REVIEW`, so approval cannot complete.
- **Media pipeline** (`server/scoreplay-discovery.ts` → `server/twelvelabs-moments.ts` → `server/media-lookup.ts`):
  1. ScorePlay finds real videos: topic `scoreplay.terms` → `GET /tag/search` (players / team tags) and
     `scoreplay.filenameHints` → `POST /media/search {name}`, always with `media_type: "video"`, paginated by
     `page`/`per_page`. Semantic phrases never go to the filename search (whole-word AND match).
  2. TwelveLabs Marengo (twelvelabs-js 1.3.6 `search.create`/`search.retrieve`) searches moments *inside* those
     videos via the documented filter `{"id": [...]}`; timestamps are kept exactly.
  3. Mapping TwelveLabs → ScorePlay: `user_metadata.scoreplay_id` when readable in this workspace, else exactly one
     indexed file with the same filename and duration (±1.5 s); anything ambiguous is not linked.
  4. Otherwise candidates are `SCOREPLAY_METADATA_FALLBACK` with the reason (`NOT_INDEXED`, `NO_MATCHING_MOMENT`,
     `UNAVAILABLE` + a TwelveLabs issue code). Nothing is ever simulated.
  - Config: `TWELVELABS_API_KEY` (legacy alias `TWELVE_LABS_API_KEY` accepted), `TWELVELABS_INDEX_ID`.
  - The hackathon index `premiere-league` (`6ad911d5500e82756f2eb468`, 58 Tottenham videos) stores `scoreplay_id`s
    from another ScorePlay workspace; all 58 link here by filename + duration. Spurs (NBA) videos are not indexed.
  - Live check (read-only, no secrets): `pnpm exec tsx --env-file=.env.local scripts/pulse-integration-diagnostics.ts`.
  - REROUTE's own analysis lookup still searches the index by this workspace's id, so it reports `FAILED` (→ `NEEDS_REVIEW`).
  - Don't run `next build` in this folder while `next dev` is running: the mixed `.next/` output makes the dev page
    reload in a loop (fix: stop dev, `rm -rf .next`, restart).
- **Data:** `src/features/pulse/fixtures/` — simulated posts and FICTIONAL sponsor briefs, labeled in the UI. State in
  `.data/pulse.json` (separate from REROUTE's `store.json`). Media is referenced by ScorePlay id/thumbnail only.
- **Money:** no revenue figure is ever computed. Fulfillment shows deliverable counts (plus an allocation of signed
  value only if a brief carries `allocatedPackageValue`); the savings and scenario calculators are labeled estimates.
- **Business objective → market opportunity:** type an objective on `/pulse/board` (e.g. “I want to increase jersey sales in
  Mexico.”; sent as `POST /api/pulse/refresh {objective}`, `null` clears it).
  - `objective-parser.ts`: deterministic EN/FR/ES rules → scope (one market, `GLOBAL`, or unspecified), product
    (incl. `engagement`), KPI, deadline and KPI measurement availability; unknown fields are listed as missing.
  - `market-signals.ts`: per topic × market (or `GLOBAL`), this week vs the 4-week usual level (lift, Poisson z),
    global volume share, share shift, confidence, “under the radar”. Data: `fixtures/market-signals.json`, SIMULATED
    counts; the market is the source-reported region, never inferred from language.
  - `objective-ranker.ts`: `0.45 market interest + 0.35 objective fit (content traits × product, same club) + 0.20
    ScorePlay media`; the rights gate still ranks first. The board shows the same footage ranked for “Sell jerseys in
    Mexico” and “Maximize global engagement” side by side (`comparison` in `GET /api/pulse/opportunities`).
  - KPI measurement: sales/ticketing are `NOT_CONNECTED`; engagement/followers are platform-native and not connected;
    PULSE never claims or predicts sales, conversions or engagement.
- **Campaign proposal** (opportunity detail page, `POST /api/pulse/opportunities {action:"draftCampaign"}`):
  `campaign-builder.ts` drafts objective, audience/market, selected ScorePlay asset + cut, why this media, Instagram /
  Facebook / X copy localized from the target market (EN/ES/FR; other languages flagged “not localized”), creative
  angle, CTA and KPI. The CTA links only to `PULSE_COMMERCE_DESTINATIONS` (`club:product:market=https://…;…`, market
  may be `*`) or a producer-entered https URL; otherwise “Commerce destination not configured” and no CTA line. Rights
  on the draft are REROUTE's recorded verdict for exactly that asset, cut and territory, else `NOT_CHECKED`. Send to
  REROUTE reuses the handoff; nothing is posted and no ads are bought.
  - Persistence: `server/campaign-repository.ts` (`get`/`save` port). Today a file adapter on `.data/pulse.json`;
    a Supabase adapter implements the same two methods (one `jsonb` row per opportunity, `schemaVersion: 1`).
- Not implemented: live public-social connector (Bluesky) and the optional Databricks job.
