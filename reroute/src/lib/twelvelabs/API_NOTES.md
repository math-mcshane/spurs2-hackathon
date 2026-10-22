# TwelveLabs API notes (twelvelabs-js 1.3.6, API v1.3)

Docs: https://docs.twelvelabs.io/v1.3/llms.txt · Search: https://docs.twelvelabs.io/v1.3/api-reference/any-to-video-search/make-search-request · Analyze (sync): https://docs.twelvelabs.io/v1.3/api-reference/analyze-videos/analyze · Videos: https://docs.twelvelabs.io/v1.3/api-reference/videos/retrieve · Filtering: https://docs.twelvelabs.io/v1.3/docs/guides/search/filtering

## Marengo search — `client.search.create`
- `POST /v1.3/search` (multipart). Required: `indexId`, `searchOptions` (`visual` | `audio` | `transcription`). Text via `queryText` (≤500 tokens). Image query: `queryMediaType: "image"` + `queryMediaUrl`/`queryMediaFile` (composable with text). No video-segment query in search (only text/image).
- `groupBy: "clip"` (default) → each `SearchItem`: `videoId`, `start`, `end` (seconds), `rank` (1 = best; there is no numeric score in v1.3 — we put `rank` into `SearchHit.score`), `thumbnailUrl`, `transcription`, `userMetadata` (only when `includeUserMetadata: true`).
- `pageLimit` ≤ 50; next pages via `search.retrieve(pageToken)`. `filter` (stringified JSON) can filter on `id` or user metadata.

## The `custom_id` mapping (verified against SDK types)
- There is **no `custom_id` field on videos or indexed assets** in v1.3. `custom_id` exists only on analyze tasks/batches, data connectors and imports.
- Per-video custom data is `user_metadata` (`GET/PUT /indexes/{index}/videos/{video}`; also on indexed assets). We therefore read the ScorePlay id from `user_metadata` keys, first match wins: `custom_id`, `customId`, `scoreplay_id`, `scoreplayMediaId`, `scoreplay_media_id` (`parse.ts#CUSTOM_ID_KEYS`).
- Search: request `includeUserMetadata: true`; if a clip comes back without it, we `videos.retrieve` the video (cached in memory + on disk). Hits with no mapping are dropped and logged, never given an id.
- Reverse lookup (ScorePlay id → TL video): `indexes.videos.list(indexId, { userMetadata: { custom_id: id } })` (list supports user-metadata query filters), tried for each key.
- If organizers stored the id elsewhere (e.g. `filename`, an import `custom_id`, or an indexed-asset field), only `CUSTOM_ID_KEYS`/`findVideoByCustomId` need to change. Run the smoke script: it prints each video's `user_metadata`.

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
Every live response → `.cache/twelvelabs/<sha256>.json` (request + value). `TWELVELABS_REPLAY=true` or a network error (no HTTP response) → recorded value with `origin: "CACHED"`; cache miss → `UPSTREAM` error. HTTP errors are never masked by cache.

## Open questions for TwelveLabs staff / organizers
1. Exactly where is the ScorePlay id stored on the pre-built index — `user_metadata.custom_id`? another key? filename?
2. Do the index's videos have an `asset_id` (needed for `/analyze` in SDK 1.3.6), or is legacy `video_id` analyze still accepted?
3. Is Pegasus enabled on the shared index / key (index `models`), and which version (1.5 vs 1.6)?
4. Which `search_options` the index supports (we use `visual`; `audio`/`transcription` only if enabled).
5. Rate limits/quotas on the hackathon key for analyze calls.
