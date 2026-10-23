# PULSE — Top 3 demos (recovery engine)

**Re-verified:** 2026-10-23 04:25–04:54 UTC on `hackathon-integration` (API on local `:3300`, live ScorePlay + TwelveLabs, previews off, writeback dry-run), plus a production-build Studio walkthrough of S1 (≈ 04:41), the desk trim in the UI (≈ 04:50) and S1 on the Vercel preview (≈ 04:58) — the last three reported by other agents. Exact outputs, timings and who ran what: [`DEMO_EVIDENCE.md`](DEMO_EVIDENCE.md) §1–§1b.
**Every verdict is under a fictional DEMO policy** — the app says "Demo policy — not verified legal clearance" on every result. Nothing is publishable.

Promise on screen: *From business objective to rights-aware campaign — and automatically to a better alternative when something cannot be used.*

| | What it proves | Real moment | Outcome (demo rules) |
|---|---|---|---|
| **1. Merch — the cut, the swap, the receipt** | PULSE localizes the problem in time, **tries a cut first, rejects it honestly**, recommends a replacement, re-checks it, then review → audit → dry-run writeback | Fans clap Man United A 9x16 (ScorePlay 130851320) 0:06.9–0:14.7 → Slide 6 - Away End Singing Pre-KO (130851415) 0:01.1–0:08.9 | BLOCKED 0/3 → ALLOWED 3/3 |
| **2. Global engagement — fix the plan, not the clip** | The engine recognises a campaign-level restriction: changing footage would not help, so it shrinks the plan to licensed markets | Goal Slo Mo Man United 9x16 (A) v1 (130851421) 0:00–0:14.8 | NEEDS_REVIEW 6/21 → ALLOWED 6/6 |
| **3a. Sponsor — the rules change, the answer changes** | Policy Center: same clip, two demo packages; switching marks the verdict stale; re-check; the engine finds a clean section | Goal Slo Mo 0:14.8–0:20.2 → same clip 0:36.5–0:41.9 | BLOCKED 0/3 → (package switch) NEEDS_REVIEW 0/3 → ALLOWED 3/3 |
| **3b. Mexico — the honest no** (alternative close) | A licence gap is never "fixed" with other footage; submission stays locked | Goal Slo Mo 0:14.8–0:20.2 | BLOCKED 0/3, no footage option generated, only next step "Request additional usage rights" |
| **Beat 2 alt. — Desk: a cut that works** (20 s, alternative to Demo 2) | The same engine *succeeds* with a trim when enough footage is left; edit plan, then re-decision | solanke late goal.mp4 (130851444) 0:10–0:19 → kept 0:10.0–0:14.5 + 0:17.5–0:19.0 | BLOCKED → ALLOWED · DEMO (both kept segments) |

Control case worth one sentence: **Sell tickets** → Slide 18 and Slide 6 are ALLOWED 3/3 straight away. PULSE does not manufacture problems.

---

## Demo 1 — Merch: the cut, the swap, the receipt

| | |
|---|---|
| Goal | Chip **Sell merchandise** → "Promote Tottenham merchandise to UK supporters". Plan: Commercial · GB · Instagram, Facebook, X (3 uses). Package "Tottenham Social Media Usage — Demo". |
| Moments | 01 Slide 18 - Away End FT 0:00–0:07 · **02 Fans clap Man United A 9x16 0:07–0:15** · 03 Slide 6 - Away End Singing 0:00–0:10 (API `run` 2.1 s at 04:25:19). |
| Problem | **Check rights** → BLOCKED 0/3. "Find a way to use it" → two located problems: Player #18 at 0:06.9–0:07.0 (TwelveLabs; shirt number only, not mappable to the ScorePlay squad) and Manchester United crest on the hoarding 0:09.0–0:14.5 (TwelveLabs product run + second run; demo rule THFC-13 partner exclusivity). |
| What PULSE tried first | TRIM "Remove 2 flagged parts (0:06.9–0:07.5, 0:08.5–0:14.7)" → **Rejected:** "it would leave 1.0 s of 7.8 s — below the 3.1 s minimum for this post." |
| Recommended | REPLACE "Use Slide 6 - Away End Singing Pre-KO.mov 0:01.1–0:08.9" — independent re-check ALLOWED 3/3 (demo). |
| Other ways | Limbs Man United 0:02.9–0:10.7 ALLOWED 3/3 · same clip 0:23.5–0:30.4 ALLOWED 3/3 ("Video search also matched this section to 'players applauding the travelling fans after the match' (#9)", ranked below the better-matched Slide 6) · Slide 19 NEEDS_REVIEW 0/3 (#16 not on squad) · organic post ALLOWED 3/3 (changes the goal) · ask the rights team (next step). Search ranks of Limbs/Slide 19 moved between runs (#3/#4 at 04:25, #4/#6 at 04:54) — pick by name. |
| After apply | New campaign version, independent re-evaluation ALLOWED / DEMO 3/3; Before/After BLOCKED 0/3 → ALLOWED 3/3. |
| Review | Send for human review → receipt → reviewer approves → "Publishing locked" (demo) → ScorePlay record → Preview writeback (dry run) → one planned `POST /video/logs`, "Live write refused." |

**Click path** (labels as in the code at 04:30 UTC; the editor UI was being polished in parallel — rehearse once):
1. `/` → chip **Sell merchandise** → **Find opportunities** (~2 s live).
2. Moment 02 *Fans clap* → **Use this moment**.
3. **Check rights** → "Can't be used as planned · 0 of 3 uses allowed".
4. **Find a way to use it** (~1 s) → the editor: range track with the two marks, "What PULSE tried first — Rejected: …", "Suggested correction · Recommended: Slide 6".
5. Optional: **Compare** on "Use 0:23.5–0:30.4 of the same clip" to show the edit plan, then back.
6. **Use revised plan** → re-check → "Allowed under the demo policy · 3 of 3 uses" + Before/After.
7. **Send for human review** → **Open review** → (signed in beforehand) **Approve**.
8. **ScorePlay record** → **Preview writeback (dry run)** → planned call + "Live write refused."

Variant with a visible **edit plan** (S1-b, verified 04:25:53–04:26:04): choose the same-clip section instead of Slide 6 → campaign origin EDIT, "Edit plan — not rendered" → approve → writeback plan on media 130851320, 23.5–30.44 s.

**Risks:** moment ranking can shift if the index changes (the cards carry filename + timecode — pick by name). The crest interval is the union of two AI runs (9–11 s vs 9–14.5 s); say so if asked. Rehearse on a fresh server (production build or the preview) — a long-running dev server served stale wording after a `next build` (§1b). **Fallback:** pre-run tab via `?run=` link, `DEMO_REPLAY=true` (re-recorded 04:40 UTC for 8 scenarios incl. recovery searches), screenshots in `docs/design/screenshots/recovery/` (see `docs/pitch/CONTINGENCY.md`).

---

## Demo 2 — Global engagement: fix the plan, not the clip

| | |
|---|---|
| Goal | Chip **Grow engagement** → "Maximize global engagement from the Manchester United game". Plan: Editorial · GB, US, FR, ES, DE, IN, NG × 3 channels = 21 uses. |
| Moment | 01 Goal Slo Mo Man United 9x16 (A) v1 0:00–0:15. |
| Problem | Check rights → NEEDS_REVIEW, "21 uses checked: 6 allowed, 15 need review". Find a way to use it → scope CAMPAIGN: the demo licence covers GB, IE, US, CA, AU, NZ; another clip would hit the same rule. |
| Recommended | ADAPT_CAMPAIGN "Limit to licensed markets: GB, US" → re-check ALLOWED 6/6 (demo). |
| Why it matters | No AI evidence drives this verdict — territory is a plan fact. Most robust scenario. |

Clicks: **New campaign** → **Grow engagement** → **Find opportunities** → **Use this moment** (01) → **Check rights** → **Find a way to use it** → **Use revised plan**.

---

## Demo 3a — Sponsor: the rules change, the answer changes

| | |
|---|---|
| Goal | Chip **Activate a sponsor** → "Activate our sleeve sponsor with fans in the UK". Plan: Sponsored · GB · 3 channels. |
| Moment | 02 Goal Slo Mo 0:15–0:20. |
| Under "Tottenham Social Media Usage — Demo" | BLOCKED 0/3: kraken branding 15–46 s (second analysis run) is not a listed partner; Richarlison / Porro (AI-named) not on the ScorePlay squad. |
| Switch | **Change rules** → "Tottenham Commercial & Sponsor Usage — Demo" (Kraken = sleeve partner). Previous verdict shown as stale until re-checked. |
| Re-check | NEEDS_REVIEW 0/3 — only the AI-named players remain. |
| Recommended | SAFE_SECTION "Use 0:36.5–0:41.9 of the same clip" → ALLOWED 3/3 (demo). Trim rejected ("Removing every flagged part leaves no usable footage."). |

## Demo 3b — Mexico: the honest no

Chip **Open a new market** → "Sell more Spurs jerseys in Mexico" → Use this moment (01) → Check rights → BLOCKED 0/3 → Find a way to use it → headline "In the footage: Richarlison, Porro and the kraken logo (0:15.0–0:20.2) · In the plan: MX isn't licensed"; no-path message "No licensed path: Request additional usage rights for MX from the rights holder. A different clip or edit hits the same wall, and PULSE won't move the campaign elsewhere."; single option **Request additional usage rights**. Send for review is not offered; the API refuses submission (HTTP 400 at 04:26). Verified via API at 04:36 UTC (engine changed between 04:27 and 04:35: earlier it listed a rejected trim and three NOT_VIABLE replacements). Rehearse the on-screen state.

---

## Beat 2 alternative — Desk: a cut that works (verified in the UI ≈ 04:50 UTC, reported by DeskRecovery)

| | |
|---|---|
| Setup | `/desk` → search **solanke late goal** → select *solanke late goal.mp4* (ScorePlay 130851444; competition and publishing club prefilled from ScorePlay) → cut **0:10–0:19** → usage **SPONSORED**, territory GB, platform Instagram. Pre-stage everything up to here. |
| Problem | "BLOCKED · policy demo-tottenham-pl · v2026-10-23.1 · clearance NONE"; "DENY THFC-13 … 0:15.0–0:17.0, DHL (crest/kit or boards), 15–17 s" — source: TwelveLabs **second run** only. |
| Click 1 | **Find a way to use it** → recommended "Remove 0:14.5–0:17.5 · Allowed · demo policy · 1 of 1 · Kept 0:10.0–0:14.5, 0:17.5–0:19.0 · Result 6.0 s of 9.0 s · Edit plan — not rendered". |
| Click 2 | **Apply cut** → the desk re-decides each kept segment: **ALLOWED · DEMO** for both. |
| Say | "Here the cut works: 6 of 9 seconds survive, one jump cut, and the result is checked again — as an edit plan; nothing is rendered." |
| Evidence | API 04:27:13 UTC (`POST /api/recover`, 3 channels: trim ★ ALLOWED 3/3, "Keeps 6.0 s of 9.0 s (67%) with 1 jump cut"); screenshots `docs/design/screenshots/recovery/desk-desktop-recovery-panel.webp`, `desk-desktop-options.webp`, `desk-desktop-after-apply-cut.webp` (+ mobile). |
| Risk | Not re-run by me in the UI; rehearse once. Desk previews stay off. |

## What the jury must hear

- Real: ScorePlay assets/tags/squads, TwelveLabs moments + timestamps, two Pegasus runs (second one recorded, labelled CACHED "second run"), the deterministic re-checks, reviews, receipts, audit events.
- Fictional: every rule package, partner list and licensed market.
- Not done: no video is rendered (edit plans), no ScorePlay write (dry run), no previews, no sales attribution.
- Needs a human: every AI-identified brand or person.
