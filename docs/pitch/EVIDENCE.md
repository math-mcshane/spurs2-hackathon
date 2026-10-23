# Disclosure sheet — what is real, AI-observed, demo policy, simulated, cached

Verified on the local integration server (`:3300`, live ScorePlay + TwelveLabs) on 2026-10-23 04:25–04:54 UTC unless marked otherwise; items marked *(reported)* were verified by other agents (production build ≈ 04:41, Policy Center ≈ 04:47, desk ≈ 04:50, preview ≈ 04:58). Details and who ran what: [`../demo/DEMO_EVIDENCE.md`](../demo/DEMO_EVIDENCE.md) §1b.

| Category | Item | Concrete example in the demo | Status |
|---|---|---|---|
| **REAL** | ScorePlay assets, tags, event, teams, provenance tag "partner content" | *Fans clap Man United A 9x16.mp4*, ScorePlay 130851320, 30.44 s | Live, read-only |
| **REAL** | ScorePlay squad list (identity) | "Player #18 … Can't be matched to the club's registered squad in ScorePlay, so image rights can't be confirmed (AI identification — a reviewer must confirm)" | Live, read-only |
| **REAL** | ScorePlay ↔ TwelveLabs link | filename + duration, unique both ways; Fans clap Δ 0.002 s; 58/58 Tottenham videos | Computed live |
| **REAL** | TwelveLabs Marengo moments + ranks | "#3 for 'players applauding the travelling fans after the match'"; Slide 6 replacement found as #2 | Live |
| **REAL** | Deterministic engine verdicts and every option's re-check | S1: BLOCKED 0/3 → trim NOT_VIABLE → Slide 6 ALLOWED 3/3; desk: DHL 15–17 s → trim "Remove 0:14.5–0:17.5" → ALLOWED · DEMO *(UI reported)* | Real logic (on demo rules) |
| **REAL** | Campaign versions, evaluations, recovery plans, receipts, reviews, hash-chained audit events | receipt approved by "Demo presenter"; evaluation chain ORIGINAL BLOCKED → ALTERNATIVE ALLOWED | Stored (local Supabase in rehearsal) |
| **REAL** | Timings | API local: run 0.8–4.0 s, check 0.17–0.37 s, find a way 0.22–1.56 s; production-build UI *(reported)*: moments 3.96 s, check 0.5 s, find 1.28 s | Measured |
| **AI-OBSERVED** | Pegasus product run | Manchester United crest 9–11 s; player #18 (shorts number); AI-named Richarlison / Porro | Real AI output, cached after first analysis; **not human-verified** |
| **AI-OBSERVED + CACHED** | Pegasus second run (recorded 2026-10-23, 54 videos / 444 observations) | Manchester United crest 9–14.5 s; kraken 15–46 s; DHL board 15–17 s in *solanke late goal* | Real AI output, recorded; labelled "second run"; **not human-verified** |
| **DEMO POLICY** | "Tottenham Social Media Usage — Demo", "Tottenham Commercial & Sponsor Usage — Demo", "Spurs Media Usage — Demo" | THFC-13 partner exclusivity; licensed territories GB, IE, US, CA, AU, NZ; Kraken as sleeve partner (commercial package) | **Fictional.** Every verdict: "Demo policy — not verified legal clearance"; never publishable |
| **DEMO POLICY** | JSON uploads | sample "Tottenham International Window — Demo": upload 201, label "Uploaded rules — unverified, demo only"; S2 6/21 → 15/21 under it *(reported)*; PDF → 422; anonymous upload → 403 | Forced to DEMO; sha256 + uploader recorded (uploader visible to reviewers only). **Not available on the preview** (shared Supabase lacks the migration: `uploadsAvailable: false`) |
| **NOT RENDERED** | TRIM / SAFE_SECTION edits | "Use 0:23.5–0:30.4 of the same clip" → "Edit plan — not rendered" | EDL only; no file produced |
| **SIMULATED / OFF** | ScorePlay writeback | planned `POST /video/logs`, media 130851320, 23.5–30.44 s; "Live write refused." | Dry run |
| **SIMULATED / OFF** | Fan-signal board `/pulse/board` | — | SIMULATED, flag off, not in the demo |
| **SIMULATED / OFF** | Video previews | "Preview off · awaiting playback rights" | Disabled; no footage URLs in API payloads |
| **NOT CONNECTED** | Sales / engagement attribution | KPI "… not connected" | No ROI, revenue or conversion figure exists anywhere |
| **CACHED (fallback)** | `DEMO_REPLAY=true` | `demo-cache/` re-recorded 2026-10-23T04:40:23Z for 8 Studio scenarios (A–H, incl. recovery searches), 108 files; header tag "Recorded data 23 Oct 2026" *(reported)* | Only if live fails; never presented as live; the desk trim is not one of the recorded scenarios |
| **NOT INDEXED** | 65 NBA videos in ScorePlay | San Antonio Spurs goals → "not indexed" | Real gap (TwelveLabs indexes rechecked ≈ 04:05 UTC), stated on screen |
| **NOT USED IN THE STUDIO** | 605 ScorePlay photos (418 Tottenham, 187 SAS; 44 sponsor-tagged, all SAS; usage/custom terms empty) | `docs/demo/PHOTO_INVENTORY.md` | Metadata only; not analysed by TwelveLabs (video-only); documented candidates |
| **DEPLOYMENT** | Vercel Preview | public, no Deployment Protection *(reported ≈ 04:58)* | Previews off, writeback dry-run, shared Supabase; production untouched |

**Things to say out loud:** "demo rule set — not legal clearance", "dry run", "edit plan, not rendered", and "recorded" whenever the header tag says "Recorded data".
