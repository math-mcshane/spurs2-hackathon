# Demo script — 3 minutes, Studio (`/`)

Flagship rehearsed end to end in Chromium on a fresh production build (`next start`, local Supabase) at 2026-10-23 ≈ 11:41–11:46 UTC, twice: moments 5.0 s / 7.6 s (cold), check rights < 1 s, Find a way 1.4 s, apply < 1 s, review + approve + writeback dry run < 4 s. S2 and S1 walked through in the same session (≈ 11:43–11:44 UTC). Screenshots: `docs/design/screenshots/recovery/flagship-0*.webp`, `global-0*.webp`, `merch-01-replacement-allowed.webp`.

## Before the jury (5 min)

1. Chrome, one window, zoom 100–110 %, `/` open on a **freshly started** server (production build or the preview). Header tag "Live club data · ScorePlay + TwelveLabs" visible.
2. **Reviewer sign-in** once, off the projector (header button). The passcode never goes on screen.
3. Run the flagship once end to end on the presenting environment (warms the ScorePlay/TwelveLabs caches; first analysis of a clip can take up to ~70 s, then < 1 s). Then click **New goal**.
4. Pre-run backup tabs in a second window (see [`CONTINGENCY.md`](CONTINGENCY.md)): flagship at Resolution, S2 at Compliance, S1 at Resolution.
5. Don't click **Find a way to use it** more than a few times in the last minute before presenting (10 per minute per IP).
6. Never run `next build` while `next dev` serves the demo; after any build, restart. (A long-running dev server served stale code twice today.)

## 0:00–0:15 — Hook (no clicks)

> "Sports clubs don't have a content shortage. They have a content usage problem. We don't just detect a problem — we find a way to solve it."

## 0:15–1:55 — Flagship: a sponsor post from Solanke's late goal

| Time | Click | What appears | Say |
|---|---|---|---|
| 0:15 | Chip **Sponsor a goal moment** | Goal field: "Activate our sponsor with Solanke's late goal for UK fans" · Tottenham | "A commercial goal: a sponsor post from Solanke's late goal, for UK fans." |
| 0:20 | **Find opportunities** | ~5 s. "Searched only the 15 videos ScorePlay tags with **Dominic Ayodele Solanke-Mitchell**, the player your goal names." Three moments; **Moment 02 · solanke late goal · 0:09–0:20** | "ScorePlay knows which videos Solanke is tagged in; TwelveLabs finds the seconds inside them." |
| 0:35 | (optional) **Why this moment** on moment 02 | "#5 for 'player celebrating a goal with the sponsor logo on his shirt clearly visible'" · "The club's ScorePlay title names what the goal asks for (solanke, late, goal) (×2)" | "Video search plus the club's own naming. Every factor is shown." |
| 0:40 | Moment 02 → **Use this moment** | Campaign: Sponsored · United Kingdom · Instagram, Facebook, X · 10.7 s cut | "It's the moment we want. Can we post it for the sponsor?" |
| 0:45 | **Check rights** | "Can’t be used as planned · 0 of 3 uses allowed" — Brands on screen: "DHL logo visible on the LED advertising boards … (15–17 s)" *TwelveLabs video analysis — second run (recorded 23 Oct 2026)*; rule THFC-13-partner-exclusivity. People on screen: "Tonali … number 16" (19–23 s), AI identification, a reviewer must confirm | "No. A DHL board for two seconds — in a post for our sponsor, under a partner-exclusivity rule. And a player the AI named who isn't on this asset's ScorePlay tags." |
| 1:00 | **Find a way to use it** | Range track with the two marks. **Recommended: Remove 2 flagged parts (0:14.5–0:17.5, 0:18.5–0:19.7)** — Before/After bars, "Result 6.4 s of 10.7 s", **Edit plan — not rendered**, Independent re-check "Allowed · demo policy · 3 of 3" | "Same clip, same goal. Cut the restricted seconds with a half-second margin — six seconds of the goal remain — and the cut is re-checked on its own." |
| 1:15 | (optional) point at **Other ways** | Safe section 0:09.5–0:14.5 (allowed) · replacements (still blocked) · organic post (changes the goal) · ask the rights team | "Every alternative carries the engine's own verdict." |
| 1:20 | **Use revised plan** | New campaign version; "Allowed under the demo policy · 3 of 3 uses"; Before Blocked 0/3 → After Allowed 3/3; "Edited cut · 6.4 s of 10.7 s" | "A new version, checked from scratch — not assumed." |
| 1:30 | **Send for human review** | Rights decision record: Allowed · demo policy, policy demo-tottenham-pl v2026-10-23.1, media "solanke late goal · 0:09.1–0:14.5" and "0:17.5–0:18.5 · ScorePlay 130851444" | "A person still signs off." |
| 1:40 | **Approve** | "Approved by Demo presenter" · "Publishing locked" | "Approved — and still not publishable, because this is a demo rule set." |
| 1:47 | **ScorePlay record** → **Preview writeback (dry run)** | "Dry run — nothing is written to ScorePlay"; `POST /video/logs`, 2 timecoded logs on media 130851444, review=APPROVED; "Live write refused." | "The decision goes back into ScorePlay as timecoded logs. Dry run today." |

## 1:55–2:30 — Second beat: fix the plan, not the clip (S2)

**New goal** → chip **Grow engagement** → **Find opportunities** → moment 01 **Goal Slo Mo Man United** → **Build campaign** → **Check rights**: "Not cleared for every use · 6 of 21 uses allowed · 7 markets".

| Click | What appears | Say |
|---|---|---|
| **Find a way to use it** | Recommended "Limit to licensed markets: GB, US", kept/dropped chips, re-check "6 of 6" | "Here the clip is fine — the plan isn't. Another clip would hit the same rule, so PULSE changes the plan." |
| (optional, rules change) **Change rules** → **Tottenham International Window — Demo** (uploaded) → **Check rights again** | "Needs a fresh check" → "15 of 21 uses allowed" (only IN, NG remain) | "Upload different rules, and the answer changes — the old verdict is never reused." |

On the Vercel preview only the three presets exist (no upload there) — skip the optional step, or use **Tottenham Commercial & Sponsor Usage — Demo**.

## 2:30–2:50 — Fallback beat if time allows: S1 merch (replacement)

Chip **Sell merchandise** → moment 02 **Fans clap Man United** → **Check rights** (Blocked 0/3) → **Find a way to use it**: "What PULSE tried first — Remove 2 flagged parts … Rejected: it would leave 1.0 s of 7.8 s" → recommended "Use Slide 6 - Away End Singing Pre-KO.mov 0:01.1–0:08.9", re-checked Allowed 3/3. Say: "When cutting would leave nothing, it rejects its own cut and finds another real moment."

## 2:50–3:00 — Close

> "Other tools identify what you can't publish. PULSE finds the best way to achieve your goal anyway — and shows exactly why. The rules are a demo package; the footage, the AI evidence and the audit trail are real."

## Don'ts

- Never say "cleared", "legal" or "live" about a demo verdict or a CACHED badge.
- Never call the edit a video: it is an **edit plan, not rendered**.
- Never say a human checked the DHL board: it is AI-observed (second Pegasus run), not visually verified.
- No numbers about revenue, conversion or time saved.
