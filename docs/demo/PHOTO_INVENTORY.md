# PULSE — ScorePlay Photo Inventory

**Read at:** 2026-10-23T04:24:22Z (UTC). Built from read-only ScorePlay API calls.
**Machine-readable version:** [`photo-inventory.json`](photo-inventory.json): the summary, the 10 candidates and one row per photo (605 rows).

> **Metadata only.** No photo was downloaded, opened or analysed. Every count below comes from ScorePlay fields (tags, event, captions, dates).
> URL, preview, file and credential fields were removed before anything was written (scan of the JSON for `https?:|token|thumbnail`: 0 hits).
> TwelveLabs indexes video only, so **no photo has any AI observation.**

## 1. Sources and method

| Call | Use |
|---|---|
| `POST /media/search` (all 8 pages, 100 per page) | Full workspace list: 728 media (123 video, 605 photo). The search body has no type filter (a `types` field was ignored), so photos were filtered by `type` on our side. |
| `GET /media/{id}` × 605 | Event path, date, caption (`description`), tags (team / season / player / sponsor / credits / orientation / dimensions), `usage`, `custom_terms`, `accessible_from/until` |
| `GET /team-seasons`, `GET /players?team_season_id=` | Squad membership for tagged people (two squads: Tottenham Hotspur FC 2026-27, San Antonio Spurs (SAS) 2026-27) |

Calls ran one at a time with a 150 ms pause. No 429 was returned. Hidden tags were ignored, as `map.ts` does. Duplicates are only flagged; no ids are merged.

## 2. Totals

| | Count |
|---|---|
| Photos | **605** of 728 media |
| Tottenham Hotspur (Man Utd v Tottenham, PL Week 6) | **418** |
| San Antonio Spurs (SAS v SAC, NBA Preseason) | **187** |
| Photos with no team tag | 0 |

### By event / folder (`event.full_path`)

| Folder | Photos |
|---|---|
| Premier League / Manchester United vs Tottenham Hotspur - Week 6 | 404 |
| Premier League / Manchester United vs Tottenham Hotspur - Week 6 / Match | 14 |
| NBA / San Antonio Spurs vs Sacramento Kings - Preseason (event name "Photos") | 187 |

### By season tag

| Tag | Photos | Note |
|---|---|---|
| `2026/27` | 418 | All Tottenham photos |
| `season:2025-26` | 187 | All SAS photos. The SAS squad in ScorePlay is 2026-27, and the captions are dated October 16, 2026, so this season tag looks wrong. It is reported as stored. |

### Dates (`date` field)

| Date | Photos |
|---|---|
| 2026-10-16 | 216 (Tottenham) |
| 2026-10-17 | 202 (Tottenham) |
| 2026-10-22 | 187 (SAS). The captions say October 16, 2026, so this field probably holds the upload date. |

### Orientation and dimensions (from `metadata:` tags)

- Landscape **442**, portrait **163**. Every photo has an orientation tag.
- Every photo has a `metadata:WxH` tag (549 distinct sizes, from 866x1299 up to 8256x5504).

### Photographer credits (`credits:` tags)

Paul Currie 239 and Chloe Knott 173 (both Tottenham). For SAS: Reginald Thomas II 89, Rance Ristau 69, Isaiah Alonzo 18 and Tony Garcia 11. Reginald Thomas II and Rance Ristau each appear under two credit spellings, one with "©"/"®" and one without.

### Captions

592 photos have a caption (`description`). The 13 without one are all Tottenham photos. There are 249 distinct captions: 126 captions are shared by 470 photos (sequence shots).

## 3. People

- Photos with at least one person tag: **468** (137 have none).
- Distinct people tagged: 49. Every one belongs to a ScorePlay squad: 26 Tottenham Hotspur FC 2026-27 and 23 San Antonio Spurs (SAS) 2026-27. That count includes coaches and staff, e.g. Roberto De Zerbi and Mitch Johnson.
- Each person was tagged only on photos of their own club.

| Rank | Person (ScorePlay `full_name`) | Squad | Photos |
|---|---|---|---|
| 1 | Dominic Ayodele Solanke-Mitchell | Tottenham | 53 |
| 1 | Sávio Moreira de Oliveira | Tottenham | 53 |
| 3 | Dylan Harper | SAS | 24 |
| 3 | Victor Wembanyama | SAS | 24 |
| 3 | Sandro Tonali | Tottenham | 24 |
| 3 | Jan Paul van Hecke | Tottenham | 24 |
| 3 | James Daniel Maddison | Tottenham | 24 |
| 8 | Devin Vassell | SAS | 23 |
| 8 | Omar Khaled Mohamed Abdelsalam Marmoush | Tottenham | 23 |
| 10 | Stephon Castle | SAS | 22 |
| 10 | Antonín Kinský | Tottenham | 22 |
| 12 | Conor John Gallagher | Tottenham | 21 |
| 12 | Mohammed Kudus | Tottenham | 21 |
| 14 | De'Aaron Fox | SAS | 20 |
| 15 | Archie James Francis Gray / Micky van de Ven | Tottenham | 19 each |

The full list is in `summary.people_counts` in the JSON. Squad membership is taken as ScorePlay stores it in this hackathon workspace, even where it differs from real-world rosters.

## 4. Sponsors

| Sponsor tag | Photos | Club |
|---|---|---|
| Ledger | 41 | SAS |
| Whataburger | 2 | SAS (caption: "Whataburger Drop in the Bucket" on-court activation) |
| Sprite | 1 | SAS (Sport for Healing Night) |
| **Total photos with any sponsor tag** | **44** | **0 Tottenham photos have a sponsor tag** |

## 5. Rights fields

- `usage` is empty on **605/605** photos.
- `custom_terms` is empty on **605/605** photos.
- `accessible_from` / `accessible_until` are not set on any photo.
- So ScorePlay records **no usage restriction and no usage permission** for any photo. An empty field is not a clearance.

## 6. Duplicates

- **Same filename, different id:** 7 filenames, 14 photos, all Tottenham `CK1_*` files (`CK1_3127/3128/3129/3133/3139/3193/3195.JPG`). In each pair the dimensions differ (e.g. 6000x4000 vs 5930x3954), and in at least one pair only one photo has a caption. These look like original + edited/cropped versions, not byte copies.
- **Same caption + same dimensions + same club:** 15 groups, all SAS (e.g. `130914579`/`130914481` Beach Ball Mania, `130914524`/`130914523`/`130914509` Silver Dancers, `130913791`/`130913790` Wembanyama). These are likely duplicate uploads (`.jpg`/`.JPG` twins). Full id lists are in the JSON under `summary.duplicate_*`.
- Nothing was merged. All counts above are per ScorePlay id.

## 7. Use in PULSE today

- **Photos are not analysed.** The TwelveLabs index holds only the 58 Tottenham videos, and nothing reads the image content of a photo. A photo-based proposal can rest only on ScorePlay metadata: player tags, event/folder, team and season tags, sponsor tags and the caption text.
- **People and brands cannot be confirmed in the image.** A person tag or a caption says who should be in the frame, and nobody has checked it. For any sales or sponsored use (Merchandise, Tickets, Sponsor activation), brands on screen cannot be confirmed. The rights engine would therefore return **NEEDS_REVIEW**, and a human must check the image.
- `usage`/`custom_terms` are empty, so they add no rights evidence either way.
- Photos get tags only on writeback (`API_NOTES.md`: video logs do not apply to photos).

### 10 photo candidates: metadata matches only, not verified

These were chosen from tags and caption text. Nobody has looked at the images.

| # | Objective | ScorePlay id | Filename | People (tags) | Sponsor tag | Key tags / caption basis |
|---|---|---|---|---|---|---|
| 1 | Merchandise | 130851370 | PC1_7364.JPG | Dominic Solanke-Mitchell | — | Tottenham, PL Week 6, Away, Old Trafford, portrait 3762x5643; caption names Solanke alone |
| 2 | Merchandise | 130913704 | 20261016_SAS_RT_SAC_59.jpg | Victor Wembanyama | — | SAS, NBA Preseason, portrait 5504x8256; caption: Wembanyama dunks |
| 3 | Merchandise | 130851069 | CK1_3129.JPG | Solanke-Mitchell, Sávio, Marmoush | — | Tottenham, PL Week 6, Match Day; caption: Solanke celebrates scoring (one of two `CK1_3129.JPG` ids) |
| 4 | Tickets | 130851279 | PC1_3909.JPG | — | — | Tottenham, Away, Old Trafford, Match Day; caption: Tottenham fans celebrate the full-time result |
| 5 | Tickets | 130914563 | 20261016_SAS_TG_SAC_025.jpg | — | — | SAS, NBA Preseason; caption: fans in on-court activation Beach Ball Mania, Frost Bank Center |
| 6 | Engagement | 130851077 | CK1_3195.JPG | Sávio Moreira de Oliveira | — | Tottenham, PL Week 6; caption: Sávio celebrates the goal (one of two `CK1_3195.JPG` ids) |
| 7 | Engagement | 130914249 | 20261016_SAS_RT_SAC_101.jpg | Stephon Castle | — | SAS, NBA Preseason; caption: Castle celebrates a made three pointer |
| 8 | Sponsor activation | 130914526 | 20261016_SAS_TG_SAC_023.jpg | — | Whataburger | SAS, NBA Preseason; caption: Whataburger Drop in the Bucket activation (twin of 130914525) |
| 9 | Sponsor activation | 130913930 | 20261016_SAS_RT_SAC_78.jpg | Victor Wembanyama | Ledger | SAS, NBA Preseason, portrait 5504x6880; caption: Wembanyama dunks |
| 10 | Sponsor activation | 130909506 | 20261016_SAS_IA_SportForHealingNight_18.jpg | — | Sprite | SAS, NBA Preseason; caption: fans pose at Sport for Healing Night |

**Expected engine outcome for each:**
- #1–5 and #8–10 (sales or sponsored uses): **NEEDS_REVIEW**.
- #6–7 (Engagement): also need a human check of the image before use. Without visual evidence, nothing about the content is confirmed.
- There is no Tottenham photo with a sponsor tag. A Tottenham sponsor-activation photo would need a tagged sponsor first.

## 8. Limitations

- Metadata only: no image was seen. People, sponsor and caption fields are the producer's claims.
- The SAS `date` (2026-10-22) and `season:2025-26` tags disagree with the captions (October 16, 2026) and with the squad season (2026-27).
- Duplicate detection uses filename, caption and dimension tags only. No image hashing was possible without downloading the photos.
- Snapshot at the read time above. Later uploads or tag edits are not reflected.
