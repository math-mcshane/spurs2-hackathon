# PULSE — final readiness

State as of 2026-10-23 ≈ 11:50 UTC, branch `hackathon-integration` at `66a2cd0`. Evidence: [`../demo/DEMO_EVIDENCE.md`](../demo/DEMO_EVIDENCE.md) (§0 flagship, then earlier runs). Not a prediction of scores.

Environments: local production build (`next start -p 3400`, recommended), Vercel Preview https://spurs2-hackathon-6z5ttmdsi-merlins-projects-2b20d832.vercel.app (`66a2cd0`; public; shared Supabase **without** the policy-packages migration; flagship there: one issue, "Remove 0:14.5–0:17.5", 7.7 s — see `../pitch/CONTINGENCY.md`), local dev `:3300` (development only).

## Status table

| Capability | Status | Evidence / note |
|---|---|---|
| Flagship: goal names a player → ScorePlay player-tag filter → moment → BLOCKED → TRIM → ALLOWED | **Fully working** | Chromium on a fresh production build, twice (≈ 11:41 and ≈ 11:45 UTC): "Activate our sponsor with Solanke's late goal for UK fans" → "Searched only the 15 videos ScorePlay tags with Dominic Ayodele Solanke-Mitchell" → moment 02 *solanke late goal* 0:09–0:20 → Blocked 0/3 (DHL boards 15–17 s, second run; "Tonali" 19–23 s, AI-named) → ★ "Remove 2 flagged parts (0:14.5–0:17.5, 0:18.5–0:19.7)", 6.4 s of 10.7 s, edit plan not rendered → Allowed 3/3 (demo) → approved → writeback dry run (2 logs, review=APPROVED). Rank comes from TwelveLabs (#5 for the partner-on-kit query) × the club's own title naming the goal (×2), shown in "Why this moment". Moment 02, not 01. |
| Goal → 3 real moments (ScorePlay + Marengo, SP↔TL mapping) | **Fully working** | API runs 0.8–4.0 s, origin LIVE (04:25–04:54); prod-build UI 5.0–7.6 s for the flagship (11:41–11:45) |
| Rights check per channel × market | **Fully working** | S1 BLOCKED 0/3, S2 NEEDS_REVIEW 6/21, Tickets ALLOWED 3/3 |
| Recovery: localization, trim attempt + rejection, REPLACE, SAFE_SECTION, CHANGE_USAGE, REQUEST_CLEARANCE | **Fully working** | S1 same options/outcomes at 04:25, 04:35, 04:54; v2 wording at 04:54 and on the preview |
| Recovery: ADAPT_CAMPAIGN | **Fully working** | S2 6/21 → 6/6 |
| Recovery: licence gap (Mexico) | **Fully working** (API); on-screen state **Untested** by me | 04:36: only "Request additional usage rights", `canSubmit` false |
| Successful TRIM | **Fully working** in the Studio (flagship) and on the desk | Studio flagship above; `/desk` 0:10–0:19 "Remove 0:14.5–0:17.5 … Result 6.0 s of 9.0 s" → ALLOWED · DEMO (≈ 04:50) |
| Apply → new version + independent re-evaluation + before/after | **Fully working** | S1, S1-b, S2, Sponsor; preview S1 |
| Policy Center presets + per-run switch | **Fully working** (local and preview) | Browser ≈ 11:43 UTC: S2 6/21 → switch to uploaded "Tottenham International Window — Demo" → "Needs a fresh check" → 15/21 |
| Policy JSON upload (forced DEMO) / errors / reviewer auth / workspace default | **Fully working locally**; **Blocked externally on the preview** (shared-Supabase migration needs approval) | API ≈ 11:40 UTC on local Supabase: invalid JSON 400, schema error 400, duplicate 409, PDF 422, anon upload 403, anon select 403, reviewer select 200 → new runs use the selected default, cross-club select 400, restored to demo-tottenham-pl |
| Human review + receipt | **Fully working** | receipt `84e91007…` APPROVED 04:26 (mine); prod-build UI "Approved by Demo presenter" (reported) |
| Audit trail (hash chain) | **Fully working** | 2 events on the receipt, global chain (04:35) |
| Reload restores state (`?run=`) | **Fully working** | API 04:26 |
| ScorePlay writeback | **Simulated** (dry run) | "1 planned ScorePlay call · Live write refused" |
| Edits (TRIM/SAFE_SECTION) | **Simulated** (edit plan, not rendered) | EDL `PLAN_NOT_RENDERED` |
| Rule packages | **Simulated** (fictional DEMO) | never publishable |
| CACHED fallback (`DEMO_REPLAY`) | **Fully working** for 9 Studio scenarios incl. the flagship | re-recorded ≈ 11:39 UTC, 167 files, replay verified (flagship TRIM → ALLOWED) |
| Fan-signal board | **Simulated**, off | flag off |
| Sales attribution | **Blocked externally** (no data source) | KPI "not connected" |
| Video previews | **Blocked externally** (playback rights) | off |
| Live ScorePlay writes | **Blocked externally** (authorization + real policy) | dry-run |
| NBA footage analysis | **Blocked externally** | 65 videos, no NBA TwelveLabs index (rechecked ≈ 04:05) |
| Pegasus on > 60 min video | **Blocked externally** (API limit) | full match has no product-run observation |
| ScorePlay photos in the Studio | **Fully working** (metadata only) | Discover step shows ≤ 3 real ScorePlay photos per goal, matched on captions / person tags / event / orientation, each rights-checked by the engine (S1 at ≈ 05:20 UTC: CK1_9648.JPG, CK3_4457.JPG, PC1_3663.JPG — NEEDS_REVIEW 0/3: "the photo was not analysed"). Not visually analysed; no image URL in any response; included in the CACHED recording (154 files, re-recorded ≈ 05:22 UTC). Inventory: `PHOTO_INVENTORY.md` |
| Build / tests / types / lint | **Fully working** | `next build` passes; vitest 418 passed / 15 skipped (35 files); tsc + eslint clean (≈ 11:47 UTC) |
| Security review | **Fully working**, low items open | no critical/high; open low: anonymous library GET loads all stored packages (F7), in-memory per-instance rate limits on serverless, truncated Pegasus outputs not cached |
| Timed browser rehearsal | **Fully working** for flagship, S2 (+ rules switch), S1 (≈ 11:41–11:46 UTC, production build) | Human visual verification of the DHL board: **not done** (AI-observed, second Pegasus run only). |

## Per criterion

### Partner fit — ScorePlay + TwelveLabs (25)
- **Working evidence:** live ScorePlay discovery, squads and tags; Marengo moments and replacement ranks; 58/58 SP↔TL links; two Pegasus runs feeding localized restrictions (DHL board seen only by the second run drives the desk trim); `POST /video/logs` plan with receipt, policy, reviewer.
- **Live:** S1 goal → writeback preview; desk trim.
- **Simulation:** writeback dry run; second Pegasus run recorded ("second run").
- **Remaining gaps:** no playback; NBA not indexed; photos are suggested from ScorePlay metadata only (no visual analysis).
- **Most impactful correction:** one line per partner role, then open the writeback preview on stage.

### Practicality (25)
- **Working evidence:** five goal types with distinct outcomes (replacement, licensed subset, clean section after a package switch, licence gap, clean pass) + a successful desk trim; named review; Policy Center incl. JSON upload locally.
- **Live:** S1, second beat (S2 or desk), Sponsor switch or Mexico close.
- **Simulation:** all rule packages; no rendering; no sales data.
- **Remaining gaps:** no real club rules, no PDF intake, no privacy rule for private persons/minors; uploads unavailable on the preview.
- **Most impactful correction:** have JURY_QA #10 (privacy) and #15 (onboarding) ready; mention the Tickets clean pass.

### Technical execution (20)
- **Working evidence:** deterministic engine, interval localization, independent re-checks, EDL, versioned persistence, global hash chain, rate limits incl. recovery 10/min, build + 406 tests green.
- **Live:** trim rejection (S1) and trim success (desk), Before/After, audit trail, reload.
- **Simulation:** edits not rendered.
- **Remaining gaps:** in-memory rate limits on serverless; stale-dev-server incident shows the demo must run on a fresh server.
- **Most impactful correction:** code freeze; rehearse on the production build or the preview.

### Originality (15)
- **Working evidence:** "tried a cut → rejected → better replacement → re-checked", and the counterpart where the cut wins; package switch changes the answer.
- **Live:** S1 + desk beat.
- **Simulation:** none in the mechanism.
- **Remaining gaps:** lands only if narrated.
- **Most impactful correction:** say the differentiation line right after the trim rejection.

### Presentation (15)
- **Working evidence:** 3-min script with two second-beat options, 1-min backup, 21-question Q&A, disclosure sheet, contingency (CACHED replay, preview, screenshots incl. desk).
- **Live:** whole script.
- **Simulation:** fallbacks labelled ("Recorded data" tag, screenshots announced).
- **Remaining gaps:** no timed rehearsal; Mexico screen after the engine change unseen by me.
- **Most impactful correction:** one timed rehearsal with pre-run tabs.

## Discrepancies found against the briefing facts

1. **Mexico:** "every replacement NOT_VIABLE" was true at 04:26; since `6ee2a07` the licence gap generates **no** trim/replacement — only "Request additional usage rights". Verdict BLOCKED 0/3 (not NEEDS_REVIEW), scope MIXED.
2. **Tests:** briefing 392 passed; observed 405 (04:35, mine) and 406 / 15 skipped (≈ 04:50, reported).
3. **Find a way (S1):** briefing ≈ 0.7 s; observed 0.83–1.56 s (API), 1.28 s (UI), 1.67 s (preview).
4. **Policy versions:** `2026-10-23.1` (older docs: `2026-10-22.2`).
5. **Sponsor evidence:** kraken spans 15–46 s in the engine's explanation; the 0:15.0–0:20.2 line cites both runs.
6. **Audit chain:** global, not per receipt (ids 796 → 798).
7. **Search ranks of S1 replacements move between runs** (Limbs #3 → #4, Slide 19 #4 → #6); Slide 6 stays #2 and recommended.
8. **Stale dev server:** at 04:52 `:3300` served pre-v2 wording after a `next build` in the same project; restarted, v2 confirmed 04:54.
