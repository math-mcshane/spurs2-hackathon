import { z } from "zod";
import marketJson from "./fixtures/market-signals.json";
import { MARKETS } from "./objective-parser";
import { MarketCodeSchema, type Confidence, type Level, type MarketAnalysis, type MarketCode } from "./types";

const MarketFixtureSchema = z.object({
  label: z.string(),
  disclaimer: z.string(),
  geographyBasis: z.string(),
  sources: z.array(z.string()),
  window: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }),
  baselineWeeks: z.number().int().positive(),
  series: z.array(
    z.object({
      topic: z.string(),
      market: z.union([MarketCodeSchema, z.literal("GLOBAL")]),
      current: z.number().int().nonnegative(),
      /** Average weekly count over the previous `baselineWeeks` weeks. */
      baseline: z.number().nonnegative(),
      samples: z
        .array(z.object({ id: z.string(), text: z.string(), lang: z.string(), postedAt: z.iso.datetime({ offset: true }) }))
        .default([]),
    }),
  ),
});
export type MarketFixture = z.infer<typeof MarketFixtureSchema>;

export const MARKET_FIXTURE: MarketFixture = MarketFixtureSchema.parse(marketJson);

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Momentum: how far above its own usual level the market is, and whether that is beyond noise (Poisson z). */
export function momentumLevel(lift: number, z: number): Level {
  if (lift >= 2 && z >= 3) return "HIGH";
  if (lift >= 1.3 && z >= 2) return "MEDIUM";
  if (lift > 1 && z >= 2) return "LOW";
  return "NONE";
}

/** Confidence that the shift is real (sample size + significance) — not confidence in any sales effect. */
export function shiftConfidence(current: number, z: number): Confidence {
  if (current < 30 || z < 2) return "LOW";
  if (current >= 100 && z >= 3) return "HIGH";
  return "MEDIUM";
}

/**
 * Compares a topic's conversation in one market with (a) that market's usual level and (b) the
 * global conversation; `"GLOBAL"` analyzes the worldwide total against its own usual level.
 * `undefined` when the source has no data for this topic × market — PULSE never fills the gap.
 */
export function analyzeMarket(
  topic: string,
  market: MarketCode | "GLOBAL",
  fixture: MarketFixture = MARKET_FIXTURE,
): MarketAnalysis | undefined {
  const global = fixture.series.find((s) => s.topic === topic && s.market === "GLOBAL");
  const local = fixture.series.find((s) => s.topic === topic && s.market === market);
  if (!global || !local) return undefined;

  const baseline = Math.max(local.baseline, 1);
  const lift = local.current / baseline;
  const z = (local.current - baseline) / Math.sqrt(baseline);
  const globalMax = Math.max(...fixture.series.filter((s) => s.market === "GLOBAL").map((s) => s.current));
  const ratio = global.current / globalMax;
  const globalInterest = ratio >= 0.5 ? "HIGH" : ratio >= 0.2 ? "MEDIUM" : "LOW";
  const momentum = momentumLevel(lift, z);
  const shareNow = global.current > 0 ? local.current / global.current : 0;
  const shareUsual = global.baseline > 0 ? local.baseline / global.baseline : 0;

  return {
    market: { code: market, label: market === "GLOBAL" ? "Global" : MARKETS[market].label },
    window: fixture.window,
    current: local.current,
    baseline: local.baseline,
    lift: round(lift, 2),
    z: round(z, 1),
    globalCurrent: global.current,
    globalBaseline: global.baseline,
    globalLift: round(global.current / Math.max(global.baseline, 1), 2),
    globalVolumeShare: round(ratio, 3),
    shareNow: round(shareNow, 3),
    shareUsual: round(shareUsual, 3),
    globalInterest,
    momentum,
    confidence: shiftConfidence(local.current, z),
    underTheRadar: (momentum === "HIGH" || momentum === "MEDIUM") && globalInterest !== "HIGH" && shareNow >= 2 * shareUsual,
    sources: fixture.sources,
    geographyBasis: fixture.geographyBasis,
    samples: local.samples,
    mode: "FIXTURE",
  };
}
