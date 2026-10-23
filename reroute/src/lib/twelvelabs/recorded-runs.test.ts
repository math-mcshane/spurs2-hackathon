import { describe, expect, it } from "vitest";
import type { MediaRef } from "@/lib/contracts";
import { parsePegasusObservations } from "./parse";
import { analysisRunLabel, RECORDED_RUN, recordedObservations } from "./recorded-runs";
import recorded from "./recorded/pegasus-audit-2026-10-23.json";

/** `Fans clap Man United A 9x16.mp4` as lib/media links it (premiere-league index). */
const fansClap: MediaRef = {
  scoreplayMediaId: "130851320",
  twelvelabsIndexId: "6ad911d5500e82756f2eb468",
  twelvelabsVideoId: "6ad911e365b4aff96dc7bacd",
  method: "FILENAME_DURATION",
  candidates: [],
  checkedAt: "2026-10-23T03:03:57.000Z",
};

describe("recordedObservations", () => {
  it("serves the audit run for the exact linked video, tagged with its provenance", () => {
    const evidence = recordedObservations(fansClap);
    expect(evidence).toHaveLength(recorded.videos["130851320"].observations.length);
    expect(evidence.every((e) => e.source === "TWELVELABS" && e.origin === "CACHED" && e.analysisRun === "pegasus:audit-2026-10-23")).toBe(true);
    expect(evidence).toContainEqual({
      scoreplayMediaId: "130851320",
      start: 9,
      end: 14.5,
      observation: "Manchester United: The Manchester United club crest is visible on the red advertising hoarding in the foreground of the crowd shot.",
      source: "TWELVELABS",
      label: "brand:manchester-united",
      confidence: 0.9,
      origin: "CACHED",
      analysisRun: "pegasus:audit-2026-10-23",
    });
  });

  it("returns nothing when identity does not match the recording or is not evidence-linkable", () => {
    expect(recordedObservations({ ...fansClap, twelvelabsVideoId: "6ad911f0960d8ea7bdd04ced" })).toEqual([]);
    expect(recordedObservations({ ...fansClap, twelvelabsIndexId: "6ada2e70bb3f682f2f1512f5" })).toEqual([]);
    expect(recordedObservations({ ...fansClap, method: "AMBIGUOUS" })).toEqual([]);
    expect(recordedObservations({ ...fansClap, method: "UNMAPPED", twelvelabsVideoId: undefined })).toEqual([]);
    expect(recordedObservations({ ...fansClap, scoreplayMediaId: "999" })).toEqual([]);
  });

  it("normalizes labels exactly like the product run's parser", () => {
    const product = parsePegasusObservations(
      JSON.stringify({
        observations: [
          { category: "sponsor_brand", entity: "Manchester United", start_time: 9, end_time: 11, description: "crest", confidence: 0.9 },
          { category: "person", entity: "Player #18", start_time: 5, end_time: 7, description: "shorts", confidence: 0.9 },
        ],
      }),
      "130851320",
      "CACHED",
    ).evidence.map((e) => e.label);
    const audit = new Set(recordedObservations(fansClap).map((e) => e.label));
    expect(product).toEqual(["brand:manchester-united", "person:player-18"]);
    for (const label of product) expect(audit.has(label)).toBe(true);
  });

  it("maps every recorded kind onto the parser's label prefixes", () => {
    const prefixes = new Set(
      Object.entries(recorded.videos).flatMap(([id, v]) =>
        recordedObservations({ ...fansClap, scoreplayMediaId: id, twelvelabsVideoId: v.twelvelabsVideoId }).map((e) => e.label!.split(":")[0]),
      ),
    );
    expect([...prefixes].sort()).toEqual(["brand", "broadcaster", "graphic", "person"]);
    expect(RECORDED_RUN).toMatchObject({ id: "pegasus:audit-2026-10-23", model: "pegasus1.6", videos: 54 });
  });
});

describe("analysisRunLabel", () => {
  it("labels the product run, the recorded audit run and untagged evidence", () => {
    expect(analysisRunLabel("pegasus:product")).toBe("TwelveLabs video analysis");
    expect(analysisRunLabel(undefined)).toBe("TwelveLabs video analysis");
    expect(analysisRunLabel("pegasus:audit-2026-10-23")).toBe("TwelveLabs video analysis — second run (recorded 23 Oct 2026)");
  });
});
