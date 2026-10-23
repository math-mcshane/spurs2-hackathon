# TwelveLabs API notes (twelvelabs-js 1.3.6, API v1.3)

Docs: https://docs.twelvelabs.io/v1.3/llms.txt · Search: https://docs.twelvelabs.io/v1.3/api-reference/any-to-video-search/make-search-request · Analyze (sync): https://docs.twelvelabs.io/v1.3/api-reference/analyze-videos/analyze · Videos: https://docs.twelvelabs.io/v1.3/api-reference/videos/retrieve · Filtering: https://docs.twelvelabs.io/v1.3/docs/guides/search/filtering

## Marengo search — `client.search.create`
- `POST /v1.3/search` (multipart). Required: `indexId`, `searchOptions` (`visual` | `audio` | `transcription`). Text via `queryText` (≤500 tokens). Image query: `queryMediaType: "image"` + `queryMediaUrl`/`queryMediaFile` (composable with text). No video-segment query in search (only text/image).
- `groupBy: "clip"` (default) → each `SearchItem`: `videoId`, `start`, `end` (seconds), `rank` (1 = best; there is no numeric score in v1.3 — we put `rank` into `SearchHit.score`), `thumbnailUrl`, `transcription`, `userMetadata` (only when `includeUserMetadata: true`).
- `pageLimit` ≤ 50; next pages via `search.retrieve(pageToken)`. `filter` (stringified JSON) can filter on `id` or user metadata.

## ScorePlay ↔ TwelveLabs identity (lib/media `MediaResolver`)
- There is **no `custom_id` field on videos or indexed assets** in v1.3. The premiere-league index stores `user_metadata.scoreplay_id`, but those ids belong to a **cloned** ScorePlay workspace (0/58 resolve here, constant −529 offset). They are read only as a hint (`parse.ts#claimedScoreplayId`) and trusted (`AUTHORITATIVE_ID`) only if the id exists in this workspace with the same filename.
- Canonical link: normalized filename (NFC, trimmed, case-insensitive, extension kept) + |Δduration| ≤ 0.5 s, unique in both directions (`FILENAME_DURATION`); otherwise `AMBIGUOUS` (candidates exposed) or `UNMAPPED`. Live: 58/58 Tottenham videos link 1:1 (max Δ 0.037 s).
- ScorePlay `POST /media/search` truncates `media_duration` to whole seconds; filename-matching assets are re-read with `GET /media/{id}` for the exact value.
- Search hits are mapped through the resolver (`SearchHit.mapping`); unlinkable hits are dropped and reported (`searchWithDiagnostics().dropped`). `observations(ref)` analyzes `ref.twelvelabsVideoId` directly and refuses unlinkable refs with `NOT_FOUND "MEDIA_IDENTITY: …"`.
- Config: `lib/twelvelabs/config.ts` — `TWELVELABS_API_KEY` (legacy `TWELVE_LABS_API_KEY` only if unset); index `PULSE_TWELVELABS_INDEX_ID_<CLUB>` else `TWELVELABS_INDEX_ID`.

## Pegasus — `client.analyze` (sync, `stream: false`)
- `POST /v1.3/analyze`: `modelName` `pegasus1.6` | `pegasus1.5`, `video: { type: "asset_id", assetId }` (or `url` / `base64_string`), `prompt`, `temperature`, `maxTokens` (default 4096), `responseFormat: { type: "json_schema", jsonSchema }`.
- Response `data` (string, JSON when schema given), `finishReason` (`stop` | `length` → truncated, we refuse partial output), `usage`.
- Schema limits: no `additionalProperties`, `minLength`, `maxItems`, `uniqueItems`; `timestamp` type with `format: "seconds"` allowed at top level or one level inside array items; `start_time`/`end_time` are reserved names (we declare them as `timestamp/seconds`).
- The SDK's analyze has **no `video_id`** — the video must be referenced by `asset_id` (from `videos.retrieve(...).assetId`). For videos without an asset id we call the legacy REST body `{ video_id }` directly. Async alternative: `analyzeAsync.tasks.create` (supports `custom_id`, segmentation).

## Prompt / labels
Adapted from `twelvelabs_sampleprompts` (NBA + PL rulebooks): `broadcast_source`, `networks_seen`, `scorebug_watermark`, `sponsors_seen`, `uniform_logo`, `player_focus`, `players_named`, `gambling_brand`, `summary`, all with "only what you can see/hear" + timecode requirements. Output → `Evidence` (`source: "TWELVELABS"`, `origin`):
- `sponsor_brand` → `brand:<slug>`, `person` → `person:<slug>`, `broadcaster` → `broadcaster:<slug>`, `onscreen_graphic` → `graphic:<slug>` (timecoded, `confidence` = observation confidence).
- Rubric answers → video-level `rubric:<question>:<option>`; summary → `summary`.
- Observations are facts only; they never grant permission.

## Record / replay
Shared demo record/replay in `lib/media/replay.ts` (also used for ScorePlay reads): `scripts/record-demo-cache.ts` records real responses (redacted: URLs with a query string/fragment and token-like values removed) into the committed `demo-cache/`. `DEMO_REPLAY=true` → every read from the recording (origin `CACHED`, run-level provenance via `lib/media/provenance.ts`), a miss is an `UPSTREAM` error; otherwise live, and a network error / HTTP 429 / 5xx serves the recording of the same request when one exists. Other HTTP errors are never masked. Pegasus output is also stored durably via Persistence's `observationCache` (falls back to memory when unavailable) and served as `CACHED`. Videos longer than 60 min are refused before analyze (`TECHNICAL_LIMITATION`, cached for the process lifetime).

## Open questions for TwelveLabs staff / organizers
1. Do the index's videos have an `asset_id` (needed for `/analyze` in SDK 1.3.6), or is legacy `video_id` analyze still accepted? (Live 2026-10-22: Pegasus analyze succeeded for video `6ad911f2960d8ea7bdd04cfe`.)
2. Is Pegasus enabled on the shared index / key (index `models`), and which version (1.5 vs 1.6)?
3. Which `search_options` the index supports (we use `visual`; `audio`/`transcription` only if enabled).
4. Rate limits/quotas on the hackathon key for analyze calls.
