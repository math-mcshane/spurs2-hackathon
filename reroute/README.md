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
