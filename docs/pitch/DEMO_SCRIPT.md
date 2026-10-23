# Demo script — 3 minutes, Studio (`/`)

Rehearsed in Chromium as signed-in reviewer on the Vercel preview https://spurs2-hackathon-hi425s3gm-merlins-projects-2b20d832.vercel.app and on the local production build (`next start -p 3400`), 2026-10-23 ≈ 12:15–12:30 UTC. Both return the **same** flagship result (same cached Pegasus analysis — see [`CONTINGENCY.md`](CONTINGENCY.md)). Timings on the preview: moments ≈ 6 s, check rights 1.3 s, Find a way 3.4 s, apply 2.4 s.

## Before the jury (5 min)

1. Chrome, one window, zoom 100–110 %, `/` open on the preview (or a freshly started local production build). Header tag "Live club data · ScorePlay + TwelveLabs" visible.
2. **Reviewer sign-in** off the projector (header button, `presenter` + the NEW passcode from `reroute/.reviewers.local.txt`). Signed in, the Studio shows the real footage (TwelveLabs stream), ScorePlay thumbnails and photo thumbnails — reviewer-only, as confirmed with the organizers. Signed out it shows timecode placeholders.
3. Run the flagship once end to end (warms caches and the video player), then **New goal**.
4. Pre-run backup tabs in a second window (see [`CONTINGENCY.md`](CONTINGENCY.md)): flagship at Compliance and at Resolution, S2 at Compliance.
5. Don't click **Find a way to use it** more than a few times in the last minute (10 per minute per IP).

## 0:00–0:15 — Hook (no clicks)

> "Sports clubs don't have a content shortage. They have a content usage problem. We don't just detect a problem — we find a way to solve it."

## 0:15–2:00 — Flagship: a sponsor post from Solanke's late goal

| Time | Click | What appears | Say |
|---|---|---|---|
| 0:15 | Chip **Sponsor a goal moment** | Goal field: "Activate our sponsor with Solanke's late goal for UK fans" | "A commercial goal: a sponsor post from Solanke's late goal, for UK fans." |
| 0:20 | **Find opportunities** | ~6 s. "Searched only the 15 videos ScorePlay tags with **Dominic Ayodele Solanke-Mitchell**". Three playing moments; **moment 02 · solanke late goal · 0:09–0:20** | "ScorePlay knows which videos Solanke is tagged in; TwelveLabs finds the seconds inside them." |
| 0:35 | (optional) **Why this moment** on moment 02 | "#5 for 'player celebrating a goal with the sponsor logo on his shirt clearly visible'" · "The club's ScorePlay title names what the goal asks for (solanke, late, goal) (×2)" | "Video search plus the club's own naming — every factor shown." |
| 0:40 | Moment 02 → **Use this moment** | Campaign: Sponsored · United Kingdom · Instagram, Facebook, X · 10.7 s cut, player at 0:09 | "That's the moment. Can we post it for the sponsor?" |
| 0:45 | **Check rights** | "Can’t be used as planned · 0 of 3 uses allowed" — Brands on screen: "DHL logo visible on the advertising hoardings behind the celebrating players. (15–17 s)", *TwelveLabs video analysis*; rule THFC-13-partner-exclusivity | "No. A DHL board, 15 to 17 seconds, in a post for our sponsor — partner exclusivity. Found by video AI, not by a person." |
| 1:00 | **Find a way to use it** | **Recommended: Remove 0:14.5–0:17.5** · Before/After bars · "Result 7.7 s of 10.7 s" · **Edit plan — not rendered** · independent re-check "Allowed · demo policy · 3 of 3" | "Same clip, same goal. Cut those seconds with a half-second margin — nearly eight seconds of the goal remain — and the cut is re-checked on its own." |
| 1:15 | **Use revised plan**, then press ▶ on the player | "Allowed under the demo policy · 3 of 3 uses", Before Blocked 0/3 → After Allowed 3/3. Player chip "Plays the kept seconds, skips 14.5–17.5 s · edit plan, not a rendered file" — playback jumps over the DHL seconds | "Watch: it plays the kept seconds and jumps the cut. A preview of the plan — not a rendered file." |
| 1:35 | **Send for human review** | Receipt: Allowed · demo policy, demo-tottenham-pl v2026-10-23.1, "solanke late goal · 0:09.1–0:14.5" and "0:17.5–0:19.7 · ScorePlay 130851444" | "A person still signs off." |
| 1:45 | **Approve** | "Approved by Demo presenter" · "Publishing locked" | "Approved — and still not publishable: this is a demo rule set, not legal clearance." |
| 1:52 | **ScorePlay record** → **Preview writeback (dry run)** | "Dry run — nothing is written to ScorePlay"; `POST /video/logs`, 2 timecoded logs, review=APPROVED; "Live write refused." | "The decision goes back into ScorePlay as timecoded logs. Dry run today." |

## 2:00–2:40 — Territory: fix the plan, not the clip (S2)

**New goal** → chip **Grow engagement** → **Find opportunities** → moment 01 **Goal Slo Mo Man United** → **Build campaign** → **Check rights**: "Not cleared for every use · 6 of 21 uses allowed · 7 markets".

| Click | What appears | Say |
|---|---|---|
| **Find a way to use it** | Recommended "Limit to licensed markets: GB, US" (kept/dropped chips) | "Here the clip is fine — the plan isn't. Another clip would hit the same rule, so PULSE shrinks the plan to the licensed markets." |
| **Use revised plan** | "Allowed under the demo policy · 6 of 6 uses allowed · 2 markets" | "Smallest valid change. Same clip." |

## 2:40–3:00 — Close

> "Other tools identify what you can't publish. PULSE finds the best way to achieve your goal anyway — and shows exactly why. The rules are a demo package; the footage, the AI evidence and the audit trail are real."

## Don'ts

- Never say "cleared", "legal" or "live" about a demo verdict or a "Recorded data" tag.
- Never call the edit a video: it is an **edit plan, not rendered** (the player only skips the cut seconds).
- Never say a human checked the DHL board: it is AI-observed by two Pegasus runs, not visually verified.
- Never show footage while signed out and claim it's "blocked" — signed out it's just reviewer-only.
- No numbers about revenue, conversion or time saved.
