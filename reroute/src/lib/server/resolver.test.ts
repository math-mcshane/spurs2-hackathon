import { describe, expect, it } from "vitest";
import type { Asset, EditPlan, Evidence, MediaRef, PublishIntent, SearchHit, VideoIntelligence } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import type { ContextDeps } from "./context";
import { decideCampaign, decideEdit } from "./decide";
import { resolve } from "./resolver";

const now = new Date("2026-10-22T12:00:00Z");
const commercial: PublishIntent = {
  territory: "GB",
  platform: "instagram",
  usage: "COMMERCIAL",
  competition: "Premier League",
  club: "tottenham",
  publishAt: "2026-11-01T18:00:00Z",
};

function thfc(id: string, title: string, durationSec: number, facts: Partial<Asset["facts"]> = {}): Asset {
  return {
    id,
    title,
    kind: "video",
    durationSec,
    tags: ["partner content", "Premier League", "Tottenham Hotspur", "Manchester United"],
    facts: { competition: "Premier League", teams: ["Tottenham Hotspur", "Manchester United"], ...facts },
    metadata: {},
    origin: "LIVE",
  };
}
const squad = { people: ["Dominic Solanke-Mitchell"], peopleTeams: { "Dominic Solanke-Mitchell": ["Tottenham Hotspur FC"] } };

const assets: Record<string, Asset> = {
  goal: thfc("goal", "Goal Man United 9x16 (A) v1.mp4", 30, squad),
  goalDup: thfc("goalDup", "Goal Man United 4x5 (A) v2.mp4", 30.2, squad), // rendition of the original
  fans: thfc("fans", "Slide 6 - Away End Singing Pre-KO.mov", 10, { people: [] }),
  boards: thfc("boards", "Slide 17 - Stadium GV.mov", 7.5, { people: [] }),
  nba: {
    id: "nba",
    title: "Vic dunk.mp4",
    kind: "video",
    durationSec: 12,
    tags: ["NBA"],
    facts: { competition: "NBA", teams: ["San Antonio Spurs (SAS)"], people: ["Victor Wembanyama"], sponsors: [] },
    metadata: {},
    origin: "LIVE",
  },
};

const rubric = (id: string, answer: string): Evidence => ({ scoreplayMediaId: id, observation: `player_focus ${answer}`, source: "TWELVELABS", label: `rubric:player_focus:${answer}` });
const brand = (id: string, name: string): Evidence => ({ scoreplayMediaId: id, start: 0, end: 30, observation: `${name}: LED board`, source: "TWELVELABS", label: `brand:${name}`, confidence: 0.9 });
const observations: Record<string, Evidence[]> = {
  goal: [rubric("goal", "group"), brand("goal", "snapdragon")],
  goalDup: [rubric("goalDup", "group")],
  fans: [rubric("fans", "no_players")],
  boards: [rubric("boards", "no_players"), brand("boards", "snapdragon")],
  nba: [],
};

const edit: EditPlan = { id: "merch", title: "Merch promo", derived: false, segments: [{ scoreplayMediaId: "goal", start: 5, end: 10, label: "celebrating fans" }] };

const ref = (id: string, method: MediaRef["method"] = "FILENAME_DURATION"): MediaRef => ({
  scoreplayMediaId: id,
  twelvelabsVideoId: method === "FILENAME_DURATION" ? `tl-${id}` : undefined,
  method,
  candidates: [],
  checkedAt: now.toISOString(),
});
const hit = (scoreplayMediaId: string, start: number, end: number, rank: number): SearchHit => ({
  scoreplayMediaId,
  twelvelabsVideoId: `tl-${scoreplayMediaId}`,
  start,
  end,
  rank,
  origin: "LIVE",
  mapping: "FILENAME_DURATION",
});

function deps(opts: { hits?: SearchHit[]; queries?: string[]; limits?: number[]; refs?: Record<string, MediaRef>; human?: () => Promise<Evidence[]> } = {}): ContextDeps {
  const video: VideoIntelligence = {
    async search(query, searchOpts) {
      opts.queries?.push(query);
      opts.limits?.push(searchOpts?.limit ?? -1);
      return opts.hits ?? [];
    },
    async observations(r) {
      return observations[r.scoreplayMediaId!] ?? [];
    },
  };
  return {
    getAsset: async (id) => {
      if (!assets[id]) throw new AppError("NOT_FOUND", `no asset ${id}`);
      return assets[id];
    },
    video: () => video,
    mediaRef: async (id) => opts.refs?.[id] ?? ref(id),
    humanObservations: opts.human ?? (async () => []),
  };
}

describe("resolve", () => {
  it("CLIP blocker: re-checks every candidate alone and in the full edit, excludes the original and its renditions", async () => {
    const queries: string[] = [];
    const hits = [hit("goal", 12, 18, 1), hit("goalDup", 0, 5, 2), hit("boards", 0, 5, 3), hit("fans", 2, 6, 4), hit("nba", 0, 4, 5)];
    const limits: number[] = [];
    const result = await resolve({ edit, intent: commercial, segmentIndex: 0, limit: 5 }, { deps: deps({ hits, queries, limits }), now });
    expect(limits).toEqual([12]); // hits analysed per resolve are capped

    expect(queries).toEqual(["celebrating fans"]); // query = segment label
    expect(result.blocker).toMatchObject({ scope: "CLIP", dimensions: ["sponsor"] });
    expect(result.candidates.map((c) => c.hit.scoreplayMediaId)).toEqual(["fans", "boards", "nba"]);

    const [fans, boards, nba] = result.candidates;
    expect(fans).toMatchObject({ eligible: true, segmentDecision: { verdict: "ALLOWED", clearance: "DEMO" } });
    expect(fans.editDecision.decision).toMatchObject({ verdict: "ALLOWED", clearance: "DEMO", policyFictional: true });
    expect(result.best?.hit.scoreplayMediaId).toBe("fans");

    expect(boards.eligible).toBe(false);
    expect(boards.segmentDecision.verdict).toBe("BLOCKED"); // third-party brand, independently re-checked

    // Another club's footage: evaluated under ITS own selection → no policy for a Tottenham publication.
    expect(nba.eligible).toBe(false);
    expect(nba.segmentDecision).toMatchObject({ verdict: "NEEDS_REVIEW", policyId: "none" });
  });

  it("CAMPAIGN blocker: no search, no candidates, a concrete suggestion", async () => {
    const queries: string[] = [];
    const intent = { ...commercial, usage: "EDITORIAL" as const, territory: "IN" };
    const result = await resolve({ edit, intent, segmentIndex: 0, limit: 3 }, { deps: deps({ hits: [hit("fans", 0, 5, 1)], queries }), now });
    expect(queries).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result.blocker).toMatchObject({ scope: "CAMPAIGN", dimensions: ["territory"] });
    expect(result.blocker.suggestion).toMatch(/GB, IE, US, CA, AU, NZ/);
  });

  it("CAMPAIGN blocker over every use: lists all unlicensed territories and returns the licensed subset as remedy", async () => {
    const editorial = { ...commercial, usage: "EDITORIAL" as const };
    const intents = ["GB", "FR", "ES", "DE", "IN", "US"].map((territory) => ({ ...editorial, territory }));
    const result = await resolve({ edit, intent: intents[0], intents, segmentIndex: 0, limit: 3 }, { deps: deps(), now });
    expect(result.blocker.scope).toBe("CAMPAIGN");
    expect(result.blocker.explanation).toMatch(/Not licensed in FR, ES, DE, IN\./);
    expect(result.blocker.suggestion).toMatch(/Drop FR, ES, DE, IN/);
    expect(result.remedy).toEqual({ territories: ["GB", "US"] });
    expect(result.candidates).toEqual([]);
  });

  it("works for NEEDS_REVIEW segments (ambiguous media identity ⇒ MEDIA_IDENTITY, CLIP)", async () => {
    const result = await resolve(
      { edit, intent: commercial, segmentIndex: 0, limit: 3 },
      { deps: deps({ hits: [hit("fans", 0, 5, 1)], refs: { goal: ref("goal", "AMBIGUOUS") } }), now },
    );
    expect(result.blocker.scope).toBe("CLIP");
    expect(result.best?.hit.scoreplayMediaId).toBe("fans");
  });

  it("nothing to resolve for an ALLOWED segment", async () => {
    const intent = { ...commercial, usage: "EDITORIAL" as const };
    const result = await resolve({ edit, intent, segmentIndex: 0, limit: 3 }, { deps: deps(), now });
    expect(result).toMatchObject({ blocker: { scope: "NONE" }, candidates: [] });
  });
});

describe("decideEdit / decideCampaign", () => {
  it("ambiguous mapping ⇒ NEEDS_REVIEW with MEDIA_IDENTITY, and the MediaRef is recorded", async () => {
    const d = await decideEdit(edit, { ...commercial }, { deps: deps({ refs: { goal: ref("goal", "AMBIGUOUS") } }), now });
    expect(d.decision.verdict).toBe("NEEDS_REVIEW");
    expect(d.decision.reasons.filter((r) => r.outcome !== "PERMIT").every((r) => r.basis === "MEDIA_IDENTITY")).toBe(true);
    expect(d.media).toEqual([expect.objectContaining({ scoreplayMediaId: "goal", method: "AMBIGUOUS" })]);
  });

  it("unconfigured reviewer-observation store degrades with a note instead of failing", async () => {
    const human = async () => {
      throw new AppError("NOT_CONFIGURED", "SUPABASE_URL is not set");
    };
    const d = await decideEdit(edit, { ...commercial, usage: "EDITORIAL" }, { deps: deps({ human }), now });
    expect(d.decision.verdict).toBe("ALLOWED");
    expect(d.notes[0]).toMatch(/Reviewer observations are unavailable/);
  });

  it("overall = worst verdict across intents; clearance VERIFIED only if every intent is VERIFIED", async () => {
    const editorial = { ...commercial, usage: "EDITORIAL" as const };
    const fans: EditPlan = { ...edit, segments: [{ scoreplayMediaId: "fans", start: 0, end: 5 }] };
    const ok = await decideCampaign({ edit: fans, intents: [editorial, { ...editorial, territory: "US" }] }, { deps: deps(), now });
    expect(ok.overall).toMatchObject({ verdict: "ALLOWED", clearance: "DEMO", policyFictional: true });
    expect(ok.media).toHaveLength(1);

    const mixed = await decideCampaign({ edit, intents: [editorial, commercial, { ...editorial, territory: "IN" }] }, { deps: deps(), now });
    expect(mixed.perIntent.map((p) => p.decision.decision.verdict)).toEqual(["ALLOWED", "BLOCKED", "NEEDS_REVIEW"]);
    expect(mixed.overall).toMatchObject({ verdict: "BLOCKED", clearance: "NONE" });
  });
});
