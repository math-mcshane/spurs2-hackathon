import { describe, expect, it } from "vitest";
import type { Asset, EditPlan, Evidence, PublishIntent, SearchHit, VideoIntelligence } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { loadPolicy } from "@/lib/rights";
import type { ContextDeps } from "./context";
import { decideEdit } from "./decide";
import { resolve } from "./resolver";

const policy = loadPolicy("demo-spurs-fr-sponsored");
const now = new Date("2026-10-22T12:00:00Z");
const intent: PublishIntent = {
  territory: "FR",
  platform: "instagram",
  usage: "SPONSORED",
  competition: "NBA",
  publishAt: "2026-11-01T18:00:00Z",
};

function asset(id: string, facts: Asset["facts"], durationSec = 120): Asset {
  return { id, title: `Asset ${id}`, kind: "video", durationSec, tags: [], facts, metadata: {}, origin: "LIVE" };
}

const knownFacts = { competition: "NBA", team: "San Antonio Spurs", people: [], sponsors: [] };
const assets: Record<string, Asset> = {
  src: asset("src", knownFacts),
  clean: asset("clean", knownFacts),
  // Sponsors never recorded in ScorePlay → unknown → must not be eligible.
  unknown: asset("unknown", { competition: "NBA", team: "San Antonio Spurs", people: [] }),
  // Known facts but TwelveLabs has no analysis for it (observations() throws).
  unanalyzed: asset("unanalyzed", knownFacts),
};

const observations: Record<string, Evidence[]> = {
  src: [
    {
      scoreplayMediaId: "src",
      start: 4,
      end: 9,
      observation: "Courtside board shows a rival sponsor's branding",
      source: "HUMAN",
      origin: "HUMAN",
      label: "brand:rival-sponsor",
    },
  ],
  clean: [],
  unknown: [],
};

const edit: EditPlan = {
  id: "edit-1",
  title: "Spurs 15s",
  derived: false,
  segments: [
    { scoreplayMediaId: "src", start: 0, end: 4 },
    { scoreplayMediaId: "src", start: 4, end: 9, label: "fast break dunk" },
    { scoreplayMediaId: "src", start: 9, end: 15 },
  ],
};

function hit(scoreplayMediaId: string, start: number, end: number, rank: number): SearchHit {
  return { scoreplayMediaId, twelvelabsVideoId: `tl-${scoreplayMediaId}`, start, end, rank, origin: "LIVE" };
}

function deps(hits: SearchHit[], queries: string[] = []): ContextDeps {
  const video: VideoIntelligence = {
    async search(query, opts) {
      queries.push(query);
      return hits.slice(0, opts?.limit);
    },
    async observations(id) {
      const found = observations[id];
      if (!found) throw new AppError("NOT_FOUND", `no analysis for ${id}`);
      return found;
    },
  };
  return {
    getAsset: async (id) => {
      const found = assets[id];
      if (!found) throw new AppError("NOT_FOUND", `asset ${id}`);
      return found;
    },
    video: () => video,
    humanObservations: async () => [],
  };
}

const run = (hits: SearchHit[], extra: { query?: string; limit?: number; queries?: string[] } = {}) =>
  resolve(
    { edit, intent, segmentIndex: 1, query: extra.query, limit: extra.limit ?? 3 },
    { deps: deps(hits, extra.queries), policy, now },
  );

describe("resolve", () => {
  it("finds an eligible alternative and re-evaluates the proposed edit as ALLOWED", async () => {
    const queries: string[] = [];
    const result = await run([hit("unknown", 30, 33, 1), hit("clean", 40, 46, 2)], { queries });

    expect(queries).toEqual(["fast break dunk"]);
    expect(result.query).toBe("fast break dunk");
    expect(result.best).toBeDefined();
    const best = result.best!;
    expect(best.eligible).toBe(true);
    expect(best.hit.scoreplayMediaId).toBe("clean");
    expect(best.segmentDecision.verdict).toBe("ALLOWED");
    expect(best.editDecision.decision.verdict).toBe("ALLOWED");
    expect(best.editDecision.segments).toHaveLength(3);
    expect(best.editDecision.segments.every((s) => s.decision.verdict === "ALLOWED")).toBe(true);

    // Minimal change: only the blocked segment swapped, trimmed to its 5 s around the hit's midpoint.
    expect(best.proposedEdit.derived).toBe(true);
    expect(best.proposedEdit.derivedFrom).toBe("edit-1");
    expect(best.proposedEdit.segments[0]).toEqual(edit.segments[0]);
    expect(best.proposedEdit.segments[2]).toEqual(edit.segments[2]);
    expect(best.proposedEdit.segments[1]).toMatchObject({ scoreplayMediaId: "clean", start: 40.5, end: 45.5 });

    // Eligible ranks first even though Marengo ranked it second.
    expect(result.candidates.map((c) => c.hit.scoreplayMediaId)).toEqual(["clean", "unknown"]);
  });

  it("never marks a candidate with unknown rights facts eligible or best", async () => {
    const result = await run([hit("unknown", 30, 33, 1)]);

    expect(result.candidates).toHaveLength(1);
    const [candidate] = result.candidates;
    expect(candidate.eligible).toBe(false);
    expect(candidate.segmentDecision.verdict).toBe("NEEDS_REVIEW");
    expect(candidate.editDecision.decision.verdict).toBe("NEEDS_REVIEW");
    // Extended from 3 s to the blocked segment's 5 s.
    expect(candidate.proposedEdit.segments[1]).toMatchObject({ start: 29, end: 34 });
    expect(result.best).toBeUndefined();
  });

  it("excludes candidates overlapping the blocked range of the same asset", async () => {
    const result = await run([
      hit("src", 5, 8, 1), // inside the blocked range
      hit("src", 9, 10, 2), // fitted to 5 s it would overlap 4–9 s
      hit("src", 60, 65, 3), // same asset, elsewhere: allowed
    ]);

    expect(result.candidates).toHaveLength(1);
    const [candidate] = result.candidates;
    expect(candidate.hit.rank).toBe(3);
    expect(candidate.proposedEdit.segments[1]).toMatchObject({ scoreplayMediaId: "src", start: 60, end: 65 });
    expect(candidate.eligible).toBe(true);
  });

  it("caps candidates without video analysis at NEEDS_REVIEW", async () => {
    const result = await run([hit("unanalyzed", 10, 15, 1)]);

    const [candidate] = result.candidates;
    expect(candidate.eligible).toBe(false);
    expect(candidate.segmentDecision.verdict).toBe("NEEDS_REVIEW");
    expect(candidate.segmentDecision.reasons.some((r) => r.ruleId === "analysis-unavailable")).toBe(true);
    expect(result.best).toBeUndefined();
  });

  it("keeps the original edit BLOCKED for this intent (sanity)", async () => {
    const decision = await decideEdit(edit, intent, { deps: deps([]), policy, now });
    expect(decision.decision.verdict).toBe("BLOCKED");
    expect(decision.segments.map((s) => s.decision.verdict)).toEqual(["ALLOWED", "BLOCKED", "ALLOWED"]);
    const organic = await decideEdit(edit, { ...intent, usage: "ORGANIC" }, { deps: deps([]), policy, now });
    expect(organic.decision.verdict).toBe("ALLOWED");
  });
});
