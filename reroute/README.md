# PULSE × REROUTE — rights-aware sports media campaigns

Spurs² Hackathon · Rights & Compliance. **Turn business objectives into actionable, rights-aware sports media campaigns.**
One goal → three relevant real moments → one campaign checked by REROUTE for every channel × territory.
Architecture: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). Integration history: [`../INTEGRATION_LOG.md`](../INTEGRATION_LOG.md).

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
   while off, no footage URL appears in any API response.
3. **Campaign** — localized Instagram / Facebook / X copy (e.g. es-MX for Mexico), cut, CTA, intents for every
   channel × territory. Each edit is a new campaign version. The CTA links only to a configured
   `PULSE_COMMERCE_DESTINATIONS` entry (e.g. `tottenham:tickets:*=https://…`) or a producer link on the club's site.
   Sponsor goals use usage SPONSORED; PULSE never names a sponsor ("Partner credit" stays MISSING in the checklist).
   The KPI has no value: it reads "Sales attribution not connected." (jersey / merch / tickets / subscriptions),
   "Engagement measurement not connected." (engagement / followers), "Sponsor delivery tracking not connected."
   (sponsor goals) or "Business results not connected." (no product named).
4. **Rights check** — REROUTE `decideCampaign` selects the policy per asset + intent and evaluates every use.
   ALLOWED / NEEDS_REVIEW / BLOCKED with reasons and evidence (ScorePlay facts, TwelveLabs observations).
5. **Recovery** — a CLIP blocker offers "Find another way": alternatives that are each re-checked. A CAMPAIGN blocker
   offers a one-click remedy when a licensed subset exists ("Limit to licensed territories: GB, US") → new version →
   re-check. When none of the campaign's territories, or none of its channels, is licensed (e.g. "Sell more Spurs
   jerseys in Mexico": "No licensed path in Mexico (MX)") there is no remedy and the campaign cannot be submitted:
   the verdict stays NEEDS_REVIEW and `submitForReview` is refused with "No licence covers Mexico (MX) — request a
   licence before review." PULSE never re-targets the goal to other countries.
6. **Review** — submit → a named reviewer signs in (Reviewer id + personal passcode) → approve/reject → receipt with
   every use, the reviewer's configured name and a hash-chained audit trail.
7. **Writeback** — ScorePlay writeback plan (dry run by default).

All bundled policies are fictional: verdicts show **DEMO POLICY — NOT VERIFIED LEGAL CLEARANCE** and `publishable`
stays false. Unknown never becomes ALLOWED; an AI observation is evidence about content, never a licence.

## Routes

| Route | What |
|---|---|
| `/` | Studio (the product journey above) |
| `/desk` | Advanced rights desk: asset search, segment decisions, resolver, receipts (previews only with `MEDIA_PREVIEW_ENABLED=true` + reviewer sign-in) |
| `/pulse/board`, `/pulse/opportunity/[id]` | Fan-signal board with **SIMULATED** signals; 404 unless `PULSE_BOARD_ENABLED=true` |
| `/api/pulse/goal` | Studio actions: `run`, `select`, `draft`, `checkRights`, `findAlternatives`, `useAlternative`, `applyRemedy`, `submitForReview`; `GET ?id=`. All but `run` need `expectedVersion` |
| `/api/{decide,resolve,access,assets,policies}` | REROUTE engine |
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
# Record demo replay (needs local Supabase). A = UK merch, B = global engagement (MU game), C = Mexico jerseys
pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/record-demo-cache.ts [A B C]
```

**Demo replay:** `record-demo-cache.ts` records real, read-only TwelveLabs + ScorePlay responses into `demo-cache/`
(query strings stripped; meant to be committed) and re-verifies the recording in a fresh `DEMO_REPLAY=true` process
before replacing the directory. `DEMO_REPLAY=true` serves every read from those recordings (labeled CACHED with
`recordedAt`; a missing recording is an `UPSTREAM` error; previews unavailable). Without it the app is live and falls
back per call to a recording on network error, HTTP 429 or 5xx. `DEMO_CACHE_DIR` overrides the directory (tests only).

**Other clubs' indexes:** `PULSE_TWELVELABS_INDEX_ID_<CLUB>` + optional `PULSE_TWELVELABS_API_KEY_<CLUB>` (for an
index in another TwelveLabs account; falls back to `TWELVELABS_API_KEY`).

## Storage (Supabase)

Migrations in `supabase/migrations/` (apply in filename order): `…190000_reroute_store` (receipts, reviews,
observations), `…200000_reroute_workflow` (goal runs, campaigns + versions, evaluations, alternatives, append-only
hash-chained events, writeback attempts, observation cache), `…210000_reroute_campaign_receipt_version`.
All tables are `reroute_*`, RLS on, no `anon`/`authenticated` grants; access is server-only with the secret key.
Only ids, timestamps, decisions and evidence text are stored — never media or preview URLs.

## Deploy (Vercel)

- Root directory `reroute`, framework Next.js. Set env vars per deployment (deploy-time env or project env);
  **never commit `.env*`** files.
- Keep `SCOREPLAY_WRITEBACK_MODE=dry-run`, `MEDIA_PROCESSING_APPROVED=false`, `SCOREPLAY_UPLOAD_APPROVED=false`,
  `PULSE_BOARD_ENABLED=false`, `MEDIA_PREVIEW_ENABLED` unset/false until playback rights are confirmed.
- Reviewers: `pnpm exec tsx scripts/reviewer-credentials.ts <id>="<Display Name>" …` prints `REROUTE_REVIEWERS`
  (scrypt hashes only) and writes the personal passcodes to the gitignored `reroute/.reviewers.local.txt` (mode 600)
  for out-of-band handover. Plus a ≥ 32-char `REROUTE_SESSION_SECRET`. Never put passcodes in env files or docs.
- Per-IP API rate limits (`src/lib/server/rate-limit.ts`) are in memory per instance — best-effort on serverless.
  Recommended: Vercel Deployment Protection and a Firewall rate-limit rule on `/api/*`.
- Demo replay reads the committed `demo-cache/` (set `DEMO_REPLAY=true` for a network-independent demo); FFmpeg
  render is unavailable on Vercel.

## Invariants

- Explicit DENY → BLOCKED; unknown mandatory fact/permission or missing analysis → NEEDS_REVIEW; ALLOWED only when
  every dimension is affirmatively permitted. `canPublish()` is the only publication gate.
- A player's club is never asserted without ScorePlay identity; TwelveLabs `user_metadata` ids are never identity.
- Market/fan signals on the board are SIMULATED and labeled; no sales, conversion or ROI figure is ever computed.
