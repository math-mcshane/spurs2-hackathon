/**
 * Zod schemas for the ScorePlay responses REROUTE reads, shaped after the published OpenAPI spec
 * (https://developer.scoreplay.io/downloads/scoreplay.yaml). Only fields we use are typed; every object
 * is loose so unknown/new fields pass through. Many documented fields are "omitted when empty" or
 * nullable, hence `.nullish()` throughout.
 */
import { z } from "zod";

const id = z.number().int();

export const TagOptionSchema = z.looseObject({
  ID: id,
  name: z.string().nullish(),
  label: z.string().nullish(),
  type: z.string().nullish(),
  is_metadata: z.boolean().nullish(),
});
export type ScorePlayTagOption = z.infer<typeof TagOptionSchema>;

const PlayerSchema = z.looseObject({
  ID: id,
  full_name: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  external_id: z.string().nullish(),
});

const SponsorSchema = z.looseObject({
  ID: id,
  name: z.string().nullish(),
  label: z.string().nullish(),
});

export const MediaTagSchema = z.looseObject({
  ID: id.nullish(),
  tag_option_id: id.nullish(),
  player_id: id.nullish(),
  sponsor_id: id.nullish(),
  hidden: z.boolean().nullish(),
  timestamp: z.number().nullish(),
  name: z.string().nullish(),
  tag_option: TagOptionSchema.nullish(),
  player: PlayerSchema.nullish(),
  sponsor: SponsorSchema.nullish(),
});
export type ScorePlayMediaTag = z.infer<typeof MediaTagSchema>;

const FileSchema = z.looseObject({
  ID: id.nullish(),
  url: z.string().nullish(),
  details: z.string().nullish(),
  is_thumbnail: z.boolean().nullish(),
  is_compressed: z.boolean().nullish(),
});

const EventSchema = z.looseObject({
  ID: id.nullish(),
  name: z.string().nullish(),
  date: z.number().nullish(),
  full_path: z.string().nullish(),
  league_api_id: z.string().nullish(),
  external_id: z.string().nullish(),
});

export const MediaSchema = z.looseObject({
  ID: id,
  company_id: id.nullish(),
  name: z.string().nullish(),
  type: z.string().nullish(),
  description: z.string().nullish(),
  date: z.number().nullish(),
  captured_time: z.string().nullish(),
  event_id: id.nullish(),
  status: z.string().nullish(),
  validated: z.boolean().nullish(),
  usage: z.string().nullish(),
  custom_terms: z.string().nullish(),
  accessible_from: z.number().nullish(),
  accessible_until: z.number().nullish(),
  duration: z.number().nullish(),
  media_duration: z.number().nullish(),
  thumbnail_url: z.string().nullish(),
  streaming_url: z.string().nullish(),
  proxy_large: z.string().nullish(),
  proxy_medium: z.string().nullish(),
  proxy_small: z.string().nullish(),
  files: z.array(FileSchema).nullish(),
  tags: z.array(MediaTagSchema).nullish(),
  raw_tags: z.array(z.string()).nullish(),
  tag_option_ids: z.array(id).nullish(),
  player_ids: z.array(id).nullish(),
  sponsor_ids: z.array(id).nullish(),
  event: EventSchema.nullish(),
});
export type ScorePlayMedia = z.infer<typeof MediaSchema>;

export const MediaSearchResultSchema = z.looseObject({
  media: z.array(MediaSchema).nullish(),
  count: z.number().nullish(),
  page: z.number().nullish(),
  per_page: z.number().nullish(),
  total_pages: z.number().nullish(),
  next_cursor: z.string().nullish(),
});

export const WhoamiSchema = z.looseObject({
  user_id: z.number().nullish(),
  user_type: z.string().nullish(),
  company: z.looseObject({ name: z.string().nullish(), subdomain: z.string().nullish() }).nullish(),
  rights: z.array(z.string()).nullish(),
  scope: z.looseObject({}).nullish(),
});
export type ScorePlayWhoami = z.infer<typeof WhoamiSchema>;

export const TagSearchResultSchema = z.looseObject({
  tags: z.array(TagOptionSchema).nullish(),
  players: z.array(PlayerSchema).nullish(),
  sponsors: z.array(SponsorSchema).nullish(),
});

export const TagOptionListSchema = z.array(TagOptionSchema);

export const TagFilterSchema = z.looseObject({
  id,
  name: z.string(),
  tag_options: z.array(id).nullish(),
});
export type ScorePlayTagFilter = z.infer<typeof TagFilterSchema>;

export const TagFilterListSchema = z.looseObject({
  items: z.array(TagFilterSchema).nullish(),
  total: z.number().nullish(),
  page: z.number().nullish(),
  limit: z.number().nullish(),
});

/** `GET /media/{id}/logs`: `timestamp` is SECONDS, `start_timestamp`/`end_timestamp` are MILLISECONDS. */
export const VideoLogSchema = z.looseObject({
  id,
  media_id: id.nullish(),
  timestamp: z.number().nullish(),
  start_timestamp: z.number().nullish(),
  end_timestamp: z.number().nullish(),
  comment: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
});
export type ScorePlayVideoLog = z.infer<typeof VideoLogSchema>;

export const VideoLogListSchema = z.looseObject({
  items: z.array(VideoLogSchema).nullish(),
  total: z.number().nullish(),
  page: z.number().nullish(),
  limit: z.number().nullish(),
});

export const DeleteVideoLogsResultSchema = z.looseObject({ deleted_ids: z.array(id).nullish() });

export const UploadInitSchema = z.looseObject({
  upload_id: z.string(),
  key: z.string(),
  urls: z.array(z.looseObject({ url: z.string(), parts_number: z.number().int() })),
  media_id: id,
});
