# PULSE — final readiness

State as of 2026-10-23 ≈ 04:40 UTC, integration branch, local `:3300` (local Supabase, live ScorePlay + TwelveLabs, previews off, writeback dry-run). Evidence: [`../demo/DEMO_EVIDENCE.md`](../demo/DEMO_EVIDENCE.md). Not a prediction of scores.

## Status table

| Capability | Status | Evidence / note |
|---|---|---|
| Goal → 3 real moments (ScorePlay + Marengo, SP↔TL mapping) | **Fully working** | S1/S2/MX/T/SP runs 0.8–2.1 s, origin LIVE (04:25–04:36) |
| Rights check per channel × market (deterministic engine) | **Fully working** | S1 BLOCKED 0/3, S2 NEEDS_REVIEW 6/21, T ALLOWED 3/3 |
| Recovery: localization, trim attempt + rejection, REPLACE, SAFE_SECTION, CHANGE_USAGE, REQUEST_CLEARANCE | **Fully working** | S1 options identical at 04:25 and 04:35 |
| Recovery: ADAPT_CAMPAIGN (licensed subset) | **Fully working** | S2 6/21 → 6/6 |
| Recovery: licence gap (Mexico) | **Fully working** (engine), UI state **Untested** after change | 04:36: only "Request additional usage rights"; `canSubmit` false; submit HTTP 400 (04:26) |
| Successful TRIM | **Partially implemented** in the Studio flow / **working** in the engine | `POST /api/recover` solanke late goal → ALLOWED 3/3 (04:27); desk UI not verified; no Studio scenario has a successful trim |
| Apply option → new version + independent re-evaluation + before/after | **Fully working** | S1, S1-b, S2, SP |
| Policy Center presets + per-run switch (stale verdict) | **Fully working** | SP 04:26 and 04:36; `GET /api/policies` 04:35 |
| Policy JSON upload (forced DEMO, sha256) / PDF refusal | **Untested** today | in code; not exercised in this pass |
| Human review (named reviewer) | **Fully working** | receipt `84e91007…` APPROVED 04:26:01 |
| Audit trail (hash-chained events) | **Fully working** | 2 events on the receipt, global chain (04:35) |
| Reload restores state (`?run=`) | **Fully working** (API) | `GET /api/pulse/goal?id=` 04:26 |
| ScorePlay writeback | **Simulated** (dry run) | planned `POST /video/logs`, "Live write refused." |
| Edits (TRIM/SAFE_SECTION) | **Simulated** (edit plan, not rendered) | EDL `PLAN_NOT_RENDERED` |
| Rights rules | **Simulated** (fictional DEMO packages) | never publishable |
| Fan-signal board | **Simulated**, off | flag off |
| Sales attribution | **Blocked externally** (no data source) | KPI "not connected" |
| Video previews / playback | **Blocked externally** (organizer playback rights) | off |
| Live ScorePlay writes | **Blocked externally** (authorization + real policy) | dry-run |
| NBA footage analysis | **Blocked externally** (65 videos not in any visible TwelveLabs index) | rechecked 04:0x UTC |
| Pegasus on > 60 min video | **Blocked externally** (API limit) | full match has no product-run observation |
| `DEMO_REPLAY` for the recovery flow | **Untested** | replay verified 03:27 for the older flow only |
| Desk recovery UI (`/desk`) | **Untested** by this pass | being wired by another agent |
| Full UI rehearsal after final editor polish | **Untested** | API-level verification only in this pass |
| Test suite | **Fully working** at 04:35 | 405 passed / 15 skipped; re-run after freeze |

## Per criterion

### Partner fit — ScorePlay + TwelveLabs (25)
- **Working evidence:** live ScorePlay discovery, squads and tags; Marengo moments with ranks; 58/58 SP↔TL links; two Pegasus runs feeding localized restrictions; ScorePlay `POST /video/logs` plan carrying receipt, policy and reviewer.
- **Live:** S1 from goal to writeback preview.
- **Simulation:** writeback is dry run; second Pegasus run is recorded (labelled "second run").
- **Remaining gaps:** no playback (judges can't see the frame); NBA not indexed; photos unused by the Studio.
- **Most impactful correction:** narrate partner roles in one line each and open the writeback preview on stage.

### Practicality (25)
- **Working evidence:** four goal types with four different recovery outcomes + one clean pass; named review; Policy Center switch.
- **Live:** S1, S2 (20 s), Sponsor switch or Mexico close.
- **Simulation:** all rule packages; no rendering; no sales data.
- **Remaining gaps:** no real club rules, no PDF intake, no privacy rule for private persons/minors.
- **Most impactful correction:** have the onboarding answer (JURY_QA #15) and the privacy answer (#10) ready; mention Tickets clean pass.

### Technical execution (20)
- **Working evidence:** deterministic engine, interval localization, independent re-checks, EDL, versioned persistence, global hash chain, tests 405 passed.
- **Live:** trim rejection text, Before/After, Compare (edit plan), audit trail, reload.
- **Simulation:** edits not rendered.
- **Remaining gaps:** successful trim only engine-verified; code still changing during the final hours (transient failures at 04:27–04:28).
- **Most impactful correction:** code freeze, re-run suite, one full UI rehearsal.

### Originality (15)
- **Working evidence:** "What PULSE tried first — Rejected" → recommended replacement → re-check; campaign-scope fix; package switch changes the answer.
- **Live:** S1 beat.
- **Simulation:** none in the mechanism; rules are demo.
- **Remaining gaps:** lands only if narrated.
- **Most impactful correction:** say the differentiation line right after the trim rejection.

### Presentation (15)
- **Working evidence:** 3-min script, 1-min backup, 19-question Q&A, disclosure sheet, contingency with screenshots.
- **Live:** whole script.
- **Simulation:** fallbacks are labelled ("Recorded data" tag, screenshots announced).
- **Remaining gaps:** no timed rehearsal; screenshots may predate label polish; Mexico UI after engine change unseen.
- **Most impactful correction:** one timed rehearsal on the presenting machine with pre-run tabs.

## Discrepancies found against the briefing facts

1. **Mexico:** facts say "every replacement NOT_VIABLE". True at 04:26; after an engine change (04:27–04:35) the licence gap generates **no** trim/replacement options at all — only "Request additional usage rights". Verdict BLOCKED 0/3 (not NEEDS_REVIEW), scope MIXED.
2. **Tests:** facts cite 392 passed / 15 skipped; observed **405 passed / 15 skipped (420)** at 04:35 (5 transient failures at 04:27 during another agent's refactor). Recovery suite 20 — matches.
3. **Find a way timing (S1):** facts ≈ 0.7 s; observed 1.56 s (first), 0.86 s and 0.84 s (later runs) at the API.
4. **Policy versions:** `2026-10-23.1` (older docs said `2026-10-22.2`).
5. **Sponsor evidence:** the kraken observation spans **15–46 s** in the engine's explanation; the 0:15.0–0:20.2 problem line cites both the product run and the second run.
6. **Audit chain:** the hash chain is global (event ids 796 → 798 for one receipt), not per receipt.
7. **Problem headline wording** changed at ≈ 04:30 (e.g. "In the footage: Player #18 (0:06.9–0:07.0); the Manchester United logo (0:09.0–0:14.5)"); the Rights panel still reads "Can't be used as planned · 0 of 3 uses allowed".
