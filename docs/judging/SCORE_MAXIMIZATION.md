# PULSE — score maximization (internal)

Official rubric, 100 points. This is an **internal readiness view**, not a prediction of judges' scores. Evidence: [`../demo/DEMO_EVIDENCE.md`](../demo/DEMO_EVIDENCE.md) (my API re-verification 2026-10-23 04:25–04:54 UTC on local `:3300`, live ScorePlay + TwelveLabs; plus production-build UI ≈ 04:41, Policy Center ≈ 04:47, desk ≈ 04:50 and preview ≈ 04:58 reported by other agents, §1b). Status per capability: [`FINAL_READINESS.md`](FINAL_READINESS.md). Click paths: [`../pitch/DEMO_SCRIPT.md`](../pitch/DEMO_SCRIPT.md).

Confidence scale for "works in the demo": **High** = re-verified end-to-end today on the API and the UI path is unchanged in code; **Med** = verified on the API but the UI or environment changed after, or a dependency is live/external; **Low** = not verified today.

---

## 1. Partner fit — ScorePlay + TwelveLabs (25)

**Official criterion:** how well the solution uses and fits the partners' products. Max **25**.

| Feature | Partner use |
|---|---|
| Goal → moments | ScorePlay media search/tags for the club library; TwelveLabs Marengo for timestamped moments; 1:1 SP↔TL link (filename + duration, 58/58) |
| Identity | ScorePlay squad list decides who is "ours" (Player #18 / AI-named players → unknown) |
| Evidence | Two Pegasus runs (product + second run, union) with timecodes |
| Replacements | Marengo search for the same goal, each result mapped back to a ScorePlay asset |
| Writeback | ScorePlay `POST /video/logs` timecoded log with receipt + policy + reviewer (dry run) |

**Evidence judges can see:** S1: moment card "TwelveLabs found this 8-second moment at 0:07–0:15 … #3 for 'players applauding the travelling fans after the match'" → Find a way to use it → problem lines with source "TwelveLabs video analysis + … second run" → Review → **ScorePlay record → Preview writeback (dry run)** → planned `POST /video/logs` (media 130851320, 23.5–30.44 s on the S1-b path) → **Identifiers and audit trail** (SP ↔ TL ids).

**Weaknesses:** no live write to ScorePlay (dry run); no video playback (previews off), so judges never *see* the crest; NBA library not indexed in TwelveLabs; Pegasus refuses > 60 min videos; ScorePlay photos (605) unused by the Studio.

**Missing proof:** a visible frame or thumbnail of the AI observation (blocked by playback rights); a ScorePlay read-back after a write (only in dry run).

**Highest-impact actions:**
1. In the pitch, say the partner roles in one sentence each ("ScorePlay = facts and identity; TwelveLabs = what's on screen and when").
2. Open **Preview writeback** on stage — it is the only moment ScorePlay is visibly the system of record.
3. Mention the second Pegasus run explicitly when the crest shows 9–14.5 s (shows depth of TwelveLabs use).

**Confidence:** High for search/mapping/evidence/writeback plan (re-verified 04:25–04:54 by API; S1 prod-build UI ≈ 04:41 and preview ≈ 04:58 reported). Med for timing (live APIs; `run` 0.8–4.0 s today).

## 2. Practicality (25)

**Official criterion:** does it solve a real problem in a way a club could use. Max **25**.

| Feature | Why practical |
|---|---|
| Goal-first input with chips | A social/commercial user types a business goal, not keywords |
| Recovery engine | Turns "blocked" into a usable option: replacement (S1), licensed subset (S2), clean section (Sponsor), a cut that works (desk), honest licence gap (Mexico) |
| Clean pass | Tickets: ALLOWED 3/3 directly — no manufactured friction |
| Policy Center | Different rule packages per commercial context; switch per run; JSON upload (DEMO) |
| Human review + audit | Named reviewer, receipt, hash-chained events |

**Evidence judges can see:** the S1 beat (blocked → trim rejected → replacement → re-check → review); S2 "Limit to licensed markets: GB, US" 6/21 → 6/6; desk trim "Remove 0:14.5–0:17.5 … 6.0 s of 9.0 s" → ALLOWED · DEMO; Sponsor "Change rules" → "Needs a fresh check" → re-check → clean section; Mexico — only "Request additional usage rights".

**Weaknesses:** all rule packages are fictional; edits are plans, not rendered; no PDF contract intake; no privacy rule for private persons/minors in crowd shots; sales attribution not connected; single club indexed.

**Missing proof:** a real rights team's rules; a user test with a club social team; time-to-approval measured against today's process (we won't invent it).

**Highest-impact actions:**
1. Open with the pitch line "content usage problem" and tie each demo to a buyer (commercial, partnerships, rights).
2. Show the Tickets clean pass in one sentence — proves PULSE doesn't block by default.
3. Have the onboarding answer ready (JURY_QA #15) — practicality questions will target "where do the rules come from".

**Confidence:** High for S1/S2/Sponsor/Tickets (API re-verified, S1 also in the prod-build UI) and the desk trim (UI ≈ 04:50, reported). Med for the Mexico close (engine output changed at ≈ 04:30; screen not re-checked by me). JSON upload works locally but not on the preview (migration not on shared Supabase).

## 3. Technical execution (20)

**Official criterion:** quality, robustness and depth of the build. Max **20**.

| Feature | Depth |
|---|---|
| Deterministic engine | DENY/MISSING/PERMIT per dimension, unknown never ALLOWED, AI < 0.6 never blocks alone |
| Localization | split at every observation boundary, each interval evaluated per use; ±0.5 s margin; min post 3 s / 40 %; pieces < 1 s dropped |
| Independent re-checks | every option evaluated by the same engine; NOT_VIABLE / NEXT_STEP never applicable |
| EDL | kept/removed intervals with reasons and output timeline, `PLAN_NOT_RENDERED` |
| Persistence | versioned runs (optimistic concurrency), immutable campaign versions, evaluations, recovery plans, receipts, global hash-chained events; reload restores state |
| Security | named reviewer sessions, same-origin, rate limits, no footage URLs, writeback dry-run |
| Tests | 406 passed / 15 skipped, tsc + eslint clean, `next build` passes (≈ 04:50, reported); recovery suite 20 |

**Evidence judges can see:** "What PULSE tried first — Rejected: it would leave 1.0 s of 7.8 s — below the 3.1 s minimum"; Before/After; **Compare** on the same-clip section → "Edit plan — not rendered"; evaluation chain in Identifiers and audit trail; reload of a `?run=` URL.

**Weaknesses:** rate limits are in-memory per instance; the codebase changed during the final hours (transient test failures and a compile error at 04:27–04:28; a dev server served stale wording after a `next build` at ≈ 04:52 — fixed by restart).

**Missing proof:** a successful trim inside a Studio goal flow (the successful trim is on the desk — verified in the UI ≈ 04:50, reported).

**Highest-impact actions:**
1. Freeze code before rehearsal; re-run the full suite and cite that exact number.
2. Use the desk trim as the 20-second second beat when the jury is technical ("the cut that was rejected in S1 wins here") — DEMO_SCRIPT §2:05 option B.
3. Keep TECHNICAL.md open for the Q&A.

**Confidence:** High for engine behaviour (deterministic, 406 tests green, build passes). Med for stage stability until the code is frozen and the demo runs on a fresh server.

## 4. Originality (15)

**Official criterion:** novelty of the idea and approach. Max **15**.

| Feature | Why original |
|---|---|
| "Find a way to use it" | Moves from detection to resolution; ranks and verifies alternatives |
| Clip vs plan vs licence | Distinguishes footage problems, plan problems and licence gaps, each with the right kind of fix |
| Self-rejecting trim | The system shows the fix it tried and why it rejected it |
| Rules as packages | Same clip, different contract → different answer |

**Evidence judges can see:** the S1 beat; the S2 campaign-scope fix; the package switch.

**Weaknesses:** individual parts (rights checks, AI tagging) exist elsewhere; originality lands only if the "tried → rejected → better alternative" beat is visible and narrated.

**Missing proof:** none technical; it is a presentation risk.

**Highest-impact actions:** say the differentiation line verbatim ("Other tools identify what you can't publish. PULSE finds the best way to achieve your goal anyway") right after the trim rejection.

**Confidence:** High (S1 rejection text identical at 04:25, 04:35 and 04:54).

## 5. Presentation (15)

**Official criterion:** clarity and quality of the pitch and demo. Max **15**.

| Asset | Status |
|---|---|
| 3-min script | `docs/pitch/DEMO_SCRIPT.md` |
| 1-min backup | `docs/pitch/BACKUP_1MIN.md` |
| Q&A | `docs/pitch/JURY_QA.md` (21 questions) |
| Disclosure | `docs/pitch/EVIDENCE.md` |
| Fallbacks | `docs/pitch/CONTINGENCY.md` + screenshots in `docs/design/screenshots/recovery/` |

**Weaknesses:** no full timed UI rehearsal yet; the S1 beat has many points of interest — risk of running over 3 minutes; screenshots may predate final labels.

**Missing proof:** a timed rehearsal on the presenting machine.

**Highest-impact actions:**
1. One timed rehearsal with the exact script on a fresh server (prod build or preview); cut the optional "Other ways" glance if over 2:05 at the end of S1.
2. Pre-run tabs for S2, Sponsor, Mexico and the desk beat.
3. Say the four disclaimers naturally: demo rules, dry run, not rendered, recorded when the tag says so.

**Confidence:** Med — content is ready; rehearsal not yet done.

---

## Top 5 actions overall (ordered by impact per minute)

1. **Code freeze + one timed UI rehearsal** of DEMO_SCRIPT on a fresh server (prod build `next start` or the preview); never `next build` while `next dev` serves the demo.
2. **Pre-run tabs** (S1 at Resolution, S2, Sponsor, Mexico, desk solanke) and sign the reviewer in before the jury.
3. **Look at the Mexico screen once** after the engine change (only "Request additional usage rights" now).
4. **Re-run the test suite** after the freeze and use that number (406 / 15 skipped at ≈ 04:50).
5. **Keep the CACHED fallback ready**: `pnpm exec next build && DEMO_REPLAY=true pnpm exec next start -p 3401` (8 recorded scenarios, re-recorded 04:40 UTC) plus the screenshots.
