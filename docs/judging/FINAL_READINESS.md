# PULSE — final readiness

State as of 2026-10-23 ≈ 05:00 UTC, branch `hackathon-integration` at `e2d0492` (+ docs). Evidence: [`../demo/DEMO_EVIDENCE.md`](../demo/DEMO_EVIDENCE.md) — §1/§1a are my own API runs (04:25–04:36), §1b lists later runs with who ran them (*(mine)* vs *(reported)* by other agents). Not a prediction of scores.

Environments: local production build (`next start`), Vercel Preview https://spurs2-hackathon-rxkituveo-merlins-projects-2b20d832.vercel.app (public, no Deployment Protection; shared Supabase **without** the policy-packages migration), local dev `:3300` (restarted after serving stale wording at ≈ 04:52).

## Status table

| Capability | Status | Evidence / note |
|---|---|---|
| Goal → 3 real moments (ScorePlay + Marengo, SP↔TL mapping) | **Fully working** | API runs 0.8–4.0 s, origin LIVE (04:25–04:54); prod-build UI 3.96 s (≈ 04:41, reported); preview 3.84 s (≈ 04:58, reported) |
| Rights check per channel × market | **Fully working** | S1 BLOCKED 0/3, S2 NEEDS_REVIEW 6/21, Tickets ALLOWED 3/3 |
| Recovery: localization, trim attempt + rejection, REPLACE, SAFE_SECTION, CHANGE_USAGE, REQUEST_CLEARANCE | **Fully working** | S1 same options/outcomes at 04:25, 04:35, 04:54; v2 wording at 04:54 and on the preview |
| Recovery: ADAPT_CAMPAIGN | **Fully working** | S2 6/21 → 6/6 |
| Recovery: licence gap (Mexico) | **Fully working** (API); on-screen state **Untested** by me | 04:36: only "Request additional usage rights", `canSubmit` false |
| Successful TRIM | **Fully working** on the desk | `/desk` UI ≈ 04:50 (reported): "Remove 0:14.5–0:17.5 … Result 6.0 s of 9.0 s · Edit plan — not rendered" → Apply cut → ALLOWED · DEMO; API 04:27 (mine). No Studio goal scenario has a successful trim. |
| Apply → new version + independent re-evaluation + before/after | **Fully working** | S1, S1-b, S2, Sponsor; preview S1 |
| Policy Center presets + per-run switch | **Fully working** (local and preview) | Sponsor BLOCKED → stale → NEEDS_REVIEW → clean section ALLOWED |
| Policy JSON upload (forced DEMO) / PDF refusal / workspace default | **Fully working locally**; **Blocked externally on the preview** (shared-Supabase migration needs approval) | upload 201, PDF 422, anon 403, S2 → 15/21 under uploaded package (≈ 04:47, reported); preview `uploadsAvailable: false` |
| Human review + receipt | **Fully working** | receipt `84e91007…` APPROVED 04:26 (mine); prod-build UI "Approved by Demo presenter" (reported) |
| Audit trail (hash chain) | **Fully working** | 2 events on the receipt, global chain (04:35) |
| Reload restores state (`?run=`) | **Fully working** | API 04:26 |
| ScorePlay writeback | **Simulated** (dry run) | "1 planned ScorePlay call · Live write refused" |
| Edits (TRIM/SAFE_SECTION) | **Simulated** (edit plan, not rendered) | EDL `PLAN_NOT_RENDERED` |
| Rule packages | **Simulated** (fictional DEMO) | never publishable |
| CACHED fallback (`DEMO_REPLAY`) | **Fully working** for 8 Studio scenarios | re-recorded 04:40:23Z, replay verified, tag "Recorded data 23 Oct 2026" (reported) |
| Fan-signal board | **Simulated**, off | flag off |
| Sales attribution | **Blocked externally** (no data source) | KPI "not connected" |
| Video previews | **Blocked externally** (playback rights) | off |
| Live ScorePlay writes | **Blocked externally** (authorization + real policy) | dry-run |
| NBA footage analysis | **Blocked externally** | 65 videos, no NBA TwelveLabs index (rechecked ≈ 04:05) |
| Pegasus on > 60 min video | **Blocked externally** (API limit) | full match has no product-run observation |
| ScorePlay photos in the Studio | **Fully working** (metadata only) | Discover step shows ≤ 3 real ScorePlay photos per goal, matched on captions / person tags / event / orientation, each rights-checked by the engine (S1 at ≈ 05:20 UTC: CK1_9648.JPG, CK3_4457.JPG, PC1_3663.JPG — NEEDS_REVIEW 0/3: "the photo was not analysed"). Not visually analysed; no image URL in any response; included in the CACHED recording (154 files, re-recorded ≈ 05:22 UTC). Inventory: `PHOTO_INVENTORY.md` |
| Build / tests / types / lint | **Fully working** | `next build` passes; vitest 413 passed / 15 skipped (34 files); tsc + eslint clean (≈ 05:20 UTC) |
| Security review | **Fully working**, low items open | no critical/high; open low: anonymous library GET loads all stored packages (F7), in-memory per-instance rate limits on serverless, truncated Pegasus outputs not cached |
| Full timed rehearsal of DEMO_SCRIPT (S1) | **Fully working** (automated browser run, production build, ≈ 05:25 UTC) | chip → moments 4.4 s (cold) → Use this moment → Check rights "Can’t be used as planned · 0 of 3" → Find a way 1.2 s (headline, "First, PULSE tried … Rejected", Slide 6 recommended 3/3) → Use revised plan 0.5 s ("Before: Blocked") → Send for human review → Approve → ScorePlay record "Live write refused"; 0 page errors. Photos row appears once the photo cache is warm (the first run of the day can skip it: 1.2 s budget) — pre-run S1 once. Second beat and close not rehearsed in the browser in this pass. |

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
