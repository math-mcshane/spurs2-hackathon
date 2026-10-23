# Demo script — 3 minutes, Studio (`/`)

Flows and outputs re-verified via the API at 2026-10-23 04:25–04:27 UTC ([`../demo/DEMO_EVIDENCE.md`](../demo/DEMO_EVIDENCE.md)). Button labels are from the code at ≈ 04:30 UTC; the compliance editor was being polished in parallel — **do one full UI rehearsal and fix any label below that changed.**

## Before the jury (5 min)

1. Chrome, one window, zoom 100–110 %, `/` open, data-origin badge visible.
2. **Sign in as reviewer** once (Review step, any receipt) — the passcode never goes on the projector.
3. Pre-run backup tabs (see [`CONTINGENCY.md`](CONTINGENCY.md)): S1 at the Resolution step, S2 at Compliance, Sponsor at Compliance, Mexico at Resolution. Keep them in a second window.
4. Run S1 once end-to-end on this environment so every analysis is cached (first analysis of a clip can take up to ~70 s; cached checks took 0.2–0.4 s).

## 0:00–0:15 — Hook (no clicks)

> "Sports clubs don't have a content shortage. They have a content usage problem. We don't just detect a problem — we find a way to solve it."

## 0:15–2:05 — S1: merch, the full beat

| Time | Click | What appears | Say |
|---|---|---|---|
| 0:15 | Chip **Sell merchandise** | Goal field: "Promote Tottenham merchandise to UK supporters" · Tottenham | "A real goal from a club's commercial team." |
| 0:20 | **Find opportunities** | ~2 s, three real moments from the club's ScorePlay library, each with TwelveLabs timestamps: Slide 18 · **Fans clap Man United 0:07–0:15** · Slide 6 | "Real footage, real timestamps — linked one-to-one to ScorePlay assets." |
| 0:35 | On **Fans clap** → **Use this moment** | Campaign: Commercial · United Kingdom · Instagram, Facebook, X | "It's the best emotional moment. Can we use it?" |
| 0:40 | **Check rights** | "Can't be used as planned · 0 of 3 uses allowed" | "No — and here's why." |
| 0:45 | **Find a way to use it** | Editor: range track with two marks — **Player #18 at 0:06.9** (TwelveLabs; only a shirt number, not on the ScorePlay squad) and **Manchester United crest at 0:09.0–0:14.5** (partner exclusivity, demo rule) | "PULSE knows *where* in the clip the problem is, and which rule it breaks." |
| 1:00 | Point at **What PULSE tried first** | "Remove 2 flagged parts … **Rejected:** it would leave 1.0 s of 7.8 s — below the 3.1 s minimum for this post." | "First it tried the obvious fix — cut the bad seconds. One second of footage isn't a post, so it rejected its own idea." |
| 1:10 | Point at **Suggested correction · Recommended** | "Use Slide 6 - Away End Singing Pre-KO 0:01.1–0:08.9" — independently re-checked, allowed for 3 of 3 uses (demo) | "So it found another real moment for the same goal — and re-checked it before showing it." |
| 1:15 | (Optional, 5 s) glance at **Other ways** | Limbs Man United allowed · same clip 0:23.5–0:30.4 allowed but flagged "search did not match this section to the goal" · Slide 19 needs review · organic post (changes the goal) · ask the rights team | "Every option carries the engine's own verdict, including the ones it doesn't recommend." |
| 1:25 | **Use revised plan** | New campaign version, re-check: "Allowed under the demo policy · 3 of 3 uses", Before/After: Blocked 0/3 → Allowed 3/3 | "A new version, checked from scratch — not assumed." |
| 1:35 | **Send for human review** → **Open review** | Rights decision record: verdict, policy "Tottenham Social Media Usage — Demo", media + timecodes, evidence | "A person still signs off." |
| 1:45 | **Approve** | "Approved by Demo presenter", "Publishing locked" (demo policy) | "Approved — and still not publishable, because this is a demo rule set, not a real licence." |
| 1:52 | **ScorePlay record** → **Preview writeback (dry run)** | One planned `POST /video/logs` with the timecodes and receipt id; "Live write refused." | "The decision goes back into ScorePlay as a timecoded log. Dry run today." |
| 2:00 | (Optional) **Identifiers and audit trail** | Hash-chained events, ScorePlay ↔ TwelveLabs link | "Every step is in the audit trail." |

## 2:05–2:25 — S2: fix the plan, not the clip (20 s)

Use the pre-run S2 tab (already at Compliance, "6 of 21 uses allowed"), or live: **New campaign** → **Grow engagement** → **Find opportunities** → **Use this moment** (Goal Slo Mo) → **Check rights** (each call ≈ 0.2–1.2 s).

| Click | What appears | Say |
|---|---|---|
| **Find a way to use it** | Scope is the campaign: "Limit to licensed markets: GB, US", recommended, re-checked 6/6 | "Here the clip is fine — the plan isn't. Another clip would hit the same rule, so PULSE changes the plan." |
| **Use revised plan** | "Allowed under the demo policy · 6 of 6 uses" | "Smallest valid change. Same clip, licensed markets." |

## 2:25–2:50 — Close, pick ONE

**A. Rules change, answer changes (Sponsor + Policy Center)** — pre-run tab "Activate our sleeve sponsor with fans in the UK", Goal Slo Mo 0:15–0:20, showing Blocked 0/3 under "Tottenham Social Media Usage — Demo" (kraken branding not a listed partner).
1. **Change rules** → pick **"Tottenham Commercial & Sponsor Usage — Demo"** → headline "Needs a fresh check" ("The campaign or its rules changed after the last check (0 of 3 uses allowed then). Check again before review.").
2. **Check rights again** → "Not cleared for every use · 0 of 3 uses allowed" (3 need review) — only the AI-named players remain.
3. **Find a way to use it** → recommended "Use 0:36.5–0:41.9 of the same clip" → **Use revised plan** → Allowed 3/3 (demo).
Say: "Same clip, different contract, different answer — and it still finds the usable part."

**B. The honest no (Mexico)** — pre-run tab "Sell more Spurs jerseys in Mexico" at Resolution.
Point at the "no licensed path" message — "No licensed path: Request additional usage rights for MX from the rights holder. A different clip or edit hits the same wall, and PULSE won't move the campaign elsewhere." — and the single next step **Request additional usage rights**; no review button. (Verified via API at 04:36 UTC; the on-screen layout of this state was not re-checked after the engine change — rehearse.)
Say: "When there is no legal path, PULSE says so. It won't quietly move your campaign to another country."

## 2:50–3:00 — Close

> "Other tools identify what you can't publish. PULSE finds the best way to achieve your goal anyway — and shows exactly why. Every rule you saw is a demo package; the footage, the AI evidence and the audit trail are real."

## Don'ts

- Never say "cleared", "legal" or "live" about a demo verdict or a CACHED badge.
- Never call the edit a video: it is an **edit plan, not rendered**.
- No numbers about revenue, conversion or time saved.
