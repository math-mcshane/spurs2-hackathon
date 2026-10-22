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

## Invariants

- Explicit DENY → `BLOCKED`; unknown mandatory fact/permission or missing video analysis → `NEEDS_REVIEW`; `ALLOWED` only when all 7 dimensions are affirmatively permitted.
- An edit is judged across every segment; REROUTE alternatives are derived edits needing their own decision and human review.
- The access gate is app-level and re-evaluates server-side; it does not change ScorePlay ACLs.
- `MEDIA_PROCESSING_APPROVED` / `SCOREPLAY_UPLOAD_APPROVED` stay `false` until organizers / ScorePlay staff confirm.
- Demo policies are fictional and labeled as such in the UI, receipts and ScorePlay tags.
