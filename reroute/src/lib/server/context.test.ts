import { describe, expect, it } from "vitest";
import type { Asset, Evidence, MediaRef, VideoIntelligence } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { DecisionContext, withRecordedRuns, type ContextDeps } from "./context";

/** `Fans clap Man United A 9x16.mp4`: recorded in the 2026-10-23 audit run (crest 9–14.5 s). */
const FANS_CLAP = "130851320";
const linked: MediaRef = {
  scoreplayMediaId: FANS_CLAP,
  twelvelabsIndexId: "6ad911d5500e82756f2eb468",
  twelvelabsVideoId: "6ad911e365b4aff96dc7bacd",
  method: "FILENAME_DURATION",
  candidates: [],
  checkedAt: "2026-10-23T03:03:57.000Z",
};
const asset: Asset = { id: FANS_CLAP, title: "Fans clap Man United A 9x16.mp4", kind: "video", durationSec: 23.5, tags: [], facts: {}, metadata: {}, origin: "LIVE" };
const productCrest: Evidence = {
  scoreplayMediaId: FANS_CLAP,
  start: 9,
  end: 11,
  observation: "Manchester United: crest on a hoarding",
  source: "TWELVELABS",
  label: "brand:manchester-united",
  confidence: 0.9,
  origin: "CACHED",
  analysisRun: "pegasus:product",
};

function deps(opts: { ref?: MediaRef; observations?: () => Promise<Evidence[]> } = {}): ContextDeps {
  const video: VideoIntelligence = { search: async () => [], observations: opts.observations ?? (async () => [productCrest]) };
  return { getAsset: async () => asset, video: () => video, mediaRef: async () => opts.ref ?? linked, humanObservations: async () => [] };
}

describe("DecisionContext machine observations: product run + recorded audit run", () => {
  it("appends the recorded run to an AVAILABLE product analysis (both crest ranges reach the engine)", async () => {
    const ctx = new DecisionContext(deps());
    await ctx.ensure([FANS_CLAP]);
    expect(ctx.analysis[FANS_CLAP]).toEqual({ status: "AVAILABLE" });
    const crest = ctx.observations[FANS_CLAP].filter((e) => e.label === "brand:manchester-united");
    expect(crest.map((e) => [e.start, e.end, e.analysisRun])).toEqual([
      [9, 11, "pegasus:product"],
      [9, 14.5, "pegasus:audit-2026-10-23"],
    ]);
    expect(ctx.observations[FANS_CLAP].length).toBeGreaterThan(2);
  });

  it("never upgrades a failed or unlinkable analysis with recorded evidence", async () => {
    const failed = new DecisionContext(deps({ observations: async () => Promise.reject(new AppError("UPSTREAM", "boom")) }));
    await failed.ensure([FANS_CLAP]);
    expect(failed.analysis[FANS_CLAP].status).toBe("FAILED");
    expect(failed.observations[FANS_CLAP]).toEqual([]);

    const ambiguous = new DecisionContext(deps({ ref: { ...linked, method: "AMBIGUOUS", twelvelabsVideoId: undefined } }));
    await ambiguous.ensure([FANS_CLAP]);
    expect(ambiguous.analysis[FANS_CLAP].status).toBe("UNLINKABLE");
    expect(ambiguous.observations[FANS_CLAP]).toEqual([]);
  });

  it("serves no recorded evidence when the ref points at a different TwelveLabs video", async () => {
    const ctx = new DecisionContext(deps({ ref: { ...linked, twelvelabsVideoId: "6ad911f0960d8ea7bdd04ced" } }));
    await ctx.ensure([FANS_CLAP]);
    expect(ctx.observations[FANS_CLAP]).toEqual([productCrest]);
  });
});

describe("withRecordedRuns", () => {
  it("drops recorded observations identical in label and time range to product evidence", () => {
    const sameAsAudit: Evidence = { ...productCrest, start: 9, end: 14.5 };
    const fused = withRecordedRuns([sameAsAudit], linked);
    const crest = fused.filter((e) => e.label === "brand:manchester-united");
    expect(crest).toEqual([sameAsAudit]);
    expect(fused.length).toBe(1 + withRecordedRuns([], linked).length - 1);
  });
});
