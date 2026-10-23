# PULSE × REROUTE integration log

Branch `hackathon-integration` (worktree `../hackathon-repo-integration`), based on `origin/main@1271e53`.
No remote push, no shared-main merge, no shared-Supabase migration without explicit approval.

## Preserved refs

| Ref | Commit | Content |
|---|---|---|
| `backup/origin-main-1271e53` | `1271e53` | Remote main at integration start (CLEAR schema, agreement generator, compliance flags, stories) |
| `backup/main-45dab7a` | `45dab7a` | Local main: 2 unpushed REROUTE Supabase commits (`c8444e9`, `45dab7a`) |
| `backup/pulse-local-a994a65` | `a994a65` | PULSE work, previously uncommitted, committed on `pulse-local` after a secrets/footage check |

`main` and `pulse-local` were left at their own heads. The `merlin` remote (a fork with an unrelated root) was fetched only.
`score_play_api_doc.json` stays untracked in the main checkout; it is a vendor doc used as reference.

## Integration steps

1. `git worktree add -b hackathon-integration ../hackathon-repo-integration origin/main` (upstream unset so a bare `git push` cannot target main).
2. `git merge --no-ff pulse-local`: clean. `origin/main` only changes `clear/` and docs since the common base `7400732`.
3. `git cherry-pick -x c8444e9 45dab7a`: auto-merged `reroute/{README.md,.env.example,package.json,pnpm-lock.yaml}`.
   Verified by hand: `package.json` has both `hls.js` (PULSE) and `@supabase/supabase-js` and `server-only` (local main), and `.env.example` has both the PULSE and the Supabase blocks.
   `pnpm install --frozen-lockfile` passes.

## Safety configuration (worktree-local, gitignored)

- `reroute/.env.local` was copied from the main checkout with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` **blanked**, so dev and tests cannot write to the shared project.
  The original values are kept in `reroute/.env.shared-supabase.local` (gitignored) for read-only inspection only.
- `SCOREPLAY_UPLOAD_APPROVED=false`, `MEDIA_PROCESSING_APPROVED=false`.

## Baseline after integration

- `vitest run`: 10 files, 136 tests pass.
- `tsc --noEmit` without `next typegen`: only Next-generated global types are missing (`RouteContext`, `PageProps`, `LayoutProps`). The `typecheck` script runs `next typegen` first.

## Conflict and design resolutions

Waves: contracts frozen (`ca29022`/`eacff89`) → W2 canonical slices (`f87bdc8`) → W3 review fixes (`52d5f53`) → final push.
Design reference: `docs/ARCHITECTURE.md`.

### Canonical choices (one implementation per responsibility)

| Responsibility | Canonical | Removed / demoted |
|---|---|---|
| Main UX | PULSE Studio goal flow at `/` | REROUTE producer desk → `/desk`; fan-signal board → `/pulse/board` (SIMULATED, `PULSE_BOARD_ENABLED`, default off). `PULSE_ENABLED` gate removed (it was never read). |
| TwelveLabs config | `lib/twelvelabs/config.ts` (per-club index override) | PULSE duplicate config reader |
| SP↔TL identity | `lib/media` `MediaResolver`: filename + duration ±0.5 s, unique both ways, ambiguity exposed | `findVideoByCustomId` / `user_metadata.scoreplay_id` as identity (index ids come from a cloned workspace, 0/58 resolve; a claim may only confirm an existing filename+duration match) |
| Policy | `selectPolicy()` per asset + intent (`lib/rights/select.ts`) | env-global `REROUTE_POLICY_ID` |
| Rights decision | `lib/server/decide.ts` + `lib/rights/engine.ts`; `decideCampaign()` per channel × territory | PULSE ad-hoc approval rules (board `service.ts`, fictional check in `goal-service`) |
| Alternatives | Media Compliance Recovery Engine: `lib/rights/recovery` planner + `lib/server/recovery.ts` `recover()` (goal flow `findRecovery`; desk `POST /api/recover`, read-only) | PULSE pool re-check; the old `/api/resolve` |
| Publication gate | `canPublish()` in contracts | any other publish logic |
| Persistence | Supabase repositories (`lib/server/store.ts`, `lib/server/repositories/*`; in-memory adapter for tests only) | `.data/pulse.json` goal/campaign storage |
| Writeback | `lib/scoreplay/writeback.ts` plan/apply, dry-run default, `GET` preview | always-live `writeDecision` |
| Auth | `lib/server/auth.ts` named reviewer credentials (`REROUTE_REVIEWERS` scrypt hashes from `scripts/reviewer-credentials.ts`), HttpOnly HMAC cookie, same-origin check, sign-in throttling | none before; later the single shared reviewer passcode (removed) |
| Previews | off unless `MEDIA_PREVIEW_ENABLED=true` (then reviewer-only, resolved per request by `previewFor()`, never persisted) | preview URLs stored in goal runs / anonymous `/api/assets` |
| Demo resilience | `DEMO_REPLAY` + committed `demo-cache/` (Reliability) | `TWELVELABS_REPLAY` + `.cache/twelvelabs` |

Also removed: the PULSE diagnostics script (`scripts/pulse-integration-diagnostics.ts`), SQL-editor setup instructions
(migrations now apply via `supabase db reset` locally), and "Spurs" → San Antonio guessing (only "san antonio" does).

### Contract changes (`reroute/src/lib/contracts.ts`)

Frozen in `ca29022`: `MediaRef`, `PolicySelection`, `Clearance`, `Blocker`, writeback dry-run shapes, `canPublish`.
Later, parent-approved additions: error codes `CONFLICT` (409) and `RATE_LIMITED` (429); request limits (≤ 20 segments,
query ≤ 500 chars, `intents` ≤ 20 on `/api/resolve`); optional `remedy` on resolve results; receipts carry `intents`
(every use) and `campaignVersion`. `/api/resolve` was later replaced by the read-only `POST /api/recover`
(`{ edit (1 segment), intents (1..21), packageId? }` → `{ recovery, media, notes, policy }`).

### Review findings fixed in W3 (ReviewCorrectness 15, ReviewSecurity 6)

- Identity claims cannot create or redirect a link; stale receipts after a re-check no longer count as submitted;
  publish date is fresh per check and a past date → NEEDS_REVIEW; unknown people list ≠ "no people"; missing asset
  facts classify as CLIP; evaluations/receipts record the media the decision actually used; receipt lists all uses.
- Reviews are final (CONFLICT on re-review); optimistic concurrency via `expectedVersion`; alternatives bound to their
  check; Pegasus calls de-duplicated, failures cached 5 min; upstream error bodies kept in server logs only.
- Security: preview URLs no longer anonymous; sign-in delay + per-IP lockout; shared reviewer passcode later replaced by
  named reviewer credentials;
  generic 500s; writeback verdict tag only on APPROVED, live writes re-read targets first.

### Shared Supabase (user-approved, 2026-10-22)

The three migrations in `reroute/supabase/migrations/` (`20261022190000_reroute_store`, `20261022200000_reroute_workflow`,
`20261022210000_reroute_campaign_receipt_version`) were applied to the shared project with the user's approval.
All 11 tables are `reroute_*` namespaced, RLS on, `anon` 0 grants; nothing else in the shared project was changed.
Development and tests use local Docker Supabase only.

### Preview deploy

https://spurs2-hackathon-nxirvj2hy-merlins-projects-2b20d832.vercel.app — the persistent Vercel **Preview** environment
variables were corrected via the Vercel API (named reviewers, previews off); **Production** env untouched. Public (no
Deployment Protection) by user decision; dry-run writeback, render off, upload off, `MEDIA_PREVIEW_ENABLED` unset.
Per-IP API rate limits are in memory per instance, i.e. best-effort on serverless.

Design sprint 01 (`edf3924`, UI only): https://spurs2-hackathon-ms17fye85-merlins-projects-2b20d832.vercel.app — same
Preview env. Deploy with `vercel deploy --force` after any change to `globals.css` tokens: with the build cache restored,
the Tailwind Turbopack loader served the previous compiled stylesheet (seen on the first sprint deploy and in a
long-running `next dev`). Design docs: `docs/design/` (force-added; `docs/` is ignored by the R `.gitignore` template).

### Mistakes caught

- The contracts were first written to the main checkout (`../hackathon-repo`) instead of this worktree; reverted there
  and re-applied here before any commit.
- Docs drift (`PULSE_ENABLED`, `REROUTE_POLICY_ID`, deleted diagnostics script, `.data/pulse.json`) fixed in README / `.env.example`.
- 2026-10-23 ≈ 04:52 UTC: the long-running `next dev` on `:3300` (started 02:33 UTC) served the pre-v2 planner wording
  although the code on disk was v2 — most likely because `next build` ran in the same project while dev was serving.
  Verdicts were unaffected; the coordinator restarted the server (v2 wording confirmed at 04:54 UTC). Rule: never run `next build` while `next dev`
  serves the demo; after any build, restart dev; rehearse on a fresh server (`next start` on a production build, or the preview).

### 2026-10-23 night work (recovery engine, Policy Center, hardening)

| Commit | What changed |
|---|---|
| `18a856d` | Media Compliance Recovery Engine (`lib/rights/recovery`: EDL with `PLAN_NOT_RENDERED`, localization by elementary-interval evaluation, TRIM / SAFE_SECTION / REPLACE / ADAPT_CAMPAIGN / CHANGE_USAGE / REQUEST_CLEARANCE, each independently re-evaluated). Goal flow cutover to `findRecovery` / `applyRecovery` / `setPolicy` (old `findAlternatives` / `useAlternative` / `applyRemedy` removed); derived cuts as campaign versions (origin `EDIT`). Policy Center (presets + uploaded JSON forced to DEMO, `/api/policies`, `/policies`, PolicyPicker) + migration `20261023000000_reroute_policy_packages`. Second recorded Pegasus run fused into evidence (`analysisRun`). Studio Compliance Editor, six-phase journey. |
| `6ee2a07` | Recovery engine v2: early licence gap (only "Request additional usage rights", no trims/replacements searched), plain-language problems/headline, SAFE_SECTION tied to the goal by same-asset search hits, AI-identified-people wording. `POST /api/recover` (read-only) + desk recovery panel (Apply cut / Use this clip / Apply to intent); `/api/resolve` and `resolve()` removed. Judging + pitch docs, demo evidence, photo inventory. |
| `e2d0492` | Security hardening: recovery rate limit 10/min (`/api/recover`, `findRecovery`); TwelveLabs clients keyed by resolved config; bounded request strings; policy id/version charset + text caps; byte-capped upload read; uploader identity only for signed-in reviewers; `.vercelignore` excludes local passcode files and docs. `demo-cache/` re-recorded (2026-10-23T04:40:23Z) for 8 scenarios A–H incl. recovery searches; desk competition + publishing club prefilled from ScorePlay. |
| `b01e251` | Flagship from the business goal: a goal naming a player restricts the search to that player's ScorePlay-tagged videos (`GET /tag/search` → `POST /media/search {any_players}`; ambiguous/unknown names leave the library unfiltered); sponsor goals add the TwelveLabs "partner on the kit" intent; ranking context ×(1 + 0.5 (n − 1)) when the club's ScorePlay title names n ≥ 2 distinctive goal words, explained in the breakdown; brief chip "Sponsor a goal moment". |
| `66a2cd0` | Demo cache re-recorded (≈ 11:39 UTC, 9 scenarios incl. I flagship, 167 files, replay verified); writeback dry-run re-planned after the review decision (was stuck on `review=PENDING`); flagship demo script, 1-min backup, contingency, screenshots. |

- **Migrations:** `20261023000000_reroute_policy_packages` (tables `reroute_policy_packages`, `reroute_policy_selection`) applied to **local Docker Supabase only**. It is **not applied to the shared Supabase project** — that needs explicit user approval. Without it, policy uploads and the per-club workspace default answer `NOT_CONFIGURED`; bundled presets and the per-run package switch still work.
- **Checks (2026-10-23 ≈ 11:47 UTC, `66a2cd0` code):** vitest 35 files — 418 passed / 15 skipped; `tsc` clean; `eslint` clean; `next build` passes. Security review (≈ 04:50): no critical/high findings; remaining low: anonymous library GET loads all stored packages (F7), in-memory per-instance rate limits on serverless, Pegasus outputs truncated with `finish_reason=length` are not cached.
- **Verified flows:** see `docs/demo/DEMO_EVIDENCE.md` (flagship in Chromium ≈ 11:41–11:46 UTC; earlier API runs 04:25–04:36 UTC; desk trim ≈ 04:50; Policy Center API ≈ 11:40).
- **Preview (Ready ≈ 11:58 UTC, `66a2cd0`):** https://spurs2-hackathon-6z5ttmdsi-merlins-projects-2b20d832.vercel.app —
  public (no Deployment Protection), shared Supabase **without** the policy-packages migration (`uploadsAvailable: false`).
  Flagship verified there in Chromium (Blocked → ★ "Remove 0:14.5–0:17.5" → Allowed 3/3, demo); S2 and S1 via API.
  Previous preview (2q50cxsxd, 54acc68) left in place. Production untouched.

## Safe merge to main

1. Open a PR `hackathon-integration` → `main` on GitHub (`git push origin hackathon-integration`; never push to
   `main` directly, never force-push; the branch has no upstream on purpose).
2. Rebase-free: if `main` moved, merge `main` into the branch and rerun checks (`pnpm test`, `pnpm typecheck`, `pnpm lint`,
   `LIVE_SMOKE=1 pnpm exec vitest run`, `next build`).
3. Migrations: apply in filename order (190000 → 200000 → 210000 → `20261023000000_reroute_policy_packages`); the first
   three are already applied on the shared project, the policy-packages migration is **not** (needs approval) — verify
   with the migration history before re-running; never edit an applied migration, add a new one instead.
4. Env checklist (Production + Preview): `SCOREPLAY_API_KEY`, `TWELVELABS_API_KEY`, `TWELVELABS_INDEX_ID`,
   `PULSE_TWELVELABS_INDEX_ID_TOTTENHAM`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `REROUTE_REVIEWERS` (hashes only, from
   `scripts/reviewer-credentials.ts`; passcodes only in the gitignored `reroute/.reviewers.local.txt`, handed out individually),
   `REROUTE_SESSION_SECRET` (≥ 32), `SCOREPLAY_WRITEBACK_MODE=dry-run`, `MEDIA_PROCESSING_APPROVED=false`,
   `SCOREPLAY_UPLOAD_APPROVED=false`, `PULSE_BOARD_ENABLED=false`, `MEDIA_PREVIEW_ENABLED` unset until playback rights
   are confirmed, optional `DEMO_REPLAY`. Remove obsolete `REROUTE_POLICY_ID`, `PULSE_ENABLED`, `TWELVELABS_REPLAY`,
   `REROUTE_REVIEWER_PASSCODE`. Never commit `.env*`.
5. Vercel: enable Deployment Protection (event media), add a Firewall rate-limit rule on `/api/*` (e.g. 30 req/min/IP;
   5/min on `/api/pulse/goal`, `/api/recover`, `/api/auth/session`) — the in-app limiter is per instance.
6. Merge with a merge commit after review; keep the `backup/*` refs until production is verified.
