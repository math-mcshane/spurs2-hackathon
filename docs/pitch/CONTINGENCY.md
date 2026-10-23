# Contingency

**Rule:** never present a fallback as live. Point at the header data-origin tag and say what it is. Previews are off on every path, so nothing depends on video loading.

**Server hygiene:** never run `next build` while `next dev` serves the demo — at ≈ 04:52 UTC a long-running dev server kept serving stale planner wording after a build in the same project. After any build, restart dev. Rehearse on a fresh server: a production build (`next start`) or the preview.

## Environments

| Environment | State | Notes |
|---|---|---|
| Local production build | `next build` passes; S1 walked through in Chromium ≈ 04:41 UTC (reported): moments 3.96 s, check 0.5 s, find 1.28 s, approve, writeback dry run, no page errors | Local Supabase with the policy-packages migration: uploads + workspace default work |
| Vercel Preview | https://spurs2-hackathon-rxkituveo-merlins-projects-2b20d832.vercel.app — Ready, S1 verified via API ≈ 04:58 UTC (reported): run 3.84 s LIVE, find 1.67 s, ★ REPLACE → ALLOWED/DEMO | **Public — no Deployment Protection** (user decision): anyone with the link can use it; previews stay off, writeback dry-run. Uses the shared Supabase **without** the policy-packages migration: `/api/policies` shows the 3 presets with `uploadsAvailable: false` — no JSON upload or workspace default there; per-run preset switching (Sponsor beat) works. |
| Local dev `:3300` | restarted by the coordinator; v2 wording confirmed 04:54 UTC | development only |

## Backup order

1. **Live Studio** (header tag "Live club data · ScorePlay + TwelveLabs"). Measured 2026-10-23 04:25–04:54 UTC (API, local): run 0.8–4.0 s, check rights 0.17–0.37 s, find a way 0.22–1.56 s, apply 0.19–0.34 s.
2. **Pre-run tabs via `?run=` links** (same server, state restored from the database). The run id and step live in the URL (`/?run=<goal-id>&step=<goal|discover|campaign|review>`); reload restores the exact state (verified for S1-b at 04:26 UTC). Prepare before the jury, on the presenting environment:
   - S1 merch at the Resolution step (after **Find a way to use it**, before **Use revised plan**).
   - S1 already applied + submitted (for jumping straight to **Approve** / writeback).
   - S2 global engagement at Compliance ("6 of 21 uses allowed").
   - Sponsor at Compliance (Blocked under the social package).
   - Mexico at Resolution (no-licensed-path message, single option "Request additional usage rights").
   - Desk tab: *solanke late goal.mp4* 0:10–0:19, SPONSORED · GB · Instagram, showing BLOCKED (for the desk beat).
   Rehearsal ids from 04:25 UTC (local Supabase only — create fresh ones on the presenting machine): S1 `goal-126f6106-71e2-4925-a1c1-8e9bdcfc5bbc` (applied), S1-b `goal-78835981-d4ee-4cb3-9521-09aef7b11578` (approved), S2 `goal-62d86ec6-84e0-45ca-8697-e8ebd0833250` (applied), Mexico `goal-d9179aed-831a-4e2e-84ca-2a238f9d6467`, Sponsor `goal-cb8f8b99-38a0-4e3b-8050-288cdce8ee71` (applied).
   Note: an applied run cannot be "un-applied"; for the live beat keep one tab stopped at Resolution.
3. **`DEMO_REPLAY=true` (CACHED)** — operator restart, not on stage: `cd reroute && pnpm exec next build && DEMO_REPLAY=true pnpm exec next start -p 3401` (stop any `next dev` on the same project first, or restart it afterwards). Every ScorePlay/TwelveLabs read comes from `reroute/demo-cache/`, **re-recorded 2026-10-23T04:40:23Z** for 8 scenarios — A merch, B global engagement, C Mexico, D tickets, E sponsor, F jerseys UK, G UK followers, H Spurs France (not indexed) — 108 files, recovery searches included, URLs/tokens stripped, secret scan clean, replay verified in a fresh process (reported). Header tag **"Recorded data 23 Oct 2026"** (verified on a production server, reported). A missing recording is an error, nothing is invented. The second Pegasus run is bundled in the repo. Say "recorded", never "live". The desk trim (solanke) is **not** among the recorded scenarios — use its screenshots instead.
4. **Offline screenshots** in `docs/design/screenshots/recovery/`, announced as screenshots:
   - `desktop-01-blocked.webp` → `desktop-01b-finding-a-way.webp` → `desktop-02-editor-open.webp` / `desktop-02b-editor-full.webp` → `desktop-03-recommended-replacement.webp` → `desktop-04-other-ways-rejected-trim.webp` → `desktop-05-after-apply.webp`.
   - Edit plan: `desktop-03b-compare-safe-section.webp`, `desktop-06-after-apply-edited-cut.webp`, `desktop-07-review-edited-cut.webp`.
   - Policy switch: `desktop-08-policy-changed-stale.webp`; Sponsor `v2-sp-desktop-*.webp`; Mexico `v2-mx-desktop-*.webp`; goal briefs `v2-00-goal-briefs.webp`; mobile set `mobile-0*.webp`.
   - Desk trim that works: `desk-desktop-recovery-panel.webp` → `desk-desktop-options.webp` → `desk-desktop-after-apply-cut.webp` / `desk-desktop-after-apply-panel.webp` (+ `desk-mobile-*.webp`); NBA desk: `desk-desktop-nba-needs-review.webp`, `desk-desktop-nba-recovery-panel.webp`.
   - Screenshot UI may predate the final label polish — describe what they show, not exact button text.

## Header tag — what to say

| Tag (API origin) | Say |
|---|---|
| **Live club data · ScorePlay + TwelveLabs** (LIVE) | "This is live from ScorePlay and TwelveLabs." |
| **Recorded data <date>** (CACHED) | "This replays real responses we recorded on that date — not fetched right now. The tag says so." |
| **Partly recorded data <date>** (MIXED) | "Some reads are live, some replayed; the tag says which." |
| evidence tagged "second run" | "That's a second, independent analysis run we recorded this morning; we use both runs." |

## If something is slow or fails

| Situation | Screen | Say | Do |
|---|---|---|---|
| Find opportunities > 5 s | progress line with elapsed seconds | "It's searching the club's video index live." | Wait up to ~15 s, then switch to the pre-run S1 tab |
| First analysis of a clip | "a first analysis can take up to ~70 s; recorded results return in seconds" | "First-time analysis takes a while; after that it's cached." | Stay on scripted goals (all pre-analysed) |
| TwelveLabs down | "Recorded data" tag if a recording exists, else an unavailable state | "Video search didn't answer — we show that instead of inventing results." | Pre-run tab → replay → screenshots |
| ScorePlay 429/5xx | "Recorded data" tag or error | "ScorePlay is rate-limiting us; this is recorded real metadata." | Same |
| Our rate limit (Find a way / desk recovery: 10 per minute per IP) | request refused | "We cap requests per user to protect the partner APIs." | Don't click Find a way repeatedly in rehearsal right before the jury; wait a minute or use a pre-run tab |
| CONFLICT error after a double click (not rehearsed) | an error message | "Two clicks raced; every action is versioned." | Reload the tab (state is restored) |
| Reviewer sign-in fails | sign-in error | "Named reviewers only." | Retype once off-screen; else show the approved S1-b tab |
| Asked to publish / write live | "Publishing locked", "Live write refused." | "Demo rules are never publishable and never written to ScorePlay." | — |
| Asked to play the video | "Preview off · awaiting playback rights" | "Playback needs organizer-confirmed rights; the decision uses timestamps and analysis." | — |
| Mexico shows no fix | "No correction clears it" | "That's the product working: no licence, no workaround." | — |

**Always say:** "demo rule set — not legal clearance", "dry run", "edit plan, not rendered" (when a cut is shown).
