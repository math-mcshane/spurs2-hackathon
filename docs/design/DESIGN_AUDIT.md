# PULSE — Design audit (Sprint 01, before)

Audited build: `hackathon-integration@9f2ce9a`, `next dev` on the integrated `reroute/` app, live ScorePlay + TwelveLabs,
local Supabase, previews off (`MEDIA_PREVIEW_ENABLED` unset). Screenshots: `screenshots/before/`.

## Measured on one completed run (Scenario A, desktop 1440 px)

| Metric | Value |
|---|---|
| Page height | 3,332 px, one scrolling page, 6 numbered sections |
| Visible words in `<main>` | 1,461 |
| Bordered, rounded boxes | 76 |
| Distinct text sizes | 10 (9, 10, 11, 12, 12.8, 14, 16, 18, 24, 30 px) |
| Distinct text colours | 20 |
| Uppercase tracked micro-labels | 36 |
| Enabled buttons at once | 12 |
| Mobile (390 px) page height | 6,724 px |

## Screen by screen

| # | Screen | What fails | Verdict |
|---|---|---|---|
| 1 | Goal entry (`01`) | Hero repeats the promise, then a numbered step heading asks the question again, then a form label says "Business objective". Three headings for one input. Club `<select>` and example chips compete with the primary button. The primary button is grey until text exists, so the page has no visible primary action. | Rebuild as one question, one field, one action. |
| 2 | Moments (`02`) | Three identical dashboard cards. The "video" area is a 100 px grey note with an asset id. Each card carries 3 uppercase micro-headings (Why this opportunity / media / what you can do), retrieval ranks (`#1`, `#9`), a "Not checked" pill and a full-width button: ~120 words per card. Nothing says which moment is the recommendation. | Editorial gallery: one lead moment, two supporting; ranks and scoring behind a disclosure. |
| 3 | Proposal (`03`) | The media appears twice (gallery and proposal). Eight boxes: preview, rationale, KPI, timing, 2×2 field grid, copy tabs, CTA. The "Goal → proposal 4.6 s" timer is an engineering metric shown as a KPI. Env var names (`PULSE_COMMERCE_DESTINATIONS`) are shown to a social manager. | Merge into one Campaign Studio: media stage + campaign brief. Timing goes to diagnostics. |
| 4 | Rights (`04`, `04b`) | The verdict is a 30 px black mono word in a tinted panel, under a full-width amber DEMO banner, above a sentence that repeats the banner. A 4-column table repeats the same two findings for every channel, so 3 uses produce 6 near-identical "What we found / Rule applied" blocks. Red, amber, sky and emerald all appear in one panel. | Rights Lens: one decision, deduplicated issues ("affects Instagram, Facebook, X · GB"), observed vs rule side by side, demo label once, uses table collapsed. |
| 5 | Find another way (`05`) | A sky-glow button (the only glow in the app), then a new panel below the verdict, so the campaign scrolls off-screen. Alternatives are cards with three-high stacks of evidence; each "Allowed" card also repeats the DEMO banner. | Recovery happens beside the campaign; compact candidates; one demo label. |
| 6 | Alternative adopted (`06`) | Works, but the swap is invisible: the page reloads state and scrolls. The user must find the new media in the proposal section above. | Animate the media swap in place; the Lens re-checks in place. |
| 7 | Review (`07`) | "Publish (locked)" is rendered as a real button: an unavailable action that looks executable. Approve is green, reject red: two loud colours next to an amber DEMO label. | Review state belongs in the Lens and a dedicated Review view; locked publish is a status line, not a button. |
| 8 | Receipt (`08`) | Dense `dl` with raw ids, policy ids, Δ seconds, hash prefixes — all at the same weight as the decision. Writeback card is a second wall of JSON. | Receipt as a document: decision, who, when, what; ids and the trail collapsed. |
| 9 | Territory recovery (`09`) | 21 rows of findings; "Still unknown" repeats every territory sentence again. The remedy button is a white secondary button inside an amber panel. | Show the territory fix as kept vs dropped markets with one action. |
| 10 | Mobile (`10*`) | The 6-step stepper becomes 5 ticks + one label; the "Next:" line wraps to 3 lines inside the sticky header (~200 px of chrome). Page is 6.7k px. | Short header, stacked studio, Lens directly under the media. |
| 11 | `/desk` (`11`) | A second product: different wordmark (RE●ROUTE), a different amber banner, a numbered 6-panel dashboard. | Same shell and branding as PULSE, framed as the advanced evidence desk. |

## Cross-cutting problems

- **Branding.** "PU●LSE × RE●ROUTE" with sky and red dots tells the user they are using two products. REROUTE is an engine, not a brand the user needs.
- **Hierarchy.** Everything is a bordered rounded box on a near-black blue background; headings are 18 px; the strongest type on the page is a monospace verdict word. No editorial anchor.
- **Colour.** Sky is the accent, the "done" colour, the focus ring, the progress colour and the provenance badge. Amber means demo policy, needs review, missing link and unknown market. Red, emerald and sky glow all coexist. No semantic system.
- **Copy.** Explanations are written for judges ("TwelveLabs Marengo", "SP↔TL", "exact filename + duration", env var names) and repeated in headings, subheadings, notes and footers.
- **Action hierarchy.** Up to 12 enabled buttons; secondary actions (Check again, Add link) look like primaries; disabled primaries look like ghosts.
- **Media.** The placeholder is an information card, not a media surface, so the product reads as a form, not a media tool.
- **Flow.** One long scrolling document; every step stays expanded after it is done; progress is shown three times (stepper, "Next:" line, numbered section headings).

## Keep

- The underlying flow and its honesty: real moments, per-use decisions, demo-policy label, observed vs rule split, CAMPAIGN vs CLIP blocker, licence gap without re-targeting, named reviewers, receipts, dry-run writeback.
- `?run=` URL restore, optimistic concurrency handling, staged progress for slow cold caches.

## Remove, collapse, merge, move

| Action | Element |
|---|---|
| Remove | Hero promise + journey line; "What PULSE understood" box; Goal → proposal timer; env-var copy; sky glow; duplicate DEMO sentence under the banner; "Still unknown" list when it repeats findings; per-card DEMO banners; the "Next:" header line. |
| Collapse | Per-use breakdown table; retrieval ranks and scoring; media mapping; audit hash chain; writeback JSON; diagnostics. |
| Merge | Proposal + selected moment → Campaign Studio. Verdict + Find another way + review state → Rights Lens. Receipt + writeback + publish gate → Review. |
| Reposition | Rights next to the campaign (not below it); recovery inside the Lens; objective pinned under the header for the whole journey. |
