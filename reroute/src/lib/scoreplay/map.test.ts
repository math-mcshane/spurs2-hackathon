import { describe, expect, it } from "vitest";
import { mapMediaToAsset } from "./map";
import { MediaSchema, type ScorePlayTagFilter } from "./schemas";

/** Verbatim `components.schemas.Media.example` from https://developer.scoreplay.io/downloads/scoreplay.yaml */
const DOC_MEDIA_EXAMPLE = {
  ID: 46000204,
  CreatedAt: "2025-05-31T22:02:23.011204Z",
  UpdatedAt: "2025-05-31T22:04:31.546671Z",
  DeletedAt: null,
  name: "2218005865.jpg",
  type: "photo",
  date: 1748728887,
  user_id: 0,
  company_id: 123,
  session_id: 1400636,
  event_id: 321801,
  description: "Players celebrate after the UEFA Champions League Final 2025",
  captured_time: "2025:05:31 22:52:39.07+02:00",
  usage: "editorial",
  status: "DONE",
  validated: true,
  player_accessible: true,
  team_accessible: true,
  is_private: false,
  duration: 0,
  file_size: 4829411,
  accessible_from: 0,
  accessible_until: 0,
  tag_option_ids: [1910925],
  version_count: 1,
  comment_count: 0,
  files: [
    {
      ID: 91822711,
      url: "https://scoreplay-mam-media.s3.amazonaws.com/123/456/media_46000204.jpg",
      details: "photographer_quality",
      is_thumbnail: false,
      is_compressed: false,
      resolution_width: 5464,
      resolution_height: 3640,
      media_id: 46000204,
    },
    {
      ID: 91822712,
      url: "https://cdn.scoreplay.io/scoreplay-mam-media-transformed/123/456/media_46000204_thumbnail.jpg",
      details: "thumbnail_quality",
      is_thumbnail: true,
      is_compressed: false,
      media_id: 46000204,
    },
  ],
  tags: [
    {
      ID: 1213540080,
      media_id: 46000204,
      tag_option_id: 1910925,
      player_id: 0,
      sponsor_id: 0,
      hidden: false,
      timestamp: 0,
      name: "",
      tag_option: { ID: 1910925, name: "parc des princes", label: "Parc des Princes", type: "metadata", is_metadata: true },
    },
  ],
  event: {
    ID: 321801,
    name: "Paris vs Inter (MD17 - UEFA Champions League)",
    date: 1748710800,
    full_path: "/198841:UEFA Champions League 2025/321799:Final/321800:MD17",
    media_count: 6134,
  },
  original_url: "https://scoreplay-mam-media.s3.amazonaws.com/123/456/media_46000204.jpg",
  thumbnail_url: "https://cdn.scoreplay.io/scoreplay-mam-media-transformed/123/456/media_46000204_thumbnail.jpg",
};

const parse = (raw: unknown) => MediaSchema.parse(raw);

const optionTag = (id: number, label: string, type = "metadata") => ({
  tag_option_id: id,
  player_id: 0,
  sponsor_id: 0,
  hidden: false,
  tag_option: { ID: id, name: label.toLowerCase(), label, type },
});
const playerTag = (id: number, fullName: string) => ({ tag_option_id: 0, player_id: id, sponsor_id: 0, player: { ID: id, full_name: fullName } });
const sponsorTag = (id: number, label: string, hidden = false) => ({
  tag_option_id: 0,
  player_id: 0,
  sponsor_id: id,
  hidden,
  sponsor: { ID: id, name: label.toLowerCase(), label },
});

const FILTERS: ScorePlayTagFilter[] = [
  { id: 1, name: "Competition", tag_options: [900] },
  { id: 2, name: "Team", tag_options: [700, 701] },
];

/** A video shaped like the documented Media object, with player/sponsor/team/competition tags. */
function video(overrides: Record<string, unknown> = {}) {
  return parse({
    ...DOC_MEDIA_EXAMPLE,
    ID: 51000001,
    name: "spurs-g4.mp4",
    type: "video",
    duration: 15,
    proxy_medium: "https://cdn.example/proxy_medium.mp4",
    streaming_url: "https://cdn.example/stream.m3u8",
    tags: [optionTag(900, "NBA"), optionTag(700, "San Antonio Spurs"), playerTag(11, "victor wembanyama"), sponsorTag(21, "Acme Energy")],
    tag_option_ids: [900, 700],
    player_ids: [11],
    sponsor_ids: [21],
    ...overrides,
  });
}

describe("mapMediaToAsset", () => {
  it("maps the documented example without inventing rights facts", () => {
    const asset = mapMediaToAsset(parse(DOC_MEDIA_EXAMPLE), []);
    expect(asset).toMatchObject({
      id: "46000204",
      title: "2218005865.jpg",
      kind: "image",
      origin: "LIVE",
      tags: ["Parc des Princes"],
      thumbnailUrl: DOC_MEDIA_EXAMPLE.thumbnail_url,
    });
    expect(asset.facts).toEqual({ recordedAt: "2025-05-31T22:01:27.000Z" });
    expect(asset.facts.competition).toBeUndefined(); // event path/name is NOT parsed into a competition
    expect(asset.durationSec).toBeUndefined(); // duration 0 = unknown
    expect(asset.previewUrl).not.toBe(DOC_MEDIA_EXAMPLE.original_url); // never the original download
    expect(asset.metadata).toMatchObject({ usage: "editorial", event: { id: 321801 } });
    expect(asset.metadata).not.toHaveProperty("accessibleUntil"); // 0 = unset, not "expired 1970"
  });

  it("reads facts from tags resolved through tag filters", () => {
    const asset = mapMediaToAsset(video(), FILTERS);
    expect(asset.facts).toEqual({
      competition: "NBA",
      team: "San Antonio Spurs",
      people: ["victor wembanyama"],
      sponsors: ["Acme Energy"],
      recordedAt: "2025-05-31T22:01:27.000Z",
    });
    expect(asset.kind).toBe("video");
    expect(asset.durationSec).toBe(15);
    expect(asset.previewUrl).toBe("https://cdn.example/proxy_medium.mp4");
  });

  it("leaves competition/team unknown when no tag filter vouches for them", () => {
    const asset = mapMediaToAsset(video(), []);
    expect(asset.facts.competition).toBeUndefined();
    expect(asset.facts.team).toBeUndefined();
  });

  it("treats a team tag option of type `team` as a team fact even without filters", () => {
    const asset = mapMediaToAsset(video({ tags: [optionTag(702, "Spurs", "team")], tag_option_ids: [702] }), []);
    expect(asset.facts.team).toBe("Spurs");
  });

  it("leaves team unknown when the media carries two teams", () => {
    const asset = mapMediaToAsset(video({ tags: [optionTag(700, "San Antonio Spurs"), optionTag(701, "Los Angeles Lakers")] }), FILTERS);
    expect(asset.facts.team).toBeUndefined();
    expect(asset.metadata.teams).toEqual(["San Antonio Spurs", "Los Angeles Lakers"]);
  });

  it("never turns missing people/sponsor tags into an empty (= cleared) list", () => {
    for (const tags of [null, [], [optionTag(900, "NBA")]]) {
      const asset = mapMediaToAsset(video({ tags, player_ids: undefined, sponsor_ids: undefined }), FILTERS);
      expect(asset.facts.people).toBeUndefined();
      expect(asset.facts.sponsors).toBeUndefined();
    }
  });

  it("leaves people unknown when player_ids lists players the tags do not resolve", () => {
    const asset = mapMediaToAsset(video({ player_ids: [11, 12] }), FILTERS);
    expect(asset.facts.people).toBeUndefined();
  });

  it("ignores hidden tags", () => {
    const asset = mapMediaToAsset(video({ tags: [sponsorTag(21, "Acme Energy", true)], sponsor_ids: undefined }), FILTERS);
    expect(asset.facts.sponsors).toBeUndefined();
    expect(asset.tags).not.toContain("Acme Energy");
  });

  it("falls back to media_duration (nanoseconds) when duration is absent", () => {
    const asset = mapMediaToAsset(video({ duration: undefined, media_duration: 15_500_000_000 }), FILTERS);
    expect(asset.durationSec).toBe(15.5);
  });
});
