# Contingency

**Rule:** never present a fallback as live. Point at the header data-origin tag and say what it is. Footage, thumbnails and photo thumbnails appear **only for a signed-in reviewer** (`MEDIA_PREVIEW_ENABLED=true`, organizers confirmed display for reviewers); signed out, every frame is a timecode placeholder — the demo works either way.

**Server hygiene:** never run `next build` while `next dev` serves the demo — at ≈ 04:52 UTC a long-running dev server kept serving stale planner wording after a build in the same project. After any build, restart dev. Rehearse on a fresh server: a production build (`next start`) or the preview.

## Environments

| Environment | State | Notes |
|---|---|---|
| Vercel Preview (**present from this**) | https://spurs2-hackathon-inpdx7om5-merlins-projects-2b20d832.vercel.app (`e3c5a2b`, presentation cleanup) — all three use cases validated in Chromium as reviewer ≈ 12:55 UTC | Same env, data and protections as the row below; the row below stays up as the fallback build. |
| Vercel Preview (**recommended presenting environment**) | https://spurs2-hackathon-hi425s3gm-merlins-projects-2b20d832.vercel.app (`2f3d299`) — Ready ≈ 12:24 UTC; flagship + S2 rehearsed in Chromium as reviewer (on the identical `reawytzpg` build minus one copy fix) and flagship re-run via API on `hi425s3gm` ≈ 12:27 UTC | **Public — no Deployment Protection.** Rotated reviewer credentials + session secret. Shared Supabase **without** the policy-packages migration: 3 presets, `uploadsAvailable: false`. All older preview deployments were **deleted** (they carried the compromised credential). |
| Local production build (backup) | `2f3d299` built ≈ 12:24 UTC, `next start -p 3400` | Local Supabase; its Pegasus cache now **mirrors the shared one** (57 rows copied ≈ 12:10 UTC; previous local rows backed up to `~/Desktop/obs-cache-local-backup-2026-10-23.json`) → the flagship returns exactly the preview's result. Uploads + workspace default work here. |
| Local dev `:3300` | stopped | development only — it served stale code twice today; never present from it |

**Why local and preview used to differ:** each database had cached its *own* Pegasus product run of every video (shared: 22 Oct 23:20 UTC; local: 23 Oct 03:18 UTC); Pegasus output is not deterministic and all 45 common videos differed. For *solanke late goal* the shared run saw "DHL … advertising hoardings (15–17 s)" and "Tonalí" (19–20 s, matched to ScorePlay's Sandro Tonali); the local run missed DHL (only the bundled second run had it) and wrote the name as "Tonal", which matched no ScorePlay player — hence the extra people issue and the two-part cut. Local now uses the shared cache.

## Backup order

1. **Live Studio** (header tag "Live club data · ScorePlay + TwelveLabs"). Measured 2026-10-23 04:25–04:54 UTC (API, local): run 0.8–4.0 s, check rights 0.17–0.37 s, find a way 0.22–1.56 s, apply 0.19–0.34 s.
2. **Pre-run tabs via `?run=` links** (same server, state restored from the database). The run id and step live in the URL (`/?run=<goal-id>&step=<goal|discover|campaign|review>`); reload restores the exact state. Prepare before the jury, on the presenting environment:
   - **Flagship** "Activate our sponsor with Solanke's late goal for UK fans" → moment 02 *solanke late goal* → **Check rights** → stop at Compliance (Blocked 0/3). A second flagship tab stopped after **Find a way to use it** (Resolution).
   - S2 global engagement at Compliance ("6 of 21 uses allowed").
   - S1 merch at the Resolution step (after **Find a way to use it**, before **Use revised plan**).
   - Desk tab: *solanke late goal.mp4* 0:10–0:19, SPONSORED · GB · Instagram, showing BLOCKED (exact same DHL story on the operator desk).
   Note: an applied run cannot be "un-applied"; keep one tab per beat stopped before **Use revised plan**.
3. **`DEMO_REPLAY=true` (CACHED)** — operator restart, not on stage: `cd reroute && pnpm exec next build && DEMO_REPLAY=true pnpm exec next start -p 3401` (stop any `next dev` on the same project first, or restart it afterwards). Every ScorePlay/TwelveLabs read comes from `reroute/demo-cache/`, **re-recorded 2026-10-23 ≈ 12:12 UTC** on the aligned cache for 9 scenarios — A merch, B global engagement, C Mexico, D tickets, E sponsor, F jerseys UK, G UK followers, H Spurs France (not indexed), **I flagship Solanke** — 167 files, URLs/tokens stripped, secret scan clean, replay verified in a fresh process (flagship replay: TRIM "Remove 0:14.5–0:17.5" → ALLOWED 3 uses, same as live). Header tag **"Recorded data 23 Oct 2026"**. No footage under replay (previews are never recorded). A missing recording is an error, nothing is invented. Say "recorded", never "live".
4. **Offline screenshots** in `docs/design/screenshots/recovery/`, announced as screenshots:
   - Flagship (taken before the evidence alignment and with media off — numbers differ: they show the old local two-part cut, 6.4 s): `flagship-01-discover.webp` → `flagship-02-blocked.webp` → `flagship-03-trim-plan.webp` → `flagship-04-allowed.webp`. S2: `global-01-adapt-markets.webp`, `global-02-international-rules.webp`. S1: `merch-01-replacement-allowed.webp`.
   - Earlier S1 set: `desktop-01-blocked.webp` → `desktop-01b-finding-a-way.webp` → `desktop-02-editor-open.webp` / `desktop-02b-editor-full.webp` → `desktop-03-recommended-replacement.webp` → `desktop-04-other-ways-rejected-trim.webp` → `desktop-05-after-apply.webp`.
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

## Emergency fallback, click by click

1. **Flagship fails at Find opportunities** (> 15 s or error): switch to the pre-run flagship tab (Compliance). Say "this is the same run from five minutes ago".
2. **Flagship moment 02 isn't *solanke late goal*** (TwelveLabs ranking moved): click **Why this moment** on any card only if it helps; otherwise go to the pre-run flagship tab. Never pretend another clip is the late goal.
3. **Find a way errors or is rate-limited**: pre-run flagship tab at Resolution → **Use revised plan**.
4. **Studio unusable**: open `/desk` tab (pre-staged, BLOCKED) → **Find a way to use it** → recommended "Remove 0:14.5–0:17.5" → **Apply cut** → both kept segments ALLOWED · DEMO. Same DHL story, single cut, 6.0 s of 9.0 s.
5. **Video won't load** ("Can't play in this browser" or a spinner > 5 s): carry on — the timecodes, verdicts and cut are independent of playback. Say "the stream is slow; the decision never needed it".
6. **Reviewer sign-in fails**: retype once off-screen; else continue signed out (placeholders) — approval then needs the pre-approved tab.
7. **Network down**: operator restarts on `DEMO_REPLAY=true` (step 3 above, scenario I recorded) — header says "Recorded data"; no footage there.
8. **Everything down**: flagship screenshots 01 → 04, announced as screenshots (older numbers — say so).

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
| Asked to play the video | Signed in: the TwelveLabs stream of the indexed video; signed out: "Preview for signed-in reviewers" | "Footage is shown to signed-in reviewers only — that's what the organizers allowed." | — |
| Mexico shows no fix | "No correction clears it" | "That's the product working: no licence, no workaround." | — |

**Always say:** "demo rule set — not legal clearance", "dry run", "edit plan, not rendered" (when a cut is shown).
