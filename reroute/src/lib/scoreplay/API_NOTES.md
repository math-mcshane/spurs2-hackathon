# ScorePlay API — what REROUTE uses

Source of truth: the published OpenAPI spec <https://developer.scoreplay.io/downloads/scoreplay.yaml> (v1.0.0; also as Postman: <https://developer.scoreplay.io/downloads/scoreplay.postman_collection.json>). Human docs: <https://developer.scoreplay.io/> → API Reference <https://developer.scoreplay.io/api-reference/>. Operation links below use the reference's `#tag/operation/<operationId>` anchors (the format the spec uses for its own cross-links). Fetched 2026-10-22.

- **Base URL:** `https://media.scoreplay.io/v1` (OpenAPI `servers`). Overridable with `SCOREPLAY_API_BASE_URL`.
- **Auth:** header `X-ScorePlay-Api-Key: <key>`, scoped to the organization (`securitySchemes.ApiKeyAuth`). Writes need the `can_do_media_edit` right (documented 401 on tag/details/log/file writes).
- **IDs:** media, tag option, player, sponsor and event IDs are integers. REROUTE passes them around as strings and rejects non-numeric IDs with `BAD_REQUEST`.
- **Errors:** `{ "message": "..." }` (`components.schemas.Error`). Our client turns 404 into `NOT_FOUND`, everything else and timeouts (15 s) into `UPSTREAM`. A missing key gives `NOT_CONFIGURED`.

## Endpoints called

| Purpose | Method + route | Doc | Notes |
|---|---|---|---|
| Key check | `GET /whoami` | [getWhoami](https://developer.scoreplay.io/api-reference/#tag/operation/getWhoami) | `user_id`, `user_type`, `company{name,subdomain}`, `rights[]`, `scope{...}`. Smoke script only. |
| Resolve labels → IDs | `GET /tag/search?query=` | [searchPublicTags](https://developer.scoreplay.io/api-reference/#tag/operation/searchPublicTags) | Returns `tags[]`, `players[]`, `sponsors[]`. `query` max 60 chars (400 otherwise). This is step 1 of the documented "discover IDs, then query" pattern. |
| Asset search | `POST /media/search?page=&per_page=` | [searchPublicMedia](https://developer.scoreplay.io/api-reference/#tag/operation/searchPublicMedia) | Body `query` is **ignored** by the index. We send `name` + `description` (fuzzy, whole words) + `any_tag_options` / `any_players` / `any_sponsors` from tag search, with `smart_filter: true` (OR + scoring) and `order_by: "relevance"`. Response `{ media[], count, page, per_page, total_pages, next_cursor }`. |
| Asset detail | `GET /media/{id}` | [getMediaByIdPublic](https://developer.scoreplay.io/api-reference/#tag/operation/getMediaByIdPublic) | Media object: `type` (photo/video), `duration` (s), `media_duration` (ns), `thumbnail_url`, `proxy_small/medium/large`, `streaming_url`, `files[]` (`photographer_quality` / thumbnail / compressed), `tags[]` (with `tag_option`, `player`, `sponsor`, `hidden`), `tag_option_ids`, `player_ids`, `sponsor_ids`, `event{name,full_path,league_api_id}`, `usage`, `custom_terms`, `accessible_from/until`, `company_id`. |
| Tag meaning (facts) | `GET /tag/filters?page=&limit=` | [listTagFiltersPublic](https://developer.scoreplay.io/api-reference/#tag/operation/listTagFiltersPublic) | Tag groups (`{id, name, tag_options[]}`). The docs' own way to tell what a tag option means (e.g. Team vs Score). Used to read competition/team facts. Cached for 5 min. |
| Find tag option | `GET /tag/options?query=` | [listTagOptionsPublic](https://developer.scoreplay.io/api-reference/#tag/operation/listTagOptionsPublic) | Resolves REROUTE tag names to IDs. |
| Create tag option | `POST /tag/options` | [createTagOptionPublic](https://developer.scoreplay.io/api-reference/#tag/operation/createTagOptionPublic) | `{name, label, type}`. Only for REROUTE taxonomy tags that don't exist yet. |
| Add tags | `POST /media/{id}/tags` | [publicAddTagsToMedia](https://developer.scoreplay.io/api-reference/#tag/operation/publicAddTagsToMedia) | `{tag_option_ids[]}` → 204. We only send IDs that are not already on the media. |
| Remove tags | `DELETE /media/{id}/tags` | [publicDeleteTagsFromMedia](https://developer.scoreplay.io/api-reference/#tag/operation/publicDeleteTagsFromMedia) | `{tag_option_ids[]}` → 204. Only stale REROUTE-managed tags, e.g. the previous verdict. |
| Timecoded actions | `POST /video/logs` | [addVideoLogs](https://developer.scoreplay.io/api-reference/#tag/operation/addVideoLogs) | `{company_id, video_logs:[{media_id, log:{start_offset,end_offset \| offset, comment, raw_tags[]}}]}`. Offsets are seconds from the video start. `raw_tags` are created if missing. Returns a boolean. |
| Read actions | `GET /media/{id}/logs?page=&limit=` | [listVideoLogsPublic](https://developer.scoreplay.io/api-reference/#tag/operation/listVideoLogsPublic) | `items[{id, timestamp (s), start_timestamp (ms), end_timestamp (ms), comment, tags[]}]`. Max 200 per page. Used for idempotency and read-back. |
| Delete actions | `DELETE /media/{id}/logs` | [deleteVideoLogsPublic](https://developer.scoreplay.io/api-reference/#tag/operation/deleteVideoLogsPublic) | `{log_ids[]}` → `{deleted_ids[]}`. Only this receipt's logs, and only when they differ from the new plan. |
| Upload: init | `POST /upload/event/{eventId}?parts=N` | [createPublicMediaIntoEvent](https://developer.scoreplay.io/api-reference/#tag/operation/createPublicMediaIntoEvent) | `{name, description, raw_tags[]}` → `{upload_id, key, urls[{url, parts_number}], media_id}`. Gated by `SCOREPLAY_UPLOAD_APPROVED=true`. |
| Upload: parts | `PUT <pre-signed url>` | same | We collect each part's `ETag` response header. |
| Upload: complete | `POST /upload/complete/{mediaId}` | [completeS3MultipartUploadUnauth](https://developer.scoreplay.io/api-reference/#tag/operation/completeS3MultipartUploadUnauth) | `{key, upload_id, parts_number, parts[{parts_number, etag}]}` → Media. |
| Upload: abort | `POST /upload/abort` | [abortS3MultipartUpload](https://developer.scoreplay.io/api-reference/#tag/operation/abortS3MultipartUpload) | `{key, upload_id}`. Called if a part or the complete call fails. |

Documented but deliberately **not** used:
- `PUT /media/{id}/details` ([updatePublicMediaDetails](https://developer.scoreplay.io/api-reference/#tag/operation/updatePublicMediaDetails)) only allows `name`, `description`, `date`, `captured_time`, `event_id`, `label_id`, accessibility flags/windows and `timecode`. It has no custom-details field. Writing reasoning into `description` would overwrite the producer's text, and changing `accessible_*` would change ScorePlay ACLs. Spec §7 forbids that without a verified capability.
- `POST /media/{id}/generate/dynamic_url` and `/media/{id}/formats/*`: not needed. The preview uses `proxy_*` / `streaming_url` / compressed files from the media object, never `original_url`.

## Mapping → `Asset` (`map.ts`)

- `facts.people` is the player tags' `full_name`. `facts.sponsors` is the sponsor tags' `label`. Either one is set only if non-empty **and** covers every ID in `player_ids` / `sponsor_ids`. Otherwise it stays `undefined`.
- `facts.team` comes from tag options of `type: "team"` (documented on the Team schema) or from a tag in a tag filter named Team/Teams. `facts.competition` comes from a tag in a tag filter named Competition/League. Either is set only when exactly one value exists; otherwise it stays `undefined` and all values are listed in `metadata.teams` / `metadata.competitions`.
- `facts.recordedAt` is `date` (Unix seconds) converted to ISO.
- Hidden tags are ignored. Event name/path, `usage`, `custom_terms` and `accessible_*` go to `metadata` only. They are never read as permissions.
- `origin` is always `"LIVE"`.

## Writeback (`taxonomy.ts`, `writeback.ts`, `client.ts#writeDecision`)

- **Taxonomy status: PENDING CONFIRMATION WITH SCOREPLAY STAFF.**
- **Targets:** `receipt.derivativeAssetId` if set; otherwise every `receipt.sourceAssetIds`.
- **Tags:** exactly one `reroute:verdict:*`, exactly one `reroute:review:*`, plus `reroute:policy:fictional-demo` when the policy is fictional.
- **Video logs (videos only):**
  - One summary log at 0 s (verdict, edit, policy id@version, FICTIONAL DEMO POLICY banner, intent, review state, missing facts, non-PERMIT reasons).
  - One offset-range log per DENY/MISSING reason range on that media. For a derivative, ranges are translated onto the output timeline using `edit.segments`.
  - Every comment starts with `REROUTE receipt <id> |`.
- **Idempotent:**
  - Tags are diffed against the media before writing.
  - This receipt's logs are only replaced (delete then add) when they differ from the plan.
  - Re-running the same receipt therefore causes no duplicates.
- **Read-back:** `GET /media/{id}` and `GET /media/{id}/logs` again. The result is `Record<mediaId, {status: VERIFIED|WRITTEN|FAILED, at, detail?, verdictTag, tags[], actions[]}>`.
  - `WRITTEN`: the writes returned 2xx but the re-read did not show everything.
  - `FAILED`: an upstream error for that media.

## Open questions for ScorePlay staff

1. **Taxonomy sign-off:** are the tag names in `taxonomy.ts` OK? Are colons in tag option names allowed? Should they use a specific `type`, or live in a "REROUTE" tag filter group? Is a single intent-agnostic verdict tag acceptable when logs carry the intent?
2. **Custom details:** the brief mentions "details", but the public `PUT /media/{id}/details` has no custom-field slot. Is there another documented way to attach structured reasoning (e.g. custom metadata fields)? Until then, reasoning lives in video-log comments.
3. **Video-log comment limits:** what is the max `comment` length? We cap at 1000 chars. Is `POST /video/logs` processed synchronously, so that `GET /media/{id}/logs` reflects it immediately?
4. **Photos:** where should reasoning go for photo assets? Video logs don't apply, so we only write tags.
5. **Competition/team facts:** what are the real tag-filter (tag group) names for competition and team in the hackathon org? Is `event.league_api_id` / `event.full_path` an authoritative competition source?
6. **Key rights:** does the hackathon key have `can_do_media_edit`, and permission to create tag options?
7. **Upload:** which event should a derivative go into? We currently use the first source asset's event. What part size and limits apply (we assume S3's 5 MiB minimum per non-final part and use 16 MiB parts)? Is upload allowed for hackathon keys at all (`SCOREPLAY_UPLOAD_APPROVED`)?
8. **Preview URLs:** are `proxy_*` / `streaming_url` OK to embed in our app for the demo (event content terms, spec §9)? Do they expire?
9. **Search:** `GET /tag/search` has no `limit`. Is there a cap on returned tags/players? Is `POST /media/search` with `smart_filter` the recommended free-text search?
