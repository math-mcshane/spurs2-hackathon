import { describe, expect, it } from "vitest";
import { customIdFromMetadata, mapSearchClips, parsePegasusObservations, PegasusParseError } from "./parse";

describe("customIdFromMetadata", () => {
  it("reads custom_id from user_metadata and ignores empty values", () => {
    expect(customIdFromMetadata({ custom_id: " sp-1 " })).toBe("sp-1");
    expect(customIdFromMetadata({ custom_id: "" })).toBeUndefined();
    expect(customIdFromMetadata(undefined)).toBeUndefined();
  });
});

describe("mapSearchClips", () => {
  const clips = [
    { videoId: "v1", start: 1, end: 4, rank: 1, userMetadata: { custom_id: "sp-1" } },
    { videoId: "v2", start: 2, end: 5, rank: 2 },
    { videoId: "v3", start: 0, end: 3, rank: 3, thumbnailUrl: "t.jpg" },
    { videoId: "v4", start: 0, end: 3, rank: 4 },
  ];
  const resolve = (v: string) => ({ v1: "sp-1", v3: "sp-3", v4: "sp-4" })[v];

  it("drops unmapped hits, never fabricating ids, and re-ranks", () => {
    const { hits, unmapped } = mapSearchClips(clips, resolve, { origin: "LIVE" });
    expect(unmapped).toEqual(["v2"]);
    expect(hits.map((h) => [h.scoreplayMediaId, h.rank])).toEqual([
      ["sp-1", 1],
      ["sp-3", 2],
      ["sp-4", 3],
    ]);
    expect(hits.every((h) => h.origin === "LIVE")).toBe(true);
  });

  it("honours excludeMediaIds and limit", () => {
    const { hits } = mapSearchClips(clips, resolve, { origin: "CACHED", excludeMediaIds: ["sp-1"], limit: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ scoreplayMediaId: "sp-3", thumbnailUrl: "t.jpg", origin: "CACHED" });
  });
});

describe("parsePegasusObservations", () => {
  const good = JSON.stringify({
    observations: [
      { category: "sponsor_brand", entity: "Acme Énergie", start_time: 4, end_time: 9, description: "LED board", confidence: 0.9 },
      { category: "person", entity: "Player 1", start_time: 0, end_time: 3, description: "jersey #1", confidence: 0.7 },
      { category: "broadcaster", entity: "TNT", start_time: 0, end_time: 15, description: "bug", confidence: 0.8 },
      { category: "sponsor_brand", entity: "Bad", start_time: 9, end_time: 4, description: "reversed", confidence: 0.5 },
      { category: "sponsor_brand", entity: "Bad2", start_time: 1, end_time: 2, description: "x", confidence: 3 },
      { category: "weather", entity: "Sun", start_time: 1, end_time: 2, description: "x", confidence: 0.5 },
    ],
    rubric: { broadcast_source: "national", scorebug_watermark: "bogus" },
    summary: "A dunk.",
  });

  it("maps observations to labelled, timecoded TWELVELABS evidence", () => {
    const { evidence, dropped } = parsePegasusObservations(good, "sp-1", "LIVE");
    expect(dropped).toBe(3);
    expect(evidence[0]).toEqual({
      scoreplayMediaId: "sp-1",
      start: 4,
      end: 9,
      observation: "Acme Énergie: LED board",
      source: "TWELVELABS",
      label: "brand:acme-energie",
      confidence: 0.9,
      origin: "LIVE",
    });
    expect(evidence.map((e) => e.label)).toEqual([
      "brand:acme-energie",
      "person:player-1",
      "broadcaster:tnt",
      "rubric:broadcast_source:national",
      "summary",
    ]);
  });

  it("accepts fenced JSON and propagates CACHED origin", () => {
    const { evidence } = parsePegasusObservations("```json\n" + good + "\n```", "sp-1", "CACHED");
    expect(evidence.every((e) => e.origin === "CACHED")).toBe(true);
  });

  it("throws on malformed or truncated output", () => {
    expect(() => parsePegasusObservations('{"observations": [', "sp-1", "LIVE")).toThrow(PegasusParseError);
    expect(() => parsePegasusObservations('{"foo": 1}', "sp-1", "LIVE")).toThrow(PegasusParseError);
    expect(() => parsePegasusObservations("I cannot see the video", "sp-1", "LIVE")).toThrow(PegasusParseError);
  });
});
