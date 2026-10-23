# PULSE — Media Intelligence Catalog

**As of:** 2026-10-23T03:32:10Z (UTC). Built from authorized, read-only API calls made during this audit.
**Machine-readable version:** [`media-intelligence-catalog.json`](media-intelligence-catalog.json) (schema `pulse.media-intelligence-catalog/v1`, 123 inventory rows, 81 moments).

> Metadata and evidence only. No footage, media URLs, thumbnails or tokens are stored here or in the JSON (scanned: 0 URL/token patterns).
> **All rights policies are fictional DEMO policies.** "Allowed" means *eligible under demo rules*, never legal clearance.
> **AI observations are evidence, not facts. None has been checked by a human.** ScorePlay metadata is the only verified source of identity, team and sponsor facts.

## 1. Sources and access

| Source | What was read | Access | Read at (UTC) |
|---|---|---|---|
| ScorePlay workspace `spurs2-hack-15` | `GET /whoami`, `POST /media/search` (all pages), `GET /media/{id}` × 123, `GET /media/{id}/logs` × 123, tag filters, team seasons, squads | API key (admin rights on the key; **only reads used**) | 2026-10-23T03:03:57 |
| TwelveLabs key `…834da9ac` (`reroute/.env.local`) | `indexes.list`, `indexes.videos.list` (all pages) | read | 2026-10-23T03:03:57 |
| TwelveLabs key `…1ac7b003` (main checkout / shared env) | `indexes.list`, `indexes.videos.list` | read | 2026-10-23T03:03:57 |
| TwelveLabs Pegasus 1.6 (product prompt + JSON schema) | analysis of 57 eligible Tottenham videos | live analyze | 2026-10-23 03:05–03:11 |
| TwelveLabs Marengo 3.0 | 34 moment queries (sports / commercial / rights-sensitive) | live search | 2026-10-23T03:06:34 |
| Local Supabase `reroute_observation_cache` | existing Pegasus results the product uses | local DB | 2026-10-23 03:20 |
| Shared Supabase | — | **not reachable** from this machine (connection timed out); not used | — |

Key fingerprints are the first 8 hex chars of SHA-1 of the key; the keys themselves are not recorded.

## 2. Inventory totals (deduplicated by ScorePlay media id)

| | Count |
|---|---|
| ScorePlay media in workspace | **728** (123 videos, 605 photos) |
| Tottenham Hotspur videos (Man Utd v Tottenham, PL Week 6, 2026/27) | **58** — Creative Video 19 · Moments 13 · Pre-Match 11 · Press Conference 5 · Post-Match 5 · Highlights 4 · Full Match 1 |
| San Antonio Spurs videos (SAS v SAC, NBA Preseason) | **65** — Social Edits 36 · Raw Footage 29 |
| TwelveLabs indexes visible | 2: `premiere-league` (`6ad911d5500e82756f2eb468`, 58 videos, Marengo 3.0 visual+audio) and `My Index (Default)` (`6ada2e70bb3f682f2f1512f5`, **0 videos**) |
| ScorePlay ↔ TwelveLabs links | **58/58** Tottenham, method `FILENAME_DURATION` (filename + \|Δduration\| ≤ 0.5 s, unique both ways); max Δ = 0.037 s (full match); 0 ambiguous; 0 TwelveLabs videos without a ScorePlay asset |
| NBA videos in any TwelveLabs index | **0 of 65** |
| Photos analysed | 0 (no image intelligence connected; counted only) |
| Existing ScorePlay video logs on these videos | 0 on all 123 |
| ScorePlay `usage` / `custom_terms` fields | empty on all 123 — no recorded usage restrictions exist |

Mapping confidence: every Tottenham link is unique in both directions. No link is `AUTHORITATIVE_ID`: the index's `user_metadata` ids do not resolve in this workspace, so they were ignored, as the product does.
Same-duration siblings (distinct ids, not merged, likely duplicate content): `130851267`/`130851268` (2020/21 1–6 highlights, 159.24 s) and `130851386`/`130851384` (team news, 52.43 s). NBA raw footage comes in A/B(/C/D) camera variants of equal length (30 assets) and social edits in 4x5/9x16 pairs — variants, not duplicates.

## 3. Analysis coverage

| Asset group | Pegasus | Notes |
|---|---|---|
| 54 Tottenham videos | ✓ audit run (2026-10-23) | |
| 27 of those | ✓ also a product-stored run (21 from 2026-10-22 22:35–23:37, 6 created by the product path during this audit at 03:19) | Two independent runs → corroboration (✓✓ below) |
| `130851360` Extended Highlights (509.7 s) | ✗ audit run truncated (`finish_reason=length`) | product-stored run (2026-10-22 22:36) exists and is what the product uses |
| `130851357` DEF_ACTIONS (120.6 s), `130851445` solanke over the bar (28.4 s) | ✗ truncated | Marengo only |
| `130851361` Full Match (6,335 s) | ✗ `TECHNICAL_LIMITATION` (> 60 min) | Marengo only: 5 timestamped moments catalogued, visually unverified |
| 65 NBA videos | — | not indexed: no Marengo, no Pegasus possible |

Run-to-run variance is material: on the same video, the two Pegasus runs disagree on many player names and on some LED boards (e.g. `solanke late goal` 0:15–0:17 DHL board seen in one run only). The catalog marks every AI observation with the run(s) that produced it; only ✓✓ observations were treated as stable when choosing demo moments.

Cost note: the audit's Pegasus pass ran outside the `react-server` condition, so it could not read the durable observation cache and re-analysed 21 videos that already had stored results (≈ 21 avoidable analyses). Those results were used as an independent second run rather than discarded.

## 4. NBA (San Antonio Spurs) readiness

- **ScorePlay: ready.** 65 NBA videos with team tags (`San Antonio Spurs (SAS)`, `Sacramento Kings (SAC)`), player tags (e.g. Victor Wembanyama on 23), and **ScorePlay sponsor tags**: Ledger (36 videos), Frost Bank (8), H-E-N (3, as recorded), Sprite (1: `130907419`).
- **TwelveLabs: not accessible.** Exact limitation: the only two TwelveLabs keys available to this project see `premiere-league` (58 Tottenham videos) and `My Index (Default)` (0 videos). No `PULSE_TWELVELABS_INDEX_ID_SPURS` / `PULSE_TWELVELABS_API_KEY_SPURS` is set in any worktree env file. The product reports it verbatim: *"None of the 65 San Antonio Spurs videos in ScorePlay is in the video-intelligence index premiere-league, so no moment can be found yet."* (verified in the UI, 2026-10-23 03:28).
- Consequence: NBA moments exist only as whole clips described by ScorePlay titles and tags; no timestamps inside clips, no visual evidence. Rights evaluation still runs (ScorePlay facts + policy) through the REROUTE desk.
- Metadata gap: NBA clips recorded 2026-10-16/17 carry the season tag `2025-26`; 31 raw-footage clips have a placeholder recording time of 2026-10-22 00:00.

## 5. Tottenham inventory (58)

| ScorePlay id | Folder | Filename | Duration s | TwelveLabs id | Δ s | ScorePlay people | Pegasus | Same-duration sibling |
|---|---|---|---|---|---|---|---|---|
| 130851359 | Highlights | 16x9_MNU_1_1_TOT_KEY_HIGHLIGHTS.mp4 | 121.83 | `6ad911e865b4aff96dc7baf2` | 0.004 | 8: Maddison, Solanke-Mitchell, Ven, Colmán… | audit ✓; stored (2026-10-22T22:36Z) |  |
| 130851269 | Pre-Match | 261008_Men_Pre Match Man Utd A_FPL Pick_9x16.mp4 | 42.44 | `6ad911e24a68f3b40321d5f2` | 0.013 | none listed | audit ✓ |  |
| 130851446 | Pre-Match | 261008_Men_Pre Match Man Utd A_Left Back Dilemma_9x16.mp4 | 118.6 | `6ad912012cc348c0bd201279` | 0.013 | none listed | audit ✓ |  |
| 130851447 | Pre-Match | 261008_Men_Pre Match Man Utd A_Mo Kudus_9x16.mp4 | 67.4 | `6ad912039c038876f358b092` | 0.013 | none listed | audit ✓ |  |
| 130851448 | Pre-Match | 261008_Men_Pre Match Man Utd A_Podcast Mathys Tel_9x16.mp4 | 118.4 | `6ad91202968fe117efe706ae` | 0 | none listed | audit ✓ |  |
| 130851449 | Pre-Match | 261008_Men_Pre Match Man Utd A_Utd Line Up_9x16.mp4 | 93.36 | `6ad912059c038876f358b09a` | 0.016 | none listed | audit ✓ |  |
| 130851451 | Pre-Match | 261009_Men_De Zerbi Pre Match Man Utd A_16x9.mp4 | 243.0 | `6ad91206968fe117efe706d1` | 0.008 | 10: Zerbi, Colmán, Maddison, Barón… | audit ✓; stored (2026-10-22T23:37Z) |  |
| 130851450 | Pre-Match | 261009_Men_De Zerbi Pre Match Man Utd A_9x16 CLIP.mp4 | 25.92 | `6ad912040ca748ea3c0aa6bd` | 0 | 1: Zerbi | audit ✓; stored (2026-10-22T23:37Z) |  |
| 130851357 | Highlights | 9x16_DEF_ACTIONS_VS_MNU.mp4 | 120.621 | `6ad911e60ca748ea3c0aa5fd` | 0.019 | none listed | audit ✗ Pegasus output truncated  |  |
| 130851266 | Pre-Match | 9x16_MNU_0_3_TOT_PL_18_19_HIGHLIGHTS.mp4 | 92.259 | `6ad911e09c038876f358af94` | 0.007 | none listed | audit ✓; stored (2026-10-22T23:29Z) |  |
| 130851358 | Highlights | 9x16_MNU_1_1_TOT_HIGHLIGHTS.mp4 | 119.369 | `6ad911e765b4aff96dc7baeb` | 0.012 | 7: Oliveira, Colmán, Tonali, Maddison… | audit ✓; stored (2026-10-22T23:37Z) |  |
| 130851267 | Pre-Match | 9x16_MNU_1_6_TOT_20_21_HIGHLIGHTS.mp4 | 159.242 | `6ad911e00ca748ea3c0aa5dc` | 0.011 | none listed | audit ✓; stored (2026-10-22T23:29Z) | 130851268 |
| 130851268 | Pre-Match | 9x16_MNU_1_6_TOT_20_21_HIGHLIGHTS_2.mp4 | 159.242 | `6ad911e165b4aff96dc7bac4` | 0.011 | none listed | audit ✓; stored (2026-10-22T23:29Z) | 130851267 |
| 130851382 | Press Conference | 9x16_RDZ_ON_DEKI.mp4 | 23.857 | `6ad911ea9c038876f358afcf` | 0.015 | 1: Zerbi | audit ✓ |  |
| 130851383 | Press Conference | 9x16_RDZ_ON_FERNANDES.mp4 | 48.924 | `6ad911eb500e82756f2eb4ff` | 0.014 | 1: Zerbi | audit ✓ |  |
| 130851386 | Press Conference | 9x16_TEAM_NEWS_MAN_UTD.mp4 | 52.427 | `6ad911ed2cc348c0bd2011f2` | 0.01 | 1: Zerbi | audit ✓ | 130851384 |
| 130851384 | Press Conference | 9x16_TEAM_NEWS_MAN_UTD_2.mp4 | 52.427 | `6ad911ec960d8ea7bdd04cd3` | 0.01 | 1: Zerbi | audit ✓ | 130851386 |
| 130851320 | Post-Match | Fans clap Man United A 9x16.mp4 | 30.44 | `6ad911e365b4aff96dc7bacd` | 0.002 | 8: Oliveira, Adarabioyo, Tonali, Fernandes… | audit ✓; stored (2026-10-22T22:35Z) |  |
| 130851323 | Post-Match | IMG_2434.MOV | 19.105 | `6ad911e59c038876f358afb4` | 0.008 | 1: Gallagher | audit ✓; stored (2026-10-23T03:19Z) |  |
| 130851452 | Pre-Match | Man Utd (A) Previously Against.mp4 | 18.48 | `6ad912052cc348c0bd201298` | 0.016 | 1: Ven | audit ✓; stored (2026-10-23T03:19Z) |  |
| 130851360 | Highlights | Manchester United vs Spurs / Extended Highlights / 2026-27.mp4 | 509.718 | `6ad911ea030b76724d136dfb` | 0.02 | 4: Solanke-Mitchell, Kinský, Hecke, Kudus | audit ✗ Pegasus output truncated ; stored (2026-10-22T22:36Z) |  |
| 130851385 | Press Conference | Press Conference: De Zerbi speaks to the media ahead of Manchester United trip.mp4 | 725.48 | `6ad911ec2cc348c0bd2011ef` | 0.002 | 1: Zerbi | audit ✓ |  |
| 130851321 | Post-Match | Solanke Goal.mp4 | 58.892 | `6ad911e40ca748ea3c0aa5f2` | 0.009 | 1: Maddison | audit ✓; stored (2026-10-22T23:29Z) |  |
| 130851324 | Post-Match | The mentality is something to build on Solanke on his late equaliser and captaincy against Red Devils.mp4 | 152.0 | `6ad911e6960d8ea7bdd04cba` | 0 | 1: Solanke-Mitchell | audit ✓ |  |
| 130851322 | Post-Match | We didn’t deserve to lose De Zerbi proud of togetherness in Man United draw.mp4 | 214.52 | `6ad911e5500e82756f2eb4d6` | 0.008 | 1: Zerbi | audit ✓ |  |
| 130851424 | Moments | Archie tackle.mp4 | 13.567 | `6ad911f49c038876f358b01a` | 0.001 | none listed | audit ✓; stored (2026-10-23T03:19Z) |  |
| 130851422 | Moments | Dom United Subs.mp4 | 43.12 | `6ad911f365b4aff96dc7bb3e` | 0.016 | 1: Solanke-Mitchell | audit ✓ |  |
| 130851426 | Moments | Gallagher.mp4 | 26.067 | `6ad911f665b4aff96dc7bb4b` | 0.002 | 1: Gallagher | audit ✓ |  |
| 130851423 | Moments | Goal Man United 9x16 (A) v1.mp4 | 30.56 | `6ad911f4968fe117efe70655` | 0.01 | 7: Tonali, Oliveira, Marmoush, Solanke-Mitchell… | audit ✓; stored (2026-10-22T22:35Z) |  |
| 130851421 | Moments | Goal Slo Mo Man United 9x16 (A) v1.mp4 | 45.96 | `6ad911f32cc348c0bd20121c` | 0.013 | 5: Solanke-Mitchell, Marmoush, Oliveira, Gray… | audit ✓; stored (2026-10-22T22:37Z) |  |
| 130851427 | Moments | Limbs Man United 9x16 (A) v2.mp4 | 17.2 | `6ad911f60ca748ea3c0aa65d` | 0.016 | none listed | audit ✓; stored (2026-10-22T22:35Z) |  |
| 130851361 | Full Match | Manchester United vs Spurs / Full Match / 2026-27.mp4 | 6334.96 | `6ad911e9500e82756f2eb4eb` | 0.037 | 11: Solanke-Mitchell, Kinský, Hecke, Tonali… | audit ✗ TECHNICAL_LIMITATION: video too long for analysis (>60 min; 6335 s) — no Pegasus observati |  |
| 130851440 | Moments | RDZ United.mp4 | 59.142 | `6ad911fd968fe117efe70691` | 0.015 | 1: Zerbi | audit ✓ |  |
| 130851441 | Moments | Savio cele Man United 9x16 (A) v2.mp4 | 13.44 | `6ad911fe0ca748ea3c0aa69a` | 0 | 1: Oliveira | audit ✓; stored (2026-10-23T03:18Z) |  |
| 130851412 | Creative Video | Slide 1 - Goal.mov | 20.0 | `6ad911ee2cc348c0bd2011f7` | 0.009 | 5: Tonali, Oliveira, Solanke-Mitchell, Marmoush… | audit ✓; stored (2026-10-22T22:35Z) |  |
| 130851430 | Creative Video | Slide 10 - Gray Tackle.mov | 6.52 | `6ad911f8960d8ea7bdd04d32` | 0.006 | 1: Gray | audit ✓ |  |
| 130851431 | Creative Video | Slide 11 - Senesi.mov | 6.36 | `6ad911f9960d8ea7bdd04d3e` | 0.017 | 1: Barón | audit ✓ |  |
| 130851432 | Creative Video | Slide 12 - Bergvall.mov | 7.84 | `6ad911f85411fa6e602f4610` | 0.009 | none listed | audit ✓ |  |
| 130851433 | Creative Video | Slide 13 - Kinsky.mov | 5.32 | `6ad911f95411fa6e602f4621` | 0.012 | none listed | audit ✓ |  |
| 130851434 | Creative Video | Slide 14 - Savio.mov | 11.28 | `6ad911fa65b4aff96dc7bb70` | 0.004 | 1: Oliveira | audit ✓ |  |
| 130851435 | Creative Video | Slide 15 - CG.mov | 7.64 | `6ad911fa4a68f3b40321d6aa` | 0.017 | 1: Gallagher | audit ✓ |  |
| 130851436 | Creative Video | Slide 16 -Tonali.mov | 4.92 | `6ad911fb65b4aff96dc7bb78` | 0.006 | 1: Tonali | audit ✓ |  |
| 130851437 | Creative Video | Slide 17 - Stadium GV.mov | 7.48 | `6ad911fb500e82756f2eb574` | 0.006 | none listed | audit ✓; stored (2026-10-23T03:18Z) |  |
| 130851438 | Creative Video | Slide 18 - Away End FT.mov | 6.96 | `6ad911fd2cc348c0bd20125c` | 0.014 | none listed | audit ✓; stored (2026-10-22T22:35Z) |  |
| 130851439 | Creative Video | Slide 19 - Players Clapping Fans.mov | 15.28 | `6ad911fc0ca748ea3c0aa687` | 0.014 | 9: Tonali, Adarabioyo, Maddison, Bergvall… | audit ✓; stored (2026-10-22T22:36Z) |  |
| 130851413 | Creative Video | Slide 2 -Players Out for Warm Ups.mov | 9.56 | `6ad911ef500e82756f2eb512` | 0.017 | 5: Solanke-Mitchell, Ven, Hecke, Barón… | audit ✓; stored (2026-10-22T23:37Z) |  |
| 130851414 | Creative Video | Slide 3 - Warm Ups.mov | 4.96 | `6ad911ef65b4aff96dc7bb23` | 0.009 | none listed | audit ✓ |  |
| 130851417 | Creative Video | Slide 4 - Dad with his boy.mov | 5.72 | `6ad911f2960d8ea7bdd04cfe` | 0.017 | none listed | audit ✓; stored (2026-10-22T22:35Z) |  |
| 130851416 | Creative Video | Slide 5 - Savio to Camera.mov | 5.2 | `6ad911f15411fa6e602f45e4` | 0.004 | 1: Oliveira | audit ✓; stored (2026-10-22T23:37Z) |  |
| 130851415 | Creative Video | Slide 6 - Away End Singing Pre-KO.mov | 10.04 | `6ad911f0960d8ea7bdd04ced` | 0.006 | none listed | audit ✓; stored (2026-10-22T22:35Z) |  |
| 130851418 | Creative Video | Slide 7 - Teams Out.mov | 7.08 | `6ad911f165b4aff96dc7bb2f` | 0.001 | 1: Solanke-Mitchell | audit ✓ |  |
| 130851428 | Creative Video | Slide 8 - Can't Smile without you Pre-KO.mov | 13.84 | `6ad911f765b4aff96dc7bb5e` | 0.004 | none listed | audit ✓; stored (2026-10-22T22:36Z) |  |
| 130851429 | Creative Video | Slide 9 - KO.mov | 5.0 | `6ad911f79c038876f358b02f` | 0.012 | none listed | audit ✓ |  |
| 130851443 | Moments | Solanke early chance.mp4 | 19.6 | `6ad911fe5411fa6e602f4640` | 0.005 | 1: Solanke-Mitchell | audit ✓ |  |
| 130851425 | Moments | kudus chance_1.mp4 | 26.0 | `6ad911f55411fa6e602f45f7` | 0.005 | 1: Kudus | audit ✓ |  |
| 130851442 | Moments | savio chance.mp4 | 19.1 | `6ad911ff0ca748ea3c0aa69d` | 0.014 | none listed | audit ✓ |  |
| 130851444 | Moments | solanke late goal.mp4 | 30.4 | `6ad91200968fe117efe706a5` | 0 | 3: Solanke-Mitchell, Zerbi, Tonali | audit ✓; stored (2026-10-23T03:18Z) |  |
| 130851445 | Moments | solanke over the bar.mp4 | 28.4 | `6ad9120265b4aff96dc7bbb2` | 0.016 | 2: Solanke-Mitchell, Zerbi | audit ✗ Pegasus output truncated  |  |

## 6. San Antonio Spurs inventory (65, ScorePlay only)

| ScorePlay id | Folder | Filename | Duration s | ScorePlay people | ScorePlay sponsor facts | Recorded |
|---|---|---|---|---|---|---|
| 130907170 | Social Edits | 10.17_NDE_TeamWin_9x16.mp4 | 71.446 | 10: Bryant, Johnson, Harper, Castle… | — | 2026-10-17 |
| 130907171 | Social Edits | Dev_Three_4x5.mp4 | 4.004 | none listed | — | 2026-10-17 |
| 130907175 | Social Edits | Dylan 3_Team Pass_4x5.mp4 | 13.555 | 2: Kornet, Harper | Ledger | 2026-10-17 |
| 130907172 | Social Edits | Dylan tuff lay and 1_4x5.mp4 | 10.636 | 2: Vassell, Harper | — | 2026-10-17 |
| 130907173 | Social Edits | DylanOnShotConfidence_PostgameBite_261016_9x16.mp4 | 38.4 | 2: Castle, Harper | — | 2026-10-17 |
| 130907174 | Social Edits | FoxDrive.mp4 | 6.465 | 2: Champagnie, Fox | — | 2026-10-17 |
| 130907177 | Social Edits | Harper14PTRun_2_NDE_vs_SAC_261016_9x16.mp4 | 30.822 | 2: Castle, Harper | Ledger | 2026-10-17 |
| 130907287 | Social Edits | HarperComp_vs_SAC_261016_9x16.mp4 | 28.904 | 3: Garcia, Gillespie, Johnson | Ledger | 2026-10-17 |
| 130907289 | Social Edits | Ja'Kobi Cross 3pt_4x5.mp4 | 8.508 | 2: Gillespie, Brown | Ledger | 2026-10-17 |
| 130907290 | Social Edits | JuThree.mp4 | 5.464 | 3: Champagnie, Castle, Johnson | — | 2026-10-17 |
| 130907320 | Social Edits | KJ and 1 lay_Tongue Out _9x16.mp4 | 8.717 | 1: Johnson | — | 2026-10-17 |
| 130907325 | Social Edits | KJ and 1_Tongue out_4x5.mp4 | 9.176 | 1: Johnson | — | 2026-10-17 |
| 130907326 | Social Edits | Luke on Tarris already being impactful.mp4 | 45.504 | 1: Kornet | Ledger | 2026-10-16 |
| 130907427 | Social Edits | S11_Dunk_4x5.mp4 | 7.799 | 2: Bryant, Brown | — | 2026-10-17 |
| 130907439 | Social Edits | S17_Three_4x5.mp4 | 7.508 | 1: Gillespie | — | 2026-10-17 |
| 130907350 | Social Edits | S2_dribble + layup_4x5.mp4 | 6.006 | 1: Harper | — | 2026-10-17 |
| 130907351 | Social Edits | S2_dribble + layup_9x16.mp4 | 6.006 | 1: Harper | — | 2026-10-17 |
| 130907442 | Social Edits | S30_Three_4x5.mp4 | 5.464 | 1: Champagnie | — | 2026-10-17 |
| 130907352 | Social Edits | S3_layup (assist from S10)_4x5.mp4 | 5.839 | 1: Johnson | — | 2026-10-17 |
| 130907354 | Social Edits | S4 AND 1-259A-.mov | 16.65 | 3: Champagnie, Wembanyama, Fox | Ledger | 2026-10-22 |
| 130907462 | Social Edits | S40 3PT-332A-.mov | 15.048 | 1: Barnes | Ledger | 2026-10-22 |
| 130907467 | Social Edits | S40_Three_4x5.mp4 | 6.34 | 2: Johnson, Bryant | — | 2026-10-17 |
| 130907419 | Social Edits | S4_Fox and 1_4x5.mp4 | 5.339 | 3: Champagnie, Wembanyama, Fox | Sprite | 2026-10-17 |
| 130916313 | Raw Footage | S5 3PT-322A-.mov | 16.717 | 2: Castle, Johnson | Ledger | 2026-10-22 |
| 130916308 | Raw Footage | S5 3PT-322B-.mov | 16.717 | 4: Castle, Nielsen, Donovan, Sevening | Frost Bank | 2026-10-22 |
| 130916312 | Raw Footage | S5 3PT-329B-.mov | 23.557 | 11: Barnes, Castle, Johnson, Gillespie… | Ledger | 2026-10-22 |
| 130916309 | Raw Footage | S5 DRIVE-218A-.mov | 7.374 | none listed | — | 2026-10-22 |
| 130916310 | Raw Footage | S5 DRIVE-231A-.mov | 16.316 | 2: Harper, Castle | H-E-N, Ledger, Frost Bank | 2026-10-22 |
| 130916311 | Raw Footage | S5 DRIVE-237A-.mov | 17.05 | 4: Castle, Harper, Wembanyama, Champagnie | Ledger | 2026-10-22 |
| 130916314 | Raw Footage | S5 DRIVE-237B-.mov | 17.05 | 6: Johnson, Nielsen, King, Kornet… | Ledger, Frost Bank | 2026-10-22 |
| 130917837 | Raw Footage | S5 GLASS-222A-.mov | 25.626 | 5: Castle, Kornet, Vassell, Wembanyama… | Ledger | 2026-10-22 |
| 130919196 | Raw Footage | S5 GLASS-222B-.mov | 25.626 | 3: Harper, Castle, Johnson | Ledger | 2026-10-22 |
| 130920117 | Raw Footage | S5 J-213A-.mov | 6.974 | none listed | — | 2026-10-22 |
| 130920119 | Raw Footage | S5 LAY-226A-.mov | 22.289 | 3: Harper, Castle, Quaintance | Ledger, Frost Bank | 2026-10-22 |
| 130921220 | Raw Footage | S5 LAY-226B-.mov | 22.289 | 3: Harper, Wembanyama, Castle | Ledger | 2026-10-22 |
| 130923146 | Raw Footage | S5 PULL J-227A-.mov | 16.083 | 4: Castle, Fox, Harper, Wembanyama | Ledger, H-E-N | 2026-10-22 |
| 130925391 | Raw Footage | S5 PULL J-227B-.mov | 16.083 | 2: Castle, Harper | Ledger | 2026-10-22 |
| 130925648 | Raw Footage | S5 STL JAM!-247A-.mov | 18.552 | 3: Champagnie, Fox, Castle | H-E-N, Ledger | 2026-10-22 |
| 130926415 | Raw Footage | S5 STL JAM!-247B-.mov | 18.552 | 1: Castle | Ledger | 2026-10-22 |
| 130929128 | Raw Footage | S5 TAKE-232A-.mov | 25.425 | 4: Harper, Champagnie, Castle, Wembanyama | Ledger | 2026-10-22 |
| 130929724 | Raw Footage | S5 TAKE-232B-.mov | 25.425 | 9: Champagnie, Harper, King, Brown… | Ledger | 2026-10-22 |
| 130929725 | Raw Footage | S5 WINDMILL-247A-.mov | 26.927 | 3: Johnson, Wembanyama, Castle | Frost Bank, Ledger | 2026-10-22 |
| 130929726 | Raw Footage | S5 WINDMILL-247B-.mov | 26.927 | 6: Johnson, Castle, Nielsen, Fox… | Ledger | 2026-10-22 |
| 130907420 | Social Edits | S5_Dunk_4x5.mp4 | 6.757 | 1: Castle | — | 2026-10-17 |
| 130907423 | Social Edits | S5_Dunk_9x16.mp4 | 6.757 | 1: Castle | — | 2026-10-17 |
| 130931611 | Raw Footage | S7 BLK-251A-.mov | 35.769 | 4: Vassell, Johnson, Kornet, Harper | Ledger, Frost Bank | 2026-10-22 |
| 130931613 | Raw Footage | S7 BLOCK-252A-.mov | 12.846 | 5: Harper, Kornet, Johnson, Barnes… | Ledger | 2026-10-22 |
| 130932655 | Raw Footage | S7 BLOCK-252B-.mov | 12.846 | 2: Kornet, Johnson | Ledger | 2026-10-22 |
| 130933421 | Raw Footage | S7 BLOCK-252C-.mov | 12.846 | none listed | Ledger | 2026-10-22 |
| 130934176 | Raw Footage | S7 BLOCK-252D-.mov | 12.846 | 3: Kornet, Johnson, Vassell | Ledger, Frost Bank | 2026-10-22 |
| 130907543 | Social Edits | Steph Windmill Speed Ramp_4x5.mp4 | 11.553 | 1: Castle | — | 2026-10-17 |
| 130907544 | Social Edits | Steph Windmill Speed Ramp_9x16.mp4 | 11.511 | 1: Castle | — | 2026-10-17 |
| 130907571 | Social Edits | TeamReadyForTuesday_PostgameBite_261016_9x16.mp4 | 19.233 | 2: Castle, Harper | — | 2026-10-17 |
| 130907572 | Social Edits | Vic FB Backboard Oop_4x5.mp4 | 14.848 | 1: Wembanyama | Ledger | 2026-10-17 |
| 130907602 | Social Edits | Vic FB Backboard Oop_9x16.mp4 | 14.598 | 1: Wembanyama | Ledger | 2026-10-17 |
| 130907603 | Social Edits | Vic one hand jam!!_9x16.mp4 | 7.299 | 1: Wembanyama | — | 2026-10-17 |
| 130907646 | Social Edits | VicDropsSabonis_vs_SAC_261016_9x16.mp4 | 9.551 | 3: Wembanyama, Castle, Johnson | — | 2026-10-17 |
| 130907679 | Social Edits | VicDunkCompQ1_vs_SAC_261016_9x16.mp4 | 14.306 | 1: Wembanyama | Ledger | 2026-10-17 |
| 130907632 | Social Edits | Vic_Dunk_#2_NOAUDIO.mp4 | 4.046 | 1: Wembanyama | — | 2026-10-17 |
| 130907643 | Social Edits | Vic_Dunk_#3_16x9.mp4 | 7.883 | 3: Sevening, Johnson, Wembanyama | — | 2026-10-17 |
| 130907642 | Social Edits | Vic_Dunk_#3_4x5.mp4 | 7.883 | 3: Johnson, Sevening, Wembanyama | — | 2026-10-17 |
| 130934179 | Raw Footage | X S1 DUNK!-411C-.mov | 83.283 | 5: Wembanyama, Champagnie, Vassell, Harper… | Ledger | 2026-10-22 |
| 130937327 | Raw Footage | X S1 JAM !!-427A-.mov | 141.341 | 8: Williamson, Donovan, Nielsen, Wembanyama… | Ledger | 2026-10-22 |
| 130937328 | Raw Footage | X S1 JAM !!-427B-.mov | 141.341 | 17: Johnson, Johnson, Sevening, Williamson… | Ledger | 2026-10-22 |
| 130948982 | Raw Footage | X S1 JAM-423A-.mov | 152.553 | 4: Castle, Wembanyama, Harper, Champagnie | Ledger, Frost Bank | 2026-10-22 |

## 7. Moment catalog (81 moments)

Verdict codes per usage, in order **Editorial · Organic · Sponsored · Commercial**: `A` allowed (demo policy), `R` needs review, `B` blocked. Territory GB/US on Instagram (NBA rows: FR and US on Instagram).
Evaluation path: rows matching a product moment were evaluated through the product (`decideCampaign`, product-stored Pegasus analysis); other whole clips through the same rights engine offline with the audit-run evidence (see JSON `policyEvaluation.path`). Sources: `WHOLE_CLIP`, `MARENGO` (timestamps from TwelveLabs search), `PEGASUS`, `SCOREPLAY_METADATA`.
AI marks: ✓✓ seen in both Pegasus runs · ✓ audit run only · ◦ product-stored run only.

| ID | Asset (ScorePlay id) | Range | Source | AI observed (brand/person, ✓✓ = both runs) | ScorePlay people | GB·IG | US·IG | Conf. | Human check |
|---|---|---|---|---|---|---|---|---|---|
| THFC-001 | Archie tackle.mp4 (130851424) | 0:00.0–0:13.6 | WHOLE_CLIP | brand Sky Bet 0:00.0–0:13.6✓; brand Sky 0:00.0–0:13.6✓✓; person Archie Gray 0:04.0–0:10.2✓✓; bcast Sky Sports 0:00.0–0:13.6✓; person Son 0:01.0–0:02.9◦; +1 | none listed | AABB | AABB | MEDIUM | yes |
| THFC-002 | Gallagher.mp4 (130851426) | 0:00.0–0:26.1 | WHOLE_CLIP | brand sumup 0:00.0–0:03.0✓; brand adidas 0:06.0–0:11.0✓; brand Snapdragon 0:22.0–0:23.0✓; brand AIA 0:21.0–0:25.0✓; brand No room for racism 0:13.0–0:14.0✓; +12 | Conor Gallagher | AABB | AABB | MEDIUM | yes |
| THFC-003 | Slide 10 - Gray Tackle.mov (130851430) | 0:00.0–0:06.5 | WHOLE_CLIP | brand AIA 0:00.0–0:06.5✓; brand Nike 0:00.0–0:06.5✓; brand TeamViewer 0:00.0–0:06.5✓; person 14 GRAY 0:00.0–0:06.5✓ | Archie Gray | AABB | AABB | MEDIUM | yes |
| THFC-004 | Slide 11 - Senesi.mov (130851431) | 0:00.0–0:06.4 | WHOLE_CLIP | brand AIA 0:00.0–0:06.4✓; person SENESI 0:00.0–0:06.4✓; person Player 16 0:05.5–0:06.4✓; bcast Spurs TV 0:00.0–0:06.4✓ | Marcos Barón | AARR | AARR | MEDIUM | yes |
| THFC-005 | Slide 12 - Bergvall.mov (130851432) | 0:00.0–0:07.8 | WHOLE_CLIP | brand MUNTOT 0:00.0–0:07.8✓; brand AIA 0:00.0–0:07.8✓; person BERGVALL 0:00.0–0:07.8✓; person Player #3 0:00.0–0:02.0✓; person Player #5 0:01.0–0:04.5✓; +2 | none listed | AABB | AABB | MEDIUM | yes |
| THFC-006 | Slide 13 - Kinsky.mov (130851433) | 0:00.0–0:05.3 | WHOLE_CLIP | brand sky 0:00.0–0:05.3✓; brand AIA 0:00.0–0:05.3✓; brand TeamViewer 0:00.0–0:05.3✓; person Bruno Fernandes 0:01.0–0:02.5✓; person Amad Diallo 0:04.0–0:05.3✓; +2 | none listed | AABB | AABB | MEDIUM | yes |
| THFC-007 | Slide 14 - Savio.mov (130851434) | 0:00.0–0:11.3 | WHOLE_CLIP | brand Nike 0:00.0–0:11.3✓; brand AIA 0:00.0–0:11.3✓; brand TeamViewer 0:00.0–0:11.3✓; person Savio 0:00.0–0:11.3✓; bcast Tottenham Hotspur 0:00.0–0:11.3✓ | Sávio Oliveira | AABB | AABB | MEDIUM | yes |
| THFC-008 | Slide 15 - CG.mov (130851435) | 0:00.0–0:07.6 | WHOLE_CLIP | brand AIA 0:00.0–0:07.6✓; person Gallagher 0:00.0–0:07.6✓; person Amad Diallo 0:03.0–0:07.6✓; bcast Tottenham Hotspur 0:00.0–0:07.6✓ | Conor Gallagher | AARR | AARR | MEDIUM | yes |
| THFC-009 | Slide 16 -Tonali.mov (130851436) | 0:00.0–0:04.9 | WHOLE_CLIP | brand AIA 0:00.0–0:04.9✓; brand Nike 0:00.0–0:04.9✓; person TCHALY 0:00.0–0:04.9✓; person SANCHO 0:00.0–0:00.5✓; bcast Tottenham Hotspur 0:00.0–0:04.9✓ | Sandro Tonali | AARR | AARR | MEDIUM | yes |
| THFC-010 | Slide 9 - KO.mov (130851429) | 0:00.0–0:05.0 | WHOLE_CLIP | brand AIA 0:00.0–0:05.0✓; person Player #8 0:00.0–0:05.0✓; bcast Tottenham Hotspur 0:00.0–0:05.0✓ | none listed | AARR | AARR | MEDIUM | yes |
| THFC-011 | Solanke early chance.mp4 (130851443) | 0:00.0–0:19.6 | WHOLE_CLIP | brand Lammens 0:07.5–0:12.5✓; brand Philips 0:07.5–0:12.5✓; brand Nike 0:13.0–0:14.0✓; brand Tottenham Hotspur 0:13.0–0:14.0✓; brand Adidas 0:10.0–0:12.5✓; +3 | Dominic Solanke-Mitchell | AABB | AABB | MEDIUM | yes |
| THFC-012 | kudus chance_1.mp4 (130851425) | 0:00.0–0:26.0 | WHOLE_CLIP | brand DHL 0:00.0–0:13.0✓; person Kudus 0:13.5–0:15.0✓; brand DHL 0:19.0–0:26.0✓; person Tonali 0:19.0–0:26.0✓; person Savio 0:06.5–0:12.0✓; +1 | Mohammed Kudus | AABB | AABB | MEDIUM | yes |
| THFC-013 | savio chance.mp4 (130851442) | 0:00.0–0:19.1 | WHOLE_CLIP | brand Tiger 0:00.0–0:04.5✓; brand Vredestein Tyres 0:08.5–0:19.1✓; brand Snapdragon 0:13.0–0:15.0✓; brand sumup 0:14.5–0:17.0✓; person Savio 0:04.5–0:12.0✓; +2 | none listed | AABB | AABB | MEDIUM | yes |
| THFC-014 | solanke over the bar.mp4 (130851445) | 0:00.0–0:28.4 | WHOLE_CLIP | — | Dominic Solanke-Mitchell, Roberto Zerbi | AARR | AARR | LOW | yes |
| THFC-015 | 9x16_MNU_0_3_TOT_PL_18_19_HIGHLIGHTS.mp4 (130851266) | 0:00.0–1:32.3 | WHOLE_CLIP | brand The Betting App 0:02.0–0:05.0✓✓; brand MoPlay 0:03.0–0:06.0✓✓; brand AIA 0:08.0–0:13.0✓✓; brand AIA 0:38.0–0:45.0✓; brand adidas 0:58.0–1:01.0✓✓; +14 | none listed | AABB | AABB | MEDIUM | yes |
| THFC-016 | 9x16_MNU_1_6_TOT_20_21_HIGHLIGHTS.mp4 (130851267) | 0:00.0–2:39.2 | WHOLE_CLIP | brand yabo 0:00.0–0:06.0✓✓; brand adidas 0:00.0–0:06.0✓✓; brand Chevrolet 0:00.0–0:06.0✓✓; person Bruno Fernandes 0:06.0–0:09.0✓✓; person Rashford 0:08.0–0:10.0✓; +15 | none listed | AABB | AABB | MEDIUM | yes |
| THFC-017 | 9x16_MNU_1_6_TOT_20_21_HIGHLIGHTS_2.mp4 (130851268) | 0:00.0–2:39.2 | WHOLE_CLIP | brand adidas 0:00.0–0:06.0✓✓; brand Chevrolet 0:00.0–0:06.0✓✓; brand yabo 0:00.0–0:06.0✓✓; person Bruno Fernandes 0:06.0–0:10.0✓✓; person Bashford 0:08.0–0:10.0✓; +20 | none listed | AABB | AABB | MEDIUM | yes |
| THFC-018 | Man Utd (A) Previously Against.mp4 (130851452) | 0:00.0–0:18.5 | WHOLE_CLIP | brand PRAVHA 0:00.0–0:18.5✓✓; brand BETFRED 0:04.0–0:09.0✓✓; brand AIA 0:10.0–0:18.5✓; person Brennan Johnson 0:17.0–0:18.5✓✓; person Dejan Kulusevski 0:15.0–0:17.0✓✓; +3 | Micky Ven | AABB | AABB | MEDIUM | yes |
| THFC-019 | 16x9_MNU_1_1_TOT_KEY_HIGHLIGHTS.mp4 (130851359) | 0:00.0–2:01.8 | WHOLE_CLIP | brand DHL 0:08.0–0:14.0✓✓; brand betway 0:15.0–0:21.0✓✓; brand sumup 0:23.0–0:26.0✓✓; brand Vedstein Tyres 0:36.0–0:43.0✓✓; brand EA SPORTS FC 0:44.0–0:49.0✓✓; +25 | James Maddison, Dominic Solanke-Mitchell, Micky Ven +5 | AABB | AABB | MEDIUM | yes |
| THFC-020 | 9x16_DEF_ACTIONS_VS_MNU.mp4 (130851357) | 0:00.0–2:00.6 | WHOLE_CLIP | — | none listed | AARB | AARB | LOW | yes |
| THFC-021 | 9x16_MNU_1_1_TOT_HIGHLIGHTS.mp4 (130851358) | 0:00.0–1:59.4 | WHOLE_CLIP | brand DHL 0:08.0–0:14.0✓✓; brand betway 0:15.0–0:21.0✓✓; brand sumup 0:23.0–0:26.0✓✓; brand adidas 0:27.0–0:31.0✓✓; brand VEDESTEIN TYRES 0:36.0–0:42.0✓; +24 | Sávio Oliveira, Rodrigo Colmán, Sandro Tonali +4 | AABB | AABB | MEDIUM | yes |
| THFC-022 | Manchester United vs Spurs / Extended Highlights / 2026-27.mp4 (130851360) | 0:00.0–8:29.7 | WHOLE_CLIP | brand Snapdragon 0:04.0–0:13.0◦; brand AIA 0:04.0–0:13.0◦; brand Premier League 0:04.0–0:07.0◦; brand DHL 1:04.0–1:19.0◦; brand betway 0:52.0–0:55.0◦; +28 | Dominic Solanke-Mitchell, Antonín Kinský, Jan Hecke +1 | AARB | AARB | MEDIUM | yes |
| THFC-023 | Manchester United vs Spurs / Full Match / 2026-27.mp4 (130851361) | 0:00.0–1:45:35.0 | WHOLE_CLIP | — | Dominic Solanke-Mitchell, Antonín Kinský, Jan Hecke +8 | AARB | BBBB | LOW | yes |
| THFC-024 | Limbs Man United 9x16 (A) v2.mp4 (130851427) | 0:00.0–0:17.2 | WHOLE_CLIP | — | none listed | AAAA | AAAA | HIGH | no |
| THFC-025 | Slide 17 - Stadium GV.mov (130851437) | 0:00.0–0:07.5 | WHOLE_CLIP | brand STRETFORD END 0:00.0–0:07.5✓✓; person Player #53 0:00.0–0:07.5✓ | none listed | AABB | AABB | MEDIUM | yes |
| THFC-026 | Slide 18 - Away End FT.mov (130851438) | 0:00.0–0:07.0 | WHOLE_CLIP | brand Tottenham Hotspur 0:00.0–0:07.0✓✓ | none listed | AAAA | AAAA | HIGH | no |
| THFC-027 | Slide 4 - Dad with his boy.mov (130851417) | 0:00.0–0:05.7 | WHOLE_CLIP | bcast Tottenham Hotspur 0:00.0–0:05.7✓✓; brand Tottenham Hotspur 0:00.0–0:05.7✓✓ | none listed | AAAA | AAAA | HIGH | yes |
| THFC-028 | Slide 6 - Away End Singing Pre-KO.mov (130851415) | 0:00.0–0:10.0 | WHOLE_CLIP | bcast Tottenham Hotspur 0:00.0–0:10.0✓; bcast Spurs logo 0:00.0–0:10.0◦ | none listed | AAAA | AAAA | HIGH | no |
| THFC-029 | Goal Man United 9x16 (A) v1.mp4 (130851423) | 0:00.0–0:30.6 | WHOLE_CLIP | brand AIA 0:00.0–0:02.0✓✓; brand Kraken 0:00.0–0:02.0✓✓; brand AIA 0:06.0–0:11.0✓✓; brand Kraken 0:06.0–0:11.0✓✓; brand Nike 0:00.0–0:30.6✓✓; +9 | Sandro Tonali, Sávio Oliveira, Omar Marmoush +4 | AABB | AABB | MEDIUM | yes |
| THFC-030 | Goal Slo Mo Man United 9x16 (A) v1.mp4 (130851421) | 0:00.0–0:46.0 | WHOLE_CLIP | brand SUMU 0:00.0–0:14.0✓✓; brand AIA 0:00.0–0:46.0✓✓; brand kraken 0:15.0–0:46.0✓; person McTominay 0:00.0–0:05.0✓; person Solanke 0:05.0–0:46.0✓✓; +10 | Dominic Solanke-Mitchell, Omar Marmoush, Sávio Oliveira +2 | AABB | AABB | MEDIUM | yes |
| THFC-031 | Savio cele Man United 9x16 (A) v2.mp4 (130851441) | 0:00.0–0:13.4 | WHOLE_CLIP | brand AIA 0:00.0–0:13.4✓✓; brand Nike 0:00.0–0:13.4✓✓; brand EA SPORTS 0:00.0–0:13.4✓; person Player #17 0:00.0–0:13.4✓✓; brand Premier League 0:00.0–0:13.4◦ | Sávio Oliveira | AABB | AABB | MEDIUM | yes |
| THFC-032 | Slide 1 - Goal.mov (130851412) | 0:00.0–0:20.0 | WHOLE_CLIP | brand AIA 0:00.0–0:20.0✓✓; brand DHL 0:00.0–0:05.0✓✓; brand SUMUP 0:03.0–0:05.0✓✓; person 19 SCLANKE 0:00.0–0:20.0✓; person Player 17 0:00.0–0:13.0✓✓; +3 | Sandro Tonali, Sávio Oliveira, Dominic Solanke-Mitchell +2 | AABB | AABB | MEDIUM | yes |
| THFC-033 | Solanke Goal.mp4 (130851321) | 0:00.0–0:58.9 | WHOLE_CLIP | brand AIA 0:04.0–0:06.0✓✓; brand AIA 0:29.0–0:34.0✓✓; brand AIA 0:48.0–0:50.0✓✓; brand SumUp 0:16.0–0:25.0✓✓; brand Betway 0:40.0–0:47.0✓✓; +22 | James Maddison | AABB | AABB | LOW | yes |
| THFC-034 | solanke late goal.mp4 (130851444) | 0:00.0–0:30.4 | WHOLE_CLIP | brand Cashback 0:00.0–0:02.0✓✓; brand sumup 0:00.0–0:09.0✓✓; brand AIA 0:10.0–0:19.0✓✓; brand DHL 0:15.0–0:17.0✓; brand Snapdragon 0:28.0–0:29.0✓✓; +4 | Dominic Solanke-Mitchell, Roberto Zerbi, Sandro Tonali | AABB | AABB | MEDIUM | yes |
| THFC-035 | 261009_Men_De Zerbi Pre Match Man Utd A_16x9.mp4 (130851451) | 0:00.0–4:03.0 | WHOLE_CLIP | brand Betano 0:10.0–0:26.0✓✓; person Roberto De Zerbi 0:27.0–0:29.0✓✓; brand Betano 0:29.0–0:33.0✓✓; brand Betano 0:45.0–1:12.0✓✓; brand Betano 1:16.0–1:21.0✓✓; +8 | Roberto Zerbi, Rodrigo Colmán, James Maddison +7 | AABB | AABB | MEDIUM | yes |
| THFC-036 | 261009_Men_De Zerbi Pre Match Man Utd A_9x16 CLIP.mp4 (130851450) | 0:00.0–0:25.9 | WHOLE_CLIP | brand Betano 0:07.0–0:25.9✓✓; brand Nike 0:07.0–0:25.9✓; person SPEAKER_01 0:00.0–0:25.9✓ | Roberto Zerbi | AABB | AABB | MEDIUM | yes |
| THFC-037 | 9x16_RDZ_ON_DEKI.mp4 (130851382) | 0:00.0–0:23.9 | WHOLE_CLIP | brand Betano 0:00.0–0:23.9✓; brand Nike 0:00.0–0:23.9✓; person Deke Kulusevski 0:00.0–0:23.9✓ | Roberto Zerbi | AABB | AABB | MEDIUM | yes |
| THFC-038 | 9x16_RDZ_ON_FERNANDES.mp4 (130851383) | 0:00.0–0:48.9 | WHOLE_CLIP | brand Betano 0:00.0–0:48.9✓; brand THFC 0:00.0–0:48.9✓; brand Nike 0:00.0–0:48.9✓; person Mateus Fernandes 0:00.0–0:05.4✓ | Roberto Zerbi | AABB | AABB | MEDIUM | yes |
| THFC-039 | 9x16_TEAM_NEWS_MAN_UTD.mp4 (130851386) | 0:00.0–0:52.4 | WHOLE_CLIP | brand Betano 0:00.0–0:52.4✓; brand Nike 0:00.0–0:52.4✓; person Micky van de Ven 0:02.0–0:05.0✓; person JP van Hecke 0:06.0–0:15.0✓; person James Maddison 0:23.0–0:26.0✓; +3 | Roberto Zerbi | AABB | AABB | MEDIUM | yes |
| THFC-040 | 9x16_TEAM_NEWS_MAN_UTD_2.mp4 (130851384) | 0:00.0–0:52.4 | WHOLE_CLIP | brand Betano 0:00.0–0:52.4✓; brand Nike 0:00.0–0:52.4✓; brand Tottenham Hotspur 0:00.0–0:52.4✓; person Micky van de Ven 0:02.0–0:05.0✓; person J.P. van Hecke 0:06.0–0:08.0✓; +4 | Roberto Zerbi | AABB | AABB | MEDIUM | yes |
| THFC-041 | Dom United Subs.mp4 (130851422) | 0:00.0–0:43.1 | WHOLE_CLIP | brand Nike 0:00.0–0:43.1✓; brand AIA 0:00.0–0:43.1✓; bcast SPURS TV 0:00.0–0:43.1✓ | Dominic Solanke-Mitchell | AAAA | AAAA | MEDIUM | no |
| THFC-042 | IMG_2434.MOV (130851323) | 0:00.0–0:19.1 | WHOLE_CLIP | brand Nike 0:00.0–0:19.1✓✓; brand Tottenham Hotspur 0:00.0–0:19.1✓✓; person James Maddison 0:00.0–0:19.1✓; person Manor Solomon 0:00.0–0:19.1◦ | Conor Gallagher | AARR | AARR | LOW | yes |
| THFC-043 | Press Conference: De Zerbi speaks to the media ahead of Manchester United trip.mp4 (130851385) | 0:00.0–12:05.5 | WHOLE_CLIP | brand AIA 0:00.0–12:05.5✓; brand Betano 0:00.0–12:05.5✓; brand Nike 0:00.0–12:05.5✓; brand Kraken 0:00.0–12:05.5✓; brand Sports Illustrated 0:00.0–12:05.5✓; +14 | Roberto Zerbi | AABB | AABB | MEDIUM | yes |
| THFC-044 | RDZ United.mp4 (130851440) | 0:00.0–0:59.1 | WHOLE_CLIP | bcast Tottenham Hotspur 0:00.0–0:59.1✓; brand Manchester United 0:22.0–0:59.1✓ | Roberto Zerbi | AABB | AABB | MEDIUM | yes |
| THFC-045 | The mentality is something to build on Solanke on his late equaliser and captaincy against Red Devils.mp4 (130851324) | 0:00.0–2:32.0 | WHOLE_CLIP | brand Nike 0:00.0–2:32.0✓; brand AIA 0:00.0–2:32.0✓; brand Manchester United 0:00.0–2:32.0✓; bcast SPORTSFM 0:00.0–2:32.0✓; person Brennan Johnson 0:00.0–2:32.0✓ | Dominic Solanke-Mitchell | AABB | AABB | MEDIUM | yes |
| THFC-046 | We didn’t deserve to lose De Zerbi proud of togetherness in Man United draw.mp4 (130851322) | 0:00.0–3:34.5 | WHOLE_CLIP | bcast PLAY 0:00.0–3:34.5✓; brand Manchester United 0:00.0–3:34.5✓; person Roberto 0:00.3–3:34.5✓; person Dominic Solanke 2:42.5–2:50.2✓; person Rodrigo 0:13.0–0:17.3✓ | Roberto Zerbi | AABB | AABB | MEDIUM | yes |
| THFC-047 | Fans clap Man United A 9x16.mp4 (130851320) | 0:00.0–0:30.4 | WHOLE_CLIP | brand AIA 0:00.0–0:02.5✓✓; brand Nike 0:00.0–0:02.5✓✓; brand KRAKEN 0:02.5–0:05.0✓✓; brand AIA 0:05.0–0:07.0✓✓; brand Manchester United 0:09.0–0:14.5✓✓; +8 | Sávio Oliveira, Abdul-Nasir Adarabioyo, Sandro Tonali +5 | AABB | AABB | MEDIUM | yes |
| THFC-048 | Slide 19 - Players Clapping Fans.mov (130851439) | 0:00.0–0:15.3 | WHOLE_CLIP | brand AIA 0:00.0–0:15.3✓✓; brand Nike 0:00.0–0:15.3✓✓; person Player #16 0:00.0–0:02.5✓✓; person Player #10 0:02.5–0:04.5✓✓; person Player #15 0:04.5–0:10.0✓✓; +4 | Sandro Tonali, Abdul-Nasir Adarabioyo, James Maddison +6 | AARR | AARR | HIGH | yes |
| THFC-049 | Slide 8 - Can't Smile without you Pre-KO.mov (130851428) | 0:00.0–0:13.8 | WHOLE_CLIP | brand COYS 0:00.0–0:13.8✓✓; brand Tottenham Hotspur Crest 0:00.0–0:13.8✓; person Player #13 0:00.0–0:13.8✓; person Player #3 0:00.0–0:13.8✓✓; person Player #8 0:00.0–0:13.8✓✓ | none listed | AABB | AABB | MEDIUM | yes |
| THFC-050 | 261008_Men_Pre Match Man Utd A_FPL Pick_9x16.mp4 (130851269) | 0:00.0–0:42.4 | WHOLE_CLIP | person Sávio 0:05.8–0:42.4✓; person Andy Robertson 0:19.5–0:23.0✓; brand Fantasy Football Scout 0:00.0–0:05.8✓ | none listed | AABB | AABB | MEDIUM | yes |
| THFC-051 | 261008_Men_Pre Match Man Utd A_Left Back Dilemma_9x16.mp4 (130851446) | 0:00.0–1:58.6 | WHOLE_CLIP | person Roberto De Zerbi 0:00.0–0:33.5✓; person Destiny Udogie 0:00.0–0:33.5✓; person Roberto Firmino 0:11.0–0:22.0✓; person Rodrigo Bentancur 1:28.0–1:34.0✓ | none listed | AARR | AARR | MEDIUM | yes |
| THFC-052 | 261008_Men_Pre Match Man Utd A_Mo Kudus_9x16.mp4 (130851447) | 0:00.0–1:07.4 | WHOLE_CLIP | person Mo Kudus 0:02.0–0:12.0✓; person Carlos Queiroz 0:05.0–0:07.0✓; person Roberto 0:19.0–0:21.0✓; person De Zerbi 0:27.0–0:29.0✓ | none listed | AARR | AARR | MEDIUM | yes |
| THFC-053 | 261008_Men_Pre Match Man Utd A_Podcast Mathys Tel_9x16.mp4 (130851448) | 0:00.0–1:58.4 | WHOLE_CLIP | person Mathys Tel 0:06.0–0:16.0✓; person Omar Marmoush 1:04.0–1:07.0✓ | none listed | AARR | AARR | MEDIUM | yes |
| THFC-054 | 261008_Men_Pre Match Man Utd A_Utd Line Up_9x16.mp4 (130851449) | 0:00.0–1:33.4 | WHOLE_CLIP | person Bruno Fernandes 0:04.0–0:06.0✓; person Michael Carrick 0:16.0–0:18.0✓; person Gus Poyet 0:30.0–0:32.0✓; person Lucas Moura 1:18.0–1:20.0✓ | none listed | AARR | AARR | MEDIUM | yes |
| THFC-055 | Slide 2 -Players Out for Warm Ups.mov (130851413) | 0:00.0–0:09.6 | WHOLE_CLIP | brand Betano 0:00.0–0:09.6✓✓; brand Alipay+ 0:00.0–0:09.6✓✓; brand Manchester United 0:00.0–0:04.5✓✓; person 19 SOLANKE 0:00.0–0:09.6✓✓; person 37 VAN DE VEN 0:00.0–0:09.6✓✓; +1 | Dominic Solanke-Mitchell, Micky Ven, Jan Hecke +2 | AABB | AABB | HIGH | yes |
| THFC-056 | Slide 3 - Warm Ups.mov (130851414) | 0:00.0–0:05.0 | WHOLE_CLIP | brand Betano 0:00.0–0:05.0✓; brand Nike 0:00.0–0:05.0✓; person 31 KINSKY 0:00.0–0:05.0✓; person 8 GALLAGHER 0:00.0–0:05.0✓; bcast Tottenham Hotspur 0:00.0–0:05.0✓ | none listed | AABB | AABB | MEDIUM | yes |
| THFC-057 | Slide 5 - Savio to Camera.mov (130851416) | 0:00.0–0:05.2 | WHOLE_CLIP | brand Betano 0:00.0–0:05.2✓✓; brand Nike 0:00.0–0:05.2✓✓; brand Tottenham Hotspur 0:00.0–0:05.2✓✓; person Savio 0:00.0–0:05.2✓✓; bcast Tottenham Hotspur 0:00.0–0:05.2✓; +1 | Sávio Oliveira | AABB | AABB | MEDIUM | yes |
| THFC-058 | Slide 7 - Teams Out.mov (130851418) | 0:00.0–0:07.1 | WHOLE_CLIP | brand Betano 0:00.0–0:07.1✓; person Solanke 0:00.0–0:07.1✓; bcast Tottenham Hotspur FC 0:00.0–0:07.1✓ | Dominic Solanke-Mitchell | AABB | AABB | MEDIUM | yes |
| THFC-059 | Fans clap Man United A 9x16.mp4 (130851320) | 0:06.9–0:14.7 | MARENGO | brand AIA 0:05.0–0:07.0✓✓; brand Manchester United 0:09.0–0:14.5✓✓; person Player #18 0:05.0–0:07.0✓✓ | Sávio Oliveira, Abdul-Nasir Adarabioyo, Sandro Tonali +5 | AABB | AABB | HIGH | yes |
| THFC-060 | Fans clap Man United A 9x16.mp4 (130851320) | 0:00.0–0:07.0 | PEGASUS | brand AIA 0:00.0–0:02.5✓✓; brand Nike 0:00.0–0:02.5✓✓; brand KRAKEN 0:02.5–0:05.0✓✓; brand AIA 0:05.0–0:07.0✓✓; person Player #17 0:00.0–0:02.5✓✓; +2 | Sávio Oliveira, Abdul-Nasir Adarabioyo, Sandro Tonali +5 | AABB | AABB | HIGH | yes |
| THFC-061 | Slide 6 - Away End Singing Pre-KO.mov (130851415) | 0:01.1–0:08.9 | MARENGO | bcast Tottenham Hotspur 0:00.0–0:10.0✓; bcast Spurs logo 0:00.0–0:10.0◦ | none listed | — | — | HIGH | yes |
| THFC-062 | Limbs Man United 9x16 (A) v2.mp4 (130851427) | 0:02.9–0:10.7 | MARENGO | — | none listed | — | — | HIGH | yes |
| THFC-063 | Slide 1 - Goal.mov (130851412) | 0:05.0–0:20.0 | PEGASUS | brand AIA 0:00.0–0:20.0✓✓; brand DHL 0:00.0–0:05.0✓✓; brand SUMUP 0:03.0–0:05.0✓✓; person 19 SCLANKE 0:00.0–0:20.0✓; person Player 17 0:00.0–0:13.0✓✓; +3 | Sandro Tonali, Sávio Oliveira, Dominic Solanke-Mitchell +2 | AARR | AARR | MEDIUM | yes |
| THFC-064 | solanke late goal.mp4 (130851444) | 0:10.0–0:19.0 | PEGASUS | brand AIA 0:10.0–0:19.0✓✓; brand DHL 0:15.0–0:17.0✓; person Tonalí 0:19.0–0:23.0✓; person Dominic Solanke 0:12.7–0:14.6✓✓ | Dominic Solanke-Mitchell, Roberto Zerbi, Sandro Tonali | AAAA | AAAA | MEDIUM | yes |
| THFC-065 | Goal Slo Mo Man United 9x16 (A) v1.mp4 (130851421) | 0:00.0–0:14.8 | MARENGO | brand SUMU 0:00.0–0:14.0✓✓; brand AIA 0:00.0–0:46.0✓✓; person McTominay 0:00.0–0:05.0✓; person Solanke 0:05.0–0:46.0✓✓; person Fernandes 0:00.0–0:04.0✓; +3 | Dominic Solanke-Mitchell, Omar Marmoush, Sávio Oliveira +2 | — | — | MEDIUM | yes |
| THFC-066 | Goal Slo Mo Man United 9x16 (A) v1.mp4 (130851421) | 0:14.8–0:20.2 | MARENGO | brand AIA 0:00.0–0:46.0✓✓; brand kraken 0:15.0–0:46.0✓; person Solanke 0:05.0–0:46.0✓✓; person Porro 0:15.0–0:21.0✓; person Richarlison 0:15.0–0:25.0◦; +1 | Dominic Solanke-Mitchell, Omar Marmoush, Sávio Oliveira +2 | — | — | MEDIUM | yes |
| THFC-067 | 16x9_MNU_1_1_TOT_KEY_HIGHLIGHTS.mp4 (130851359) | 1:46.0–1:56.0 | PEGASUS | person Solanke 1:48.0–1:59.0✓✓; person Dominic Solanke 1:49.0–1:58.0◦; person Lucas Bergvall 1:55.0–1:58.0◦; person Dejan Kulusevski 1:55.0–1:58.0◦; person Nicolas Jackson 1:49.0–1:52.0◦ | James Maddison, Dominic Solanke-Mitchell, Micky Ven +5 | AARB | AARB | MEDIUM | yes |
| THFC-068 | Manchester United vs Spurs / Full Match / 2026-27.mp4 (130851361) | 0:00.0–0:10.5 | MARENGO | — | Dominic Solanke-Mitchell, Antonín Kinský, Jan Hecke +8 | — | — | LOW | yes |
| THFC-069 | Manchester United vs Spurs / Full Match / 2026-27.mp4 (130851361) | 1:19:12.1–1:19:17.1 | MARENGO | — | Dominic Solanke-Mitchell, Antonín Kinský, Jan Hecke +8 | — | — | LOW | yes |
| THFC-070 | Manchester United vs Spurs / Full Match / 2026-27.mp4 (130851361) | 1:20:35.0–1:20:40.6 | MARENGO | — | Dominic Solanke-Mitchell, Antonín Kinský, Jan Hecke +8 | — | — | LOW | yes |
| THFC-071 | Manchester United vs Spurs / Full Match / 2026-27.mp4 (130851361) | 1:34:07.1–1:34:13.0 | MARENGO | — | Dominic Solanke-Mitchell, Antonín Kinský, Jan Hecke +8 | — | — | LOW | yes |
| THFC-072 | Manchester United vs Spurs / Full Match / 2026-27.mp4 (130851361) | 1:37:07.6–1:37:13.2 | MARENGO | — | Dominic Solanke-Mitchell, Antonín Kinský, Jan Hecke +8 | AARB | BBBB | LOW | yes |
| THFC-073 | Manchester United vs Spurs / Extended Highlights / 2026-27.mp4 (130851360) | 3:02.8–3:07.5 | MARENGO | person Lisandro Martinez 2:57.0–3:04.0◦; bcast Premier League 0:00.0–8:29.7◦ | Dominic Solanke-Mitchell, Antonín Kinský, Jan Hecke +1 | — | — | MEDIUM | yes |
| THFC-074 | Manchester United vs Spurs / Extended Highlights / 2026-27.mp4 (130851360) | 6:39.7–6:45.1 | MARENGO | person Dominic Solanke 6:35.0–6:48.0◦; person Angelo Stiller 6:35.0–6:48.0◦; bcast Premier League 0:00.0–8:29.7◦ | Dominic Solanke-Mitchell, Antonín Kinský, Jan Hecke +1 | — | — | MEDIUM | yes |
| THFC-075 | 9x16_MNU_1_6_TOT_20_21_HIGHLIGHTS_2.mp4 (130851268) | 2:25.0–2:33.0 | MARENGO | brand AIA 0:36.0–2:39.2✓✓; brand Aeroflot 2:25.0–2:39.2✓✓; brand Gulf 2:23.0–2:25.0✓✓; bcast Premier League 0:01.0–2:39.2◦ | none listed | — | — | HIGH | yes |
| THFC-076 | 9x16_MNU_0_3_TOT_PL_18_19_HIGHLIGHTS.mp4 (130851266) | 0:18.1–0:25.9 | MARENGO | person Phil Jones 0:18.0–0:21.0✓✓; bcast Premier League 0:01.0–1:32.3✓✓ | none listed | — | — | HIGH | yes |
| THFC-077 | Press Conference: De Zerbi speaks to the media ahead of Manchester United trip.mp4 (130851385) | 5:31.4–5:40.4 | MARENGO | brand AIA 0:00.0–12:05.5✓; brand Betano 0:00.0–12:05.5✓; brand Nike 0:00.0–12:05.5✓; brand Kraken 0:00.0–12:05.5✓; brand Sports Illustrated 0:00.0–12:05.5✓; +2 | Roberto Zerbi | — | — | MEDIUM | yes |
| THFC-078 | 261009_Men_De Zerbi Pre Match Man Utd A_16x9.mp4 (130851451) | 0:10.0–0:26.0 | PEGASUS | brand Betano 0:10.0–0:26.0✓✓; brand Nike 0:10.0–0:26.0◦ | Roberto Zerbi, Rodrigo Colmán, James Maddison +7 | — | — | MEDIUM | yes |
| NBA-001 | Vic one hand jam!!_9x16.mp4 (130907603) | 0:00.0–0:07.3 | SCOREPLAY_METADATA | — | Victor Wembanyama | AARR (FR) | AARR | LOW | yes |
| NBA-002 | S4_Fox and 1_4x5.mp4 (130907419) | 0:00.0–0:05.3 | SCOREPLAY_METADATA | — | Julian Champagnie, Victor Wembanyama, De'Aaron Fox | AARR (FR) | AARR | LOW | yes |
| NBA-003 | Vic FB Backboard Oop_4x5.mp4 (130907572) | 0:00.0–0:14.8 | SCOREPLAY_METADATA | — | Victor Wembanyama | AARR (FR) | AARR | LOW | yes |

Full per-moment fields (descriptions, rubric, all observations with confidence, Marengo hits, commercial opportunities, candidate objectives, compliance questions, policy matrices incl. FR/MX, provenance, limitations) are in the JSON.

## 8. Cross-cutting findings

| Finding | Evidence | Why it matters |
|---|---|---|
| AI player identity is unreliable | `IMG_2434.MOV` (130851323): ScorePlay tags **Conor Gallagher**; Pegasus named **James Maddison** in one run and **Manor Solomon** in the other, both "by facial recognition" (the prompt forbids face-based identification). `Goal Slo Mo` (130851421): stored run names "Saka" and "Maguire" as Man Utd players and "Richarlison" from shirt #17. | Never let AI identity become a fact. The engine already treats AI-named people as unconfirmed (needs review for sponsored/commercial). |
| Archive footage carries current-season tags | `9x16_MNU_0_3_TOT_PL_18_19_HIGHLIGHTS` and `9x16_MNU_1_6_TOT_20_21_HIGHLIGHTS(_2)` are tagged `2026/27`, `pre-match`, with no player tags; both Pegasus runs see a league-produced scorebug and former players (Kane, Moura, Son). PULSE recommends the 2020/21 clip **#1** for "Get more followers in the UK" and the demo policy allows it for editorial use. | Demo-policy gap: THFC-6 keys only on the `Highlights`/`Full Match` tags. A human must check archive licence terms; a future rule could use `rubric:broadcast_source:league_produced` (not implemented — business rules unchanged). |
| Post-match "Solanke Goal" may be archive | `Solanke Goal.mp4` (130851321): audit run reads SON, RICHARLISON, BISSOUMA, KULUSEVSKI, PORRO, JOHNSON on shirts; ScorePlay tags only Maddison. | Identity/season unverified — human check before any non-editorial use. |
| Training-kit and press-wall brands outside the demo partner list | Betano on training tops (both runs) in `Slide 2/3/5/7`, De Zerbi interviews and press conferences; Alipay+, Kraken, Sports Illustrated on the press wall. | Editorial OK, sponsored/commercial blocked under THFC-13; gambling-brand question is outside the demo policy. |
| Sleeve sponsor not settled by AI | Kraken on Tottenham sleeves in `Goal Man United` and `Fans clap` (both runs); "EA SPORTS" on the sleeve in `Savio cele` (one run). | A sleeve-sponsor activation needs the verified partner list, not AI. |
| Identifiable child in a sales-eligible clip | `Slide 4 - Dad with his boy.mov`: engine allows commercial use (no players, THFC-10). | The demo policy has no minors rule — human decision. |
| No recorded usage restrictions | `usage`, `custom_terms`, access windows empty on all 123 videos; no ScorePlay sponsor tags on Tottenham videos. | Every restriction shown in demos comes from the fictional policy + AI evidence, never from ScorePlay rights metadata. |

## 9. Reproduce

The audit used the product's own code paths; the throwaway scripts were removed afterwards.

| Step | Code path |
|---|---|
| Inventory | `ScorePlayHttpClient` (`whoami`, `getAsset`, `listVideoLogs`) + `searchMediaPages(http, {}, …)`; TwelveLabs SDK `indexes.list` / `indexes.videos.list`; `linkCatalogs()` (`lib/media/link.ts`) |
| Pegasus | `TwelveLabsVideoIntelligence.observations(ref)` — run with `tsx --conditions=react-server` so the durable observation cache is read first (without it, every video is re-analysed) |
| Marengo | `TwelveLabsVideoIntelligence.searchWithDiagnostics(query, { limit: 12 })` |
| Decisions | `decideCampaign()` (`lib/server/decide.ts`); offline sweep with `evaluateEdit()` (`lib/rights/engine.ts`) on the same asset facts and evidence |
| Product walkthrough | `pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/live-walkthrough.ts` |
