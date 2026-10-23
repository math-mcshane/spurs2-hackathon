import { describe, expect, it } from "vitest";
import { readTwelveLabsConfig, TwelveLabsConfigError } from "./config";

describe("readTwelveLabsConfig", () => {
  it("reports a missing key or index id as NOT_CONFIGURED", () => {
    expect(() => readTwelveLabsConfig({ env: {} })).toThrow(expect.objectContaining({ code: "NOT_CONFIGURED", missing: "API_KEY" }));
    expect(() => readTwelveLabsConfig({ env: { TWELVELABS_API_KEY: "k" } })).toThrow(TwelveLabsConfigError);
    expect(() => readTwelveLabsConfig({ env: { TWELVELABS_API_KEY: "k" } })).toThrow(expect.objectContaining({ missing: "INDEX_ID" }));
  });

  it("prefers the canonical key and accepts the legacy alias only when it is unset", () => {
    expect(readTwelveLabsConfig({ env: { TWELVELABS_API_KEY: "a", TWELVE_LABS_API_KEY: "b", TWELVELABS_INDEX_ID: "i" } })).toEqual({
      apiKey: "a",
      indexId: "i",
      keyVariable: "TWELVELABS_API_KEY",
      indexVariable: "TWELVELABS_INDEX_ID",
    });
    expect(readTwelveLabsConfig({ env: { TWELVE_LABS_API_KEY: "b", TWELVELABS_INDEX_ID: "i" } }).keyVariable).toBe("TWELVE_LABS_API_KEY");
  });

  it("uses the club's own index first and does not require the shared one then", () => {
    const env = { TWELVELABS_API_KEY: "k", PULSE_TWELVELABS_INDEX_ID_TOTTENHAM: "idx-spurs-pl" };
    expect(readTwelveLabsConfig({ club: "tottenham", env })).toMatchObject({ indexId: "idx-spurs-pl", indexVariable: "PULSE_TWELVELABS_INDEX_ID_TOTTENHAM" });
    expect(readTwelveLabsConfig({ club: "spurs", env: { ...env, TWELVELABS_INDEX_ID: "shared" } })).toMatchObject({ indexId: "shared", indexVariable: "TWELVELABS_INDEX_ID" });
    expect(() => readTwelveLabsConfig({ club: "spurs", env })).toThrow(/PULSE_TWELVELABS_INDEX_ID_SPURS and TWELVELABS_INDEX_ID/);
  });

  it("uses the club's own API key (another TwelveLabs account) and falls back to the shared key", () => {
    const env = { TWELVELABS_API_KEY: "shared", PULSE_TWELVELABS_API_KEY_SPURS: "nba", PULSE_TWELVELABS_INDEX_ID_SPURS: "idx-nba", TWELVELABS_INDEX_ID: "idx-pl" };
    expect(readTwelveLabsConfig({ club: "spurs", env })).toEqual({
      apiKey: "nba",
      indexId: "idx-nba",
      keyVariable: "PULSE_TWELVELABS_API_KEY_SPURS",
      indexVariable: "PULSE_TWELVELABS_INDEX_ID_SPURS",
    });
    expect(readTwelveLabsConfig({ club: "tottenham", env })).toMatchObject({ apiKey: "shared", keyVariable: "TWELVELABS_API_KEY", indexId: "idx-pl" });
    expect(readTwelveLabsConfig({ club: "spurs", env: { PULSE_TWELVELABS_API_KEY_SPURS: "nba", TWELVELABS_INDEX_ID: "i" } })).toMatchObject({ apiKey: "nba" });
    expect(readTwelveLabsConfig({ env })).toMatchObject({ apiKey: "shared" });
  });
});
