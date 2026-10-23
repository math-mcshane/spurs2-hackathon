# PULSE — Demo evidence (recovery engine)

What was checked, how, when, and with which data origin. All times UTC, **2026-10-23**. "Local" = the integration worktree's dev server (`:3300`), local Docker Supabase, live ScorePlay + TwelveLabs reads, previews off, `SCOREPLAY_WRITEBACK_MODE=dry-run`. Nothing in this pass wrote to ScorePlay, the shared Supabase project, any branch or any deployment.

Every ALLOWED below is **"Allowed under a demo policy — DEMO POLICY — NOT VERIFIED LEGAL CLEARANCE"**. `publishable` was `false` on every run.

## 0. How this pass was run

- Driver: direct calls to `POST /api/pulse/goal` (header `origin: http://localhost:3300`; every action after `run` carries `{id, expectedVersion}`), the same endpoint the Studio calls. Timings are wall-clock per HTTP call measured by the driver (server + local network), **not** UI timings.
- Reviewer: `POST /api/auth/session` as `presenter` (passcode read from the local reviewer file, never printed into any doc), then `POST /api/receipts/{id}/review`, `GET /api/writeback?receiptId=`.
- Desk engine: `POST /api/recover` (read-only, nothing persisted).
- Policy versions observed: `demo-tottenham-pl@2026-10-23.1`, `demo-tottenham-commercial@2026-10-23.1` (both `kind: DEMO`, `sourceType: PRESET`, `verified: false`).
- Data origin on every run: `dataOrigin.origin = LIVE` (header tag "Live club data · ScorePlay + TwelveLabs").
- Run ids below exist only in the local Supabase; on any other environment run the flows fresh.

## 1. Scenario results (re-verified 04:25–04:27 UTC)

| # | Goal (Studio chip) | Moment checked | Plan | First verdict | Recovery (★ = recommended) | After apply |
|---|---|---|---|---|---|---|
| S1 | "Promote Tottenham merchandise to UK supporters" (**Sell merchandise**) | Fans clap Man United A 9x16 (ScorePlay 130851320) 0:06.9–0:14.7 | Commercial · GB · Instagram/Facebook/X (3 uses) | **BLOCKED 0/3** | TRIM rejected (1.0 s of 7.8 s) → ★ REPLACE Slide 6 0:01.1–0:08.9 | **ALLOWED (demo) 3/3** |
| S1-b | same | same | same | BLOCKED 0/3 | SAFE_SECTION same clip 0:23.5–0:30.4 | **ALLOWED (demo) 3/3**, origin `EDIT`, "Edit plan — not rendered" → review APPROVED → dry-run writeback |
| S2 | "Maximize global engagement from the Manchester United game" (**Grow engagement**) | Goal Slo Mo Man United 9x16 (A) v1 (130851421) 0:00–0:14.8 | Editorial · 7 markets × 3 channels (21 uses) | **NEEDS_REVIEW 6/21** | ★ ADAPT_CAMPAIGN "Limit to licensed markets: GB, US" | **ALLOWED (demo) 6/6** |
| MX | "Sell more Spurs jerseys in Mexico" (**Open a new market**) | Goal Slo Mo (130851421) 0:14.8–0:20.2 | Commercial · MX · 3 channels | **BLOCKED 0/3** | 04:26: every option NOT_VIABLE + REQUEST_CLEARANCE · **04:36 (current engine): only REQUEST_CLEARANCE "Request additional usage rights"** — see §1a | submission refused (HTTP 400 at 04:26; `canSubmit` false at 04:36) |
| T | "Sell tickets for the next home game" (**Sell tickets**) | Slide 18 (130851438) 0:00–0:06.9; Slide 6 (130851415) 0:00–0:10.1 | Commercial · GB · 3 channels | **ALLOWED (demo) 3/3** both | none needed | — |
| SP | "Activate our sleeve sponsor with fans in the UK" (**Activate a sponsor**) | Goal Slo Mo (130851421) 0:14.8–0:20.2 | Sponsored · GB · 3 channels | **BLOCKED 0/3** (Social package) → package switch → **NEEDS_REVIEW 0/3** | ★ SAFE_SECTION same clip 0:36.5–0:41.9 | **ALLOWED (demo) 3/3** |
| D | Desk engine `POST /api/recover`: solanke late goal.mp4 (130851444) 0:10–0:19 | — | Sponsored · GB · 3 channels | **0/3** (DHL board 0:15–0:17) | ★ TRIM "Remove 0:14.5–0:17.5" keeps 6.0 s → ALLOWED (demo) 3/3 | read-only API; desk UI not verified in this pass |

### §1a — Re-check after an engine change (04:35–04:36 UTC)

Between 04:27 and 04:35 another agent changed `lib/rights/recovery/plan.ts` (licence-gap handling; the dev server briefly failed to compile at ≈ 04:28). The scenario re-runs at 04:35–04:36 UTC show:

| Scenario | UTC | Verdict | Recovery (current engine) | Changed vs 04:25–04:27? |
|---|---|---|---|---|
| S1 | 04:35:58 | BLOCKED (check 0.20 s, find 0.84 s) | problem headline now **"In the footage: Player #18 (0:06.9–0:07.0); the Manchester United logo (0:09.0–0:14.5)"**; same 7 options, same outcomes, trim rejected with the same text, ★ replace-3 Slide 6 | headline wording only |
| MX | 04:36:00 | BLOCKED (0.20 s / 0.22 s) | scope MIXED, headline **"In the footage: Richarlison, Porro and the kraken logo (0:15.0–0:20.2) · In the plan: MX isn't licensed"**; **only option: request_clearance-1 "Request additional usage rights" (NEXT_STEP)** — no trim or replacement is generated any more; `noPathMessage` "No licensed path: Request additional usage rights for MX from the rights holder. A different clip or edit hits the same wall, and PULSE won't move the campaign elsewhere."; `canSubmit` false | **yes** — the "What PULSE tried" list (trim + 3 NOT_VIABLE replacements) no longer appears |
| S2 | 04:36:02 | NEEDS_REVIEW (0.21 s / 0.25 s) | headline "In the plan: FR, ES, DE, IN, NG aren't licensed"; ★ "Limit to licensed markets: GB, US" ALLOWED 6/6; request_clearance-2 now titled "Request additional usage rights" | wording only |
| SP | 04:36:10–13 | BLOCKED → setPolicy (`current: false`) → NEEDS_REVIEW 0/3 → ★ SAFE_SECTION 0:36.5–0:41.9 → **ALLOWED / DEMO** | headline "In the footage: Richarlison and Porro (0:15.0–0:20.2)"; same options/outcomes | wording only |
| T | 04:36:13 | Slide 18 **ALLOWED / DEMO 3/3** | — | no |

### S1 — Merch: the cut is tried first, rejected, then a replacement (run `goal-126f6106-71e2-4925-a1c1-8e9bdcfc5bbc`)

| UTC | Action | Time | Observed |
|---|---|---|---|
| 04:25:19 | `run` | 2.12 s (`timing.toProposalSec` 2) | 3 moments: `130851438@0–6.93` (Slide 18 Away End FT), `130851320@6.87–14.67` (Fans clap), `130851415@0–10.07` (Slide 6). Policy "Tottenham Social Media Usage — Demo" `demo-tottenham-pl@2026-10-23.1`. Fans clap card: "TwelveLabs found this 8-second moment at 0:07–0:15 … (#3 for 'players applauding the travelling fans after the match', #9 for 'fans in the stands celebrating in football shirts and scarves')". Link Δ 0.002 s. |
| 04:25:27 | `select` Fans clap | 0.08 s | campaign v2 |
| 04:25:27 | `checkRights` | 0.31 s | **BLOCKED**, clearance NONE, "3 uses checked: 0 allowed, 0 need review, 3 blocked." Issues: *Sponsors and brands on screen* DENY — "Manchester United (crest/kit or boards), 9–11 s; Manchester United (crest/kit or boards), 9–14.5 s"; *People on screen* MISSING — "Player #18 isn't on Tottenham Hotspur's registered squad in ScorePlay …" |
| 04:25:30 | `findRecovery` | 1.56 s | scope CLIP, "Can't be used as planned · 0 of 3 uses allowed". Problems: Player #18 at 0:06.9–0:07.0 (source "TwelveLabs video analysis"); Manchester United at 0:09.0–0:14.5 (source "TwelveLabs video analysis + TwelveLabs video analysis — second run (recorded 23 Oct 2026)"). Options below. |
| 04:25:44 | `applyRecovery replace-3` | 0.32 s | **ALLOWED / DEMO 3/3**, evaluation kind ALTERNATIVE, campaign v3. `beforeAfter`: BLOCKED 0/3 (Fans clap) → ALLOWED 3/3 (Slide 6 0:01.133–8.933). Evaluation chain `ORIGINAL v2 BLOCKED/NONE → ALTERNATIVE v3 ALLOWED/DEMO`. `canSubmit` true, `publishable` false. |

Options returned by `findRecovery` (order as served; every verdict is the engine's own re-check for all 3 uses):

| id | Kind | Title | Outcome | Re-check |
|---|---|---|---|---|
| replace-3 ★ | REPLACE | Use "Slide 6 - Away End Singing Pre-KO.mov" 0:01.1–0:08.9 (search #2) | RESOLVES_DEMO | ALLOWED 3/3 |
| replace-4 | REPLACE | Use "Limbs Man United 9x16 (A) v2.mp4" 0:02.9–0:10.7 (search #3) | RESOLVES_DEMO | ALLOWED 3/3 |
| safe_section-2 | SAFE_SECTION | Use 0:23.5–0:30.4 of the same clip — "8.8 s away from the moment search found — search did not match this section to the goal; check it fits the story." Trade-off "6.9 s instead of 7.8 s, one continuous shot." | RESOLVES_DEMO | ALLOWED 3/3 |
| replace-5 | REPLACE | Use "Slide 19 - Players Clapping Fans.mov" 0:00.0–0:07.8 (search #4) | NEEDS_REVIEW | 0/3 — "Player #16 isn't on Tottenham Hotspur's registered squad …" |
| change_usage-6 | CHANGE_USAGE | Post it as organic club content — `changesGoal: true` ("no shop link or partner placement") | RESOLVES_DEMO | ALLOWED 3/3 |
| trim-1 | TRIM | Remove 2 flagged parts (0:06.9–0:07.5, 0:08.5–0:14.7) — EDL keeps 0:07.5–0:08.5, `PLAN_NOT_RENDERED` | **NOT_VIABLE** | "Trim rejected: it would leave 1.0 s of 7.8 s — below the 3.1 s minimum for this post." `applicable: false` |
| request_clearance-7 | REQUEST_CLEARANCE | Ask the rights team for clearance (Player #18; Manchester United) | NEXT_STEP | `applicable: false` |

### S1-b — Edited cut → review → dry-run writeback (run `goal-78835981-d4ee-4cb3-9521-09aef7b11578`)

| UTC | Action | Time | Observed |
|---|---|---|---|
| 04:25:50 | `run` | 1.24 s | same 3 moments |
| 04:25:52 | `select` Fans clap + `checkRights` | 0.03 s + 0.20 s | BLOCKED 0/3 |
| 04:25:52 | `findRecovery` | 0.86 s | same 7 options |
| 04:25:53 | `applyRecovery safe_section-2` | 0.19 s | ALLOWED / DEMO 3/3; campaign v3 origin **EDIT**; `edit.executionLabel` "Edit plan — not rendered", EDL `…:v2:section` retained 23.5–30.44 → output 0–6.94 s |
| 04:25:57 | `submitForReview` | 0.10 s | receipt `84e91007-9579-41ba-b9a6-b78c0c3cb930`, reviewStatus PENDING, `canSubmit` false |
| 04:26:01 | sign-in + `POST /api/receipts/{id}/review` APPROVED | 0.05 s + 0.04 s | `humanReviewStatus` APPROVED, review "APPROVED · Demo presenter · 2026-10-23T04:26:01.055Z" |
| 04:26:04 | `GET /api/writeback?receiptId=` | 0.03 s | mode **DRY_RUN**, 1 planned `POST /video/logs`: `media_id` 130851320, `start_offset` 23.5, `end_offset` 30.44, comment begins "REROUTE receipt 84e91007… \| DEMO POLICY — NOT VERIFIED LEGAL CLEARANCE \| simulated-status=ALLOWED (informational, not a clearance) \| clearance=DEMO \| policy=demo-tottenham-pl@2026-10-23.1 (DEMO) \| segment=23.50-30.44s \| review=APPROVED by Demo presenter …". `refusedReason`: "Demo policy demo-tottenham-pl@2026-10-23.1: DEMO POLICY — NOT VERIFIED LEGAL CLEARANCE. Demo results are never written to ScorePlay as metadata." (UI renders it after "Live write refused."). 0 URLs in the payload. |
| 04:26:0x | `GET /api/pulse/goal?id=` (reload) | 0.03 s | state restored: reviewStatus APPROVED, rights ALLOWED, origin EDIT, "Edit plan — not rendered", `publishable` false, publishNote "DEMO POLICY — NOT VERIFIED LEGAL CLEARANCE — never publishable, even after approval." |

### S2 — Global engagement → licensed markets (run `goal-62d86ec6-84e0-45ca-8697-e8ebd0833250`)

| UTC | Action | Time | Observed |
|---|---|---|---|
| 04:26:11 | `run` | 1.23 s | moments: Goal Slo Mo 0:00–0:14.8; Full Match 79:12–79:17 (4752.1–4757.1 s); 9x16_MNU_1_1_TOT_HIGHLIGHTS 0:00–0:07.9. Plan Editorial · GLOBAL · GB, US, FR, ES, DE, IN, NG × Instagram/Facebook/X |
| 04:26:17 | `select` #1 + `checkRights` | 0.03 s + 0.31 s | **NEEDS_REVIEW** — "21 uses checked: 6 allowed, 15 need review, 0 blocked." |
| 04:26:17 | `findRecovery` | 0.22 s | scope **CAMPAIGN**, "Not cleared for every use · 6 of 21 uses allowed"; options: adapt_campaign-1 ★ "Limit to licensed markets: GB, US" → RESOLVES_DEMO ALLOWED 6/6; request_clearance-2 NEXT_STEP |
| 04:26:20 | `applyRecovery adapt_campaign-1` | 0.21 s | **ALLOWED / DEMO 6/6**, campaign origin REMEDY; `beforeAfter` NEEDS_REVIEW 6/21 → ALLOWED 6/6, same clip |

### MX — Licence gap, honest no (run `goal-d9179aed-831a-4e2e-84ca-2a238f9d6467`; engine output superseded at 04:36 — see §1a)

| UTC | Action | Time | Observed |
|---|---|---|---|
| 04:26:21 | `run` (club tottenham) | 0.99 s | moments: Goal Slo Mo 0:14.8–0:20.2; Full Match 94:07–94:13; Slide 4 - Dad with his boy 0:00–0:05.7. Plan Commercial · MX |
| 04:26:25 | `select` #1 + `checkRights` | 0.02 s + 0.37 s | **BLOCKED** — "3 uses checked: 0 allowed, 0 need review, 3 blocked." |
| 04:26:26 | `findRecovery` | 0.91 s | scope **MIXED**. Problems: Richarlison, Porro, kraken at 0:15.0–0:20.2 (sources: product run + second run) and "Not licensed: territory MX is not licensed (licensed: GB, IE, US, CA, AU, NZ)". Options: trim-1 NOT_VIABLE "Removing every flagged part leaves no usable footage."; replace-2/3/4 (16x9 KEY HIGHLIGHTS 1:54.7–2:00.1 BLOCKED; Goal Man United 0:24.4–0:29.8 NEEDS_REVIEW; Extended Highlights 6:39.7–6:45.1 BLOCKED) all **NOT_VIABLE** "Changing the footage can't fix a missing licence — Not licensed: territory MX is not licensed …"; request_clearance-5 "Request additional usage rights" NEXT_STEP. `canSubmit` false. nextStep "No licence covers Mexico (MX) — request a licence before review. Request a licence — we won't move your campaign to other markets." |
| 04:26:2x | `submitForReview` | — | **HTTP 400** "REROUTE blocked this campaign; a blocked campaign cannot be submitted. Find another way first." |

### T — Tickets, clean pass (no manufactured violation)

| UTC | Action | Time | Observed |
|---|---|---|---|
| 04:26:31 | `run` | 1.41 s | moments: Slide 18 0:00–0:06.9, Slide 6 0:00–0:10.1, Fans clap 0:06.9–0:14.7. Plan Commercial · GB (home territory: "No market in the objective: the club's home territory (GB).") |
| 04:26:35 | Slide 18 `checkRights` | 0.18 s | **ALLOWED / DEMO 3/3** |
| 04:26:37 | (fresh run) Slide 6 `checkRights` | 0.17 s | **ALLOWED / DEMO 3/3** |

### SP — Sponsor + policy package switch (run `goal-cb8f8b99-38a0-4e3b-8050-288cdce8ee71`)

| UTC | Action | Time | Observed |
|---|---|---|---|
| 04:26:39 | `run` | 0.84 s | moments: Slide 18, Goal Slo Mo 0:14.8–0:20.2, Fans clap. Plan **Sponsored** · GB. Package `demo-tottenham-pl` |
| 04:26:43 | `select` Goal Slo Mo + `checkRights` | 0.05 s + 0.20 s | **BLOCKED 0/3**. DENY "Third-party branding on screen: kraken (crest/kit or boards), 15–46 s"; MISSING "Richarlison … Porro isn't on Tottenham Hotspur's registered squad in ScorePlay …" |
| 04:26:43 | `setPolicy demo-tottenham-commercial` | 0.04 s | policy "Tottenham Commercial & Sponsor Usage — Demo" `@2026-10-23.1`; previous verdict kept but `rights.current: false` (stale) |
| 04:26:48 | `checkRights` | 0.32 s | **NEEDS_REVIEW** — "3 uses checked: 0 allowed, 3 need review, 0 blocked." Only issue left: People on screen MISSING (Richarlison, Porro — AI-named, not on the ScorePlay squad) |
| 04:26:48 | `findRecovery` | 0.93 s | scope CLIP: safe_section-2 ★ "Use 0:36.5–0:41.9 of the same clip" ALLOWED 3/3; replace-4 Goal Man United 0:24.4–0:29.8 NEEDS_REVIEW; change_usage-6 ALLOWED 3/3 (changes goal); trim-1 NOT_VIABLE "Removing every flagged part leaves no usable footage."; replace-3 / replace-5 STILL_BLOCKED 0/3; request_clearance-7 NEXT_STEP |
| 04:26:53 | `applyRecovery safe_section-2` | 0.34 s | **ALLOWED / DEMO 3/3**. Evaluation chain `ORIGINAL v2 BLOCKED → ORIGINAL v2 NEEDS_REVIEW (new package) → ALTERNATIVE v3 ALLOWED` |

### D — A trim that succeeds (desk engine, read-only API)

`POST /api/recover` at **04:27:13** (4.05 s): `solanke late goal.mp4` (130851444) 0:10–0:19, Sponsored · GB · Instagram/Facebook/X, package `demo-tottenham-pl` (club default).

- Problem: "DHL at 0:15.0–0:17.0: Sales and sponsored posts can't show other brands …" — source **"TwelveLabs video analysis — second run (recorded 23 Oct 2026)"** only.
- trim-1 ★ "Remove 0:14.5–0:17.5" → RESOLVES_DEMO **ALLOWED 3/3**, "Keeps 6.0 s of 9.0 s (67%) with 1 jump cut. Cut points come from AI timestamps — a reviewer confirms them on the render."
- safe_section-2 "Use 0:09.5–0:14.5" ALLOWED 3/3; replace-3 9x16_MNU_1_1_TOT_HIGHLIGHTS 1:48.8–1:57.8 ALLOWED 3/3; change_usage-6 ALLOWED 3/3; replace-4 (Slide 1 - Goal) and replace-5 STILL_BLOCKED; request_clearance-7 NEXT_STEP.
- **Not verified:** the `/desk` UI path for this flow (being wired by another agent at the time of this pass).

## 2. Assets and mapping

From the 03:03 inventory (not re-run in this pass; the S1 Fans clap Δ 0.002 s was re-observed in the 04:25 run).

| Role | Filename | ScorePlay id | Duration (SP) | Δ s | Mapping |
|---|---|---|---|---|---|
| S1 original | Fans clap Man United A 9x16.mp4 | 130851320 | 30.44 | 0.002 | FILENAME_DURATION, unique |
| S1 replacement ★ | Slide 6 - Away End Singing Pre-KO.mov | 130851415 | 10.04 | 0.006 | FILENAME_DURATION, unique |
| S1 replacement | Limbs Man United 9x16 (A) v2.mp4 | 130851427 | 17.20 | 0.016 | FILENAME_DURATION, unique |
| S1 replacement (review) | Slide 19 - Players Clapping Fans.mov | 130851439 | 15.28 | 0.014 | FILENAME_DURATION, unique |
| S1 / T moment | Slide 18 - Away End FT.mov | 130851438 | 6.96 | 0.014 | FILENAME_DURATION, unique |
| S2 / MX / SP moment | Goal Slo Mo Man United 9x16 (A) v1.mp4 | 130851421 | 45.96 | 0.013 | FILENAME_DURATION, unique |
| D | solanke late goal.mp4 | 130851444 | — | — | linked (58/58 Tottenham videos linked) |

TwelveLabs video ids are in the receipt's "Identifiers and audit trail" section in the app.

## 3. AI observations behind the verdicts, by run

The engine loads **every** analysis run for an asset: the product's own Pegasus run (live, then served from the observation cache) and the **second, independent Pegasus run** recorded during the 2026-10-23 audit (54 videos / 444 observations, bundled as CACHED evidence and labelled "second run"). Restrictions are localized on the union of both.

| Clip / window | Product run | Second run | Effect |
|---|---|---|---|
| Fans clap 0:06.9–0:14.7 | Manchester United crest on hoarding 9–11 s; player #18 (shorts) at the window start | Manchester United crest 9–14.5 s; #18 | union 9–14.5 s → trim leaves 1.0 s → rejected |
| Goal Slo Mo 0:14.8–0:20.2 | AI-named Richarlison, Porro | kraken 15–46 s | Social package: DENY (kraken not a listed partner) + MISSING; Commercial package: kraken is the sleeve partner → only the players remain |
| solanke late goal 0:10–0:19 | — | DHL board 15–17 s | trim with ±0.5 s margin → ALLOWED |
| Slide 6 0:01.1–0:08.9, Limbs 0:02.9–0:10.7 | no players, no third-party brand | same (03:0x audit) | replacements ALLOWED |
| Slide 19 0:00–0:07.8 | shirt numbers incl. #16 | same | NEEDS_REVIEW (numbers ≠ names) |

**No human has verified any of these observations.** Every AI-identified brand or person is evidence for review, never a licence.

## 4. Tests

- **04:35:46 UTC:** `cd reroute && pnpm exec vitest run` → **405 passed · 15 skipped (420)**, 32 files passed, 1 skipped. `src/lib/rights/recovery/recovery.test.ts`: **20 passed**.
- Earlier, 04:27 UTC (mid-refactor by another agent): 5 failed · 382 passed · 15 skipped (402) in `resolver.test.ts` / `preview.test.ts` (removed `/api/resolve`). Superseded by the run above. Other agents were still editing — re-run once more before the presentation and cite that number.

At ≈ 04:28 UTC the dev server briefly failed to compile (in-flight `plan.ts` edit); all §1 flows were recorded before that and §1a after it.

**Audit chain** (`GET /api/receipts/84e91007-9579-41ba-b9a6-b78c0c3cb930`, 04:35:35 UTC): 2 events for the receipt — `RECEIPT_CREATED` (actor `pulse-studio`, 04:25) and `REVIEW_RECORDED` (actor "Demo presenter", 04:26), each with `prevHash` + `hash`. The chain is global (event ids 796 and 798; `prevHash` links to the previous event in the whole log, not the previous event of this receipt).

**Policy Center** (`GET /api/policies?club=tottenham`, 04:35:35 UTC): `demo-tottenham-pl` "Tottenham Social Media Usage — Demo" (DEMO, workspace default) and `demo-tottenham-commercial` "Tottenham Commercial & Sponsor Usage — Demo" (DEMO); defaults `tottenham → demo-tottenham-pl`, `spurs → demo-spurs-fr-sponsored`. JSON upload and PDF refusal were **not** re-exercised in this pass (code: PDF/DOCX/TXT/CSV → 422 "Only JSON rule packages can be imported. Contract (PDF) extraction is not supported in this build.").

## 5. No protected footage exposed

- Writeback preview JSON (04:26:04): 0 `http(s)://` strings.
- Earlier audit (03:2x, not re-run): `/api/assets` and `/api/decide` responses carried 0 URLs; every moment shows "Preview off · awaiting playback rights".
- This document contains no media URLs, tokens or passcodes.

## 6. Real, cached, simulated, fictional

| Element | Status |
|---|---|
| ScorePlay assets, tags, squads | Real, live, read-only |
| ScorePlay ↔ TwelveLabs links | Real (filename + duration, unique both ways) |
| Marengo moments and timestamps | Real, live |
| Pegasus product run | Real AI output, served from the observation cache after first analysis |
| Pegasus second run | Real AI output recorded 2026-10-23, served as CACHED evidence labelled "second run" |
| Rights packages (Social, Commercial & Sponsor, Spurs Media), partner lists, licensed markets | **Fictional (DEMO)** |
| Recovery options and re-checks | Real deterministic engine on fictional rules |
| Edits (TRIM / SAFE_SECTION) | **Edit plans, not rendered** |
| Reviews, receipts, evaluation chain, audit events | Real records (local Supabase) |
| ScorePlay writeback | Dry run only |
| Video previews | Off |
| Sales attribution | Not connected |

## 7. Needs human verification before any claim beyond "demo"

1. Manchester United crest at 0:09–0:14.5 and player #18 in Fans clap (AI only; the two runs disagree on the crest's end, 11 s vs 14.5 s).
2. Slide 6 / Limbs replacements: no identifiable player, no third-party brand (AI only).
3. Kraken at 15–46 s and DHL at 15–17 s (second run only).
4. AI-named players (Richarlison, Porro) — not on the ScorePlay squad list, so the engine treats them as unknown people.
5. That the SAFE_SECTION 0:23.5–0:30.4 fits the story — search did not match it to the goal (flagged in the option itself).

## 8. Side effects of this pass

- Local Supabase only: ~12 goal runs, their campaigns, evaluations, recovery plans, 1 receipt + 1 review (`84e91007…`), audit events.
- TwelveLabs: Marengo searches from `run` / `findRecovery`; no new Pegasus analysis was observed (all checks < 0.4 s).
- ScorePlay: reads only. No write.
- No code, policy or config change.
