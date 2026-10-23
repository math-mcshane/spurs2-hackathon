# PULSE — technical brief for judges

Full map: [`../ARCHITECTURE.md`](../ARCHITECTURE.md). Observed behaviour: [`../demo/DEMO_EVIDENCE.md`](../demo/DEMO_EVIDENCE.md).

## 1. Partner roles

| Partner | What we use | What it decides |
|---|---|---|
| **ScorePlay** (system of record) | Public API, read-only: media search, asset facts, tags, event, teams, **squad lists**, provenance tags; `POST /video/logs` for writeback (dry run). Workspace: 728 media (123 videos, 605 photos). | *Facts*: which club published it, which competition, who is on the squad. A player's club is asserted **only** from ScorePlay identity. |
| **TwelveLabs** (video intelligence) | **Marengo** search → timestamped moments for the goal and for replacements; **Pegasus** analysis → timecoded observations (brands, crests, boards, players, shirt numbers). Index `premiere-league`: 58 Tottenham videos. | *Evidence*: what is visible, and when. Never a licence. |

A second, independent Pegasus run (recorded 2026-10-23, 54 videos / 444 observations) is loaded alongside the product's own run and labelled "second run" (CACHED). Restrictions are localized on the union of both runs — e.g. the Manchester United crest in *Fans clap* is 9–11 s in one run and 9–14.5 s in the other; the engine uses 9–14.5 s.

## 2. Identity mapping (`lib/media/link.ts`, `resolver.ts`)

- Every TwelveLabs video is linked to exactly one ScorePlay asset by **normalized filename + duration (±0.5 s)**, unique in both directions. 58/58 Tottenham videos linked (demo clip Δ 0.002 s).
- TwelveLabs `user_metadata` ids are a hint only; ambiguous or unmapped media gets no AI evidence and the engine reports `MEDIA_IDENTITY` instead of guessing.
- 65 NBA (San Antonio Spurs) videos exist in ScorePlay but in no TwelveLabs index visible to our keys → PULSE says "not indexed" and never invents moments.

## 3. Deterministic rights engine (`lib/rights/engine.ts`)

- Pure, synchronous, no LLM in the decision. Each segment × intent (channel, territory, usage, competition, date, club) is evaluated under the package selected for its asset.
- Each dimension resolves to **DENY** (a deny rule verifiably applies), **MISSING** (a fact is unknown, or nothing affirmatively permits) or **PERMIT**. Absence of a deny is never permission.
- Verdict: any DENY → BLOCKED; else any MISSING → NEEDS_REVIEW; else ALLOWED. AI observations below 0.6 confidence can raise a question but never block on their own.
- Every reason carries a basis (policy selection, legal entitlement, technical observation, media identity), a rule id and its evidence.

## 4. Recovery engine (`lib/rights/recovery/plan.ts`, `edl.ts`)

1. **Localize.** Split the selected range at every observation boundary; evaluate each elementary interval for every use. A restriction in every interval is pervasive; otherwise it is localized to its intervals.
2. **Propose.** TRIM (remove flagged intervals with a ±0.5 s margin), SAFE_SECTION (best contiguous clean stretch of the same asset), REPLACE (Marengo moments for the same query, mapped to ScorePlay), ADAPT_CAMPAIGN (licensed subset of markets/channels when the restriction is in the plan), CHANGE_USAGE (flagged "changes the goal"), REQUEST_CLEARANCE.
3. **Constrain.** Minimum post 3 s or 40 % of the moment; kept pieces < 1 s dropped. *Fans clap*: the trim would leave 1.0 s of 7.8 s → "Trim rejected … below the 3.1 s minimum".
4. **Re-evaluate.** Every option is evaluated as its own edit by the same engine, for every use: RESOLVES_DEMO / NEEDS_REVIEW / STILL_BLOCKED / NOT_VIABLE / NEXT_STEP. NOT_VIABLE and NEXT_STEP are never applicable. A licence gap (no licensed market or channel in the plan, e.g. Mexico) generates no footage change at all — only "Request additional usage rights" — and the campaign is not submittable.
5. **Apply.** A new immutable campaign version, a fresh evaluation from scratch, a before/after record.

**EDL.** A trim or section is an edit decision list: kept/removed source intervals with reasons and rule ids, and their output timeline. `execution: PLAN_NOT_RENDERED` — the UI says "Edit plan — not rendered". The engine evaluates what the cut would contain (the kept source intervals), not a file.

Measured (local, live APIs, 2026-10-23 04:25–04:27 UTC): check rights 0.17–0.37 s; find a way 0.22–1.56 s (includes Marengo replacement search); apply + re-check 0.19–0.34 s.

## 5. Policy packages (`lib/rights/packages.ts`, `/policies`)

- Presets: "Tottenham Social Media Usage — Demo", "Tottenham Commercial & Sponsor Usage — Demo", "Spurs Media Usage — Demo". All fictional.
- JSON upload (signed-in reviewer only, ≤ 200 KB): validated, stored with sha256 and uploader, **forced to DEMO** whatever it declares. PDF/DOCX/TXT/CSV refused (422) — no contract extraction is claimed.
- One workspace default per club; a run may switch package (`setPolicy`), which marks the current verdict stale until re-checked.

## 6. Persistence and audit

- Supabase tables `reroute_*`, RLS on, no anon/authenticated grants; server uses the secret key.
- Goal runs carry a `version` (optimistic concurrency: every action sends `expectedVersion`). Campaign versions are immutable; each evaluation, recovery plan (with every option's re-check), receipt, review and writeback attempt is stored.
- `reroute_events` is append-only and hash-chained (`RECOVERY_PLANNED`, evaluations, submission, review …). Reload of `?run=<id>&step=<view>` restores the exact state.
- Writeback: a planned `POST /video/logs` carrying receipt id, demo label, policy@version, segment and reviewer; live writes refused for demo packages; `SCOREPLAY_WRITEBACK_MODE=dry-run` by default.

## 7. Security

- Secrets server-only; no footage URLs in API payloads while previews are off.
- Reviewer actions need a named reviewer session (HttpOnly HMAC-signed cookie; personal passcodes stored as hashes; sign-in delay + lockout); same-origin check on every mutation; per-IP rate limits on expensive routes (in-memory, per instance).
- Input limits (segments, intents, query length), generic 500s, upstream bodies only in server logs.
- Fail-safe defaults: unknown → NEEDS_REVIEW, demo → never publishable, writeback dry-run, media processing and upload off.

## 8. Tests

`src/lib/rights/recovery/recovery.test.ts` (20 tests) covers localization, margins, minimums, licence gaps and re-evaluation. Full suite at 2026-10-23 04:35 UTC: **405 passed · 15 skipped**. Other agents were still editing; re-run `cd reroute && pnpm exec vitest run` before citing a number on stage.
