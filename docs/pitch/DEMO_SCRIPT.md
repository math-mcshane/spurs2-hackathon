# Demo script — 3 minutes, Studio (`/`)

Validated end to end in Chromium, signed in as reviewer, on the Vercel preview **https://spurs2-hackathon-o85fcxpxk-merlins-projects-2b20d832.vercel.app** (commit `2152135`, 2026-10-23 ≈ 14:05 UTC: Policy beat + use case 1 regression; the three use cases were validated ≈ 12:55 UTC on `inpdx7om5`, same code for those flows). Fallback preview: https://spurs2-hackathon-inpdx7om5-merlins-projects-2b20d832.vercel.app (no Policies link in the header, no sample mapping).

## What is real, what is illustrative (say it once, at 0:40)

The Rights panel shows one indicator — **Illustrative rules ⓘ** — whose panel lists the four limits: the rule set is written for this demo (not a club agreement, "Allowed" is not legal clearance); logos and people on screen are TwelveLabs machine observations, not human-verified; cuts are edit plans, not rendered files; ScorePlay writeback is a dry run. Everything else on screen — ScorePlay assets and tags, TwelveLabs moments and analysis, timecodes, the audit trail — is real.

## Before the jury (5 min)

1. Chrome, one window, zoom 100–110 %, the preview URL above on the goal screen.
2. **Reviewer sign-in** off the projector (`presenter` + passcode from `reroute/.reviewers.local.txt`). Signed in, moments play the real footage and photos show thumbnails; signed out, timecode placeholders.
3. Run use case 1 once end to end (warms caches), then **New goal**.
4. Backup tabs in a second window: use case 1 stopped at Compliance (after **Check rights**), use case 3 stopped at Resolution (after **Find a way to use it**).
5. Don't click **Find a way to use it** repeatedly in the last minute (10 per minute per IP).

## Use case 1 — Sponsor activation (0:00–1:50)

ScorePlay asset **130851444** "solanke late goal.mp4" ↔ TwelveLabs video 6ad91200968fe117efe706a5.

| Time | Click | Screen | Say |
|---|---|---|---|
| 0:00 | — | Goal screen | "Clubs don't lack content — they lack content they can safely use. PULSE turns a business goal into a campaign the club is allowed to run." |
| 0:10 | Chip **Sponsor a goal moment** → **Find opportunities** | ~7 s. "Searched only the 15 videos ScorePlay tags with Dominic Ayodele Solanke-Mitchell". Three playing moments; **moment 02 · solanke late goal · 0:09–0:20** | "Our goal: a sponsor post from Solanke's late goal for UK fans. ScorePlay knows which videos he's tagged in; TwelveLabs finds the exact seconds." |
| 0:30 | Moment 02 → **Use this moment** | Campaign draft: Sponsored · United Kingdom · Instagram, Facebook, X | "A campaign draft in one click." |
| 0:40 | **Check rights** | "Can’t be used as planned · 0 of 3 uses allowed" · Brands on screen: "DHL logo visible on the advertising hoardings behind the celebrating players (15–17 s)" — TwelveLabs video analysis · Illustrative rule THFC-13-partner-exclusivity. Point at **Illustrative rules ⓘ** | "A DHL board for two seconds, in a post for our sponsor. The rules here are illustrative — written for this demo — and the board is machine-observed. That's this indicator; everything else is real data." |
| 1:00 | **Find a way to use it** | Recommended **Remove 0:14.5–0:17.5** · before/after bars · Result 7.7 s of 10.7 s · Edit plan — not rendered · Independent re-check: Allowed · illustrative · 3 of 3 | "Same clip, same goal: cut exactly those seconds with a half-second margin. The cut is re-checked on its own." |
| 1:15 | **Use revised plan**, press ▶ on the player | "Allowed under these rules · 3 of 3 uses"; Before Blocked → After Allowed; player label "Edit plan preview · skips 14.5–17.5 s" — playback jumps the cut | "Watch it skip the board. An edit plan with exact timecodes — not a rendered file." |
| 1:30 | **Send for human review** → **Approve** | Receipt: Allowed · illustrative, 3 uses · 2 segments of ScorePlay 130851444; Approved by Demo presenter; **Publishing locked** | "A named person signs off, and the decision is a hash-chained audit record. Publishing stays locked — these aren't the club's real rules." |
| 1:42 | **ScorePlay record** → **Preview writeback (dry run)** | "Dry run — nothing is written to ScorePlay" · 2 timecoded logs for media 130851444 | "The decision would go back into ScorePlay as timecoded logs. Dry run today." |

## Use case 2 — Global engagement (1:50–2:30)

ScorePlay asset **130851421** "Goal Slo Mo Man United 9x16 (A) v1.mp4" 0:00–0:15 ↔ TwelveLabs 6ad911f32cc348c0bd20121c (#2 "player shooting just over the crossbar").

| Click | Screen | Say |
|---|---|---|
| **New goal** → chip **Grow engagement** → **Find opportunities** → moment 01 **Build campaign** → **Check rights** | "Not cleared for every use · 6 of 21 uses allowed · 7 markets" — FR, ES, DE, IN, NG not licensed | "Same club, a global goal. The clip is fine — the plan isn't: five markets aren't licensed." |
| **Find a way to use it** | Recommended **Limit to licensed markets: GB, US** (kept / dropped chips) | "Another clip would hit the same wall, so PULSE changes the plan, not the footage." |
| **Use revised plan** | "Allowed under these rules · 6 of 6 uses · 2 markets"; audience "Tottenham Hotspur supporters in United Kingdom and United States" | "Smallest valid change, re-checked." |

### Optional — Policy beat (replaces "Use revised plan" in use case 2, ~25 s)

From use case 2 at Compliance ("6 of 21 uses allowed"):

| Click | Screen | Say |
|---|---|---|
| Header **Policies** | Policy Center, "Back to your campaign", **Upload policy** drop zone | "The rules are data. A club can bring its own package." |
| **Use the example file** (or drop `tottenham-international-window.sample.json`) | "Tottenham International Window — Demo is in the library · Sample mapping" — "the example file's rules were mapped to PULSE's rule format in advance and validated. PULSE does not extract rules from legal documents." | "This is a sample mapping prepared in advance — we don't read contracts automatically." |
| **Use for my campaign** | Back in the campaign: rules "Tottenham International Window — Demo · Sample mapping", "Needs a fresh check" | "The old verdict is never reused." |
| **Check rights again** | "15 of 21 uses allowed" — only India and Nigeria remain | "Different rules, different answer — computed by the same engine." |

## Close (2:30–3:00)

> "Other tools tell you what you can't publish. PULSE finds a way to reach the goal anyway — a cut, a different market, or different footage — and shows exactly why, with every limit labelled. Plug in the club's real agreements and the same flow becomes a working rights desk."

## Optional fallback — Use case 3, Merchandise (replace use case 2 if needed)

ScorePlay asset **130851320** "Fans clap Man United A 9x16.mp4" 0:06.9–0:14.7 ↔ TwelveLabs 6ad911e365b4aff96dc7bacd → replacement ScorePlay **130851415** "Slide 6 - Away End Singing Pre-KO.mov" 0:01.1–0:08.9.

| Click | Screen | Say |
|---|---|---|
| **New goal** → chip **Sell merchandise** → **Find opportunities** → moment 02 **Fans clap Man United** → **Use this moment** → **Check rights** | "Can’t be used as planned · 0 of 3" — Player #18 (0:06.9–0:07.0, AI-named, not matched to the squad) and the Manchester United logo (0:09.0–0:14.5, both analysis runs) | "A Manchester United crest in a merchandise post." |
| **Find a way to use it** | "First, PULSE tried cutting the flagged footage — Rejected: it would leave 1.0 s of 7.8 s — below the 3.1 s minimum" · Recommended **Use "Slide 6 - Away End Singing Pre-KO.mov" 0:01.1–0:08.9** (search rank 2), re-checked Allowed · illustrative 3 of 3 | "Cutting would leave one second, so it rejects its own idea and finds another real clip from the library." |
| **Use revised plan** | "Allowed under these rules · 3 of 3 uses" | "Re-checked from scratch." |

## Wording

- Say "allowed under these rules" / "illustrative rules" — never "cleared", "legal", "approved for publication".
- Say "edit plan" for cuts, "dry run" for ScorePlay, "machine-observed" for TwelveLabs analysis.
- Say "sample mapping" for the imported example — never "PULSE read the contract".
- No revenue, conversion or time-saved numbers.
