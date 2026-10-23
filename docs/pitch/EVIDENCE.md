# Disclosure sheet — what is real, AI-observed, demo policy, simulated, cached

Verified on the local integration server (`:3300`, live ScorePlay + TwelveLabs) on 2026-10-23 04:25–04:27 UTC unless marked otherwise. Details: [`../demo/DEMO_EVIDENCE.md`](../demo/DEMO_EVIDENCE.md).

| Category | Item | Concrete example in the demo | Status |
|---|---|---|---|
| **REAL** | ScorePlay assets, tags, event, teams, provenance tag "partner content" | *Fans clap Man United A 9x16.mp4*, ScorePlay 130851320, 30.44 s | Live, read-only |
| **REAL** | ScorePlay squad list (identity) | "Player #18 isn't on Tottenham Hotspur's registered squad in ScorePlay" | Live, read-only |
| **REAL** | ScorePlay ↔ TwelveLabs link | filename + duration, unique both ways; Fans clap Δ 0.002 s; 58/58 Tottenham videos | Computed live |
| **REAL** | TwelveLabs Marengo moments + ranks | "#3 for 'players applauding the travelling fans after the match'"; Slide 6 replacement found as #2 | Live |
| **REAL** | Deterministic engine verdicts and every option's re-check | BLOCKED 0/3 → trim NOT_VIABLE → Slide 6 ALLOWED 3/3 | Real logic (on demo rules) |
| **REAL** | Campaign versions, evaluations, recovery plans, receipts, reviews, hash-chained audit events | receipt approved by "Demo presenter"; evaluation chain ORIGINAL BLOCKED → ALTERNATIVE ALLOWED | Stored (local Supabase in rehearsal) |
| **REAL** | Timings | run ≈ 0.8–2.1 s, check 0.17–0.37 s, find a way 0.22–1.56 s (API, local) | Measured |
| **AI-OBSERVED** | Pegasus product run | Manchester United crest 9–11 s; player #18 (shorts number); AI-named Richarlison / Porro | Real AI output, cached after first analysis; **not human-verified** |
| **AI-OBSERVED + CACHED** | Pegasus second run (recorded 2026-10-23, 54 videos / 444 observations) | Manchester United crest 9–14.5 s; kraken 15–46 s; DHL board 15–17 s in *solanke late goal* | Real AI output, recorded; labelled "second run"; **not human-verified** |
| **DEMO POLICY** | "Tottenham Social Media Usage — Demo", "Tottenham Commercial & Sponsor Usage — Demo", "Spurs Media Usage — Demo" | THFC-13 partner exclusivity; licensed territories GB, IE, US, CA, AU, NZ; Kraken as sleeve partner (commercial package) | **Fictional.** Every verdict: "Demo policy — not verified legal clearance"; never publishable |
| **DEMO POLICY** | JSON uploads | sample *tottenham-international-window* | Forced to DEMO; sha256 + uploader recorded |
| **NOT RENDERED** | TRIM / SAFE_SECTION edits | "Use 0:23.5–0:30.4 of the same clip" → "Edit plan — not rendered" | EDL only; no file produced |
| **SIMULATED / OFF** | ScorePlay writeback | planned `POST /video/logs`, media 130851320, 23.5–30.44 s; "Live write refused." | Dry run |
| **SIMULATED / OFF** | Fan-signal board `/pulse/board` | — | SIMULATED, flag off, not in the demo |
| **SIMULATED / OFF** | Video previews | "Preview off · awaiting playback rights" | Disabled; no footage URLs in API payloads |
| **NOT CONNECTED** | Sales / engagement attribution | KPI "… not connected" | No ROI, revenue or conversion figure exists anywhere |
| **CACHED (fallback)** | `DEMO_REPLAY=true` | header tag "Recorded data <date>" (recordings 2026-10-22 23:36 UTC) | Only if live fails; never presented as live; **recovery flow under replay not re-verified in this pass** |
| **NOT INDEXED** | 65 NBA videos in ScorePlay | San Antonio Spurs goals → "not indexed" | Real gap (rechecked 04:0x UTC), stated on screen |

**Things to say out loud:** "demo rule set — not legal clearance", "dry run", "edit plan, not rendered", and "recorded" whenever the header tag says "Recorded data".
