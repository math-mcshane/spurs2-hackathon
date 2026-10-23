import { describe, expect, it } from "vitest";
import type { Asset, EditPlan, Evidence, MediaRef, PublishIntent, SearchHit, VideoIntelligence } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import type { ContextDeps } from "./context";
import { decideCampaign, decideEdit } from "./decide";
import { recover } from "./recovery";

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

const source = (s: Partial<{ assetId: string; title: string; start: number; end: number }> = {}) => ({
  assetId: s.assetId ?? "goal",
  title: s.title ?? "Goal Man United 9x16 (A) v1.mp4",
  range: { start: s.start ?? 5, end: s.end ?? 10 },
});

describe("recover (server): search + independent re-checks", () => {
  it("CLIP restriction: searches once, re-checks each replacement on its own, never offers the original or its renditions", async () => {
    const queries: string[] = [];
    const limits: number[] = [];
    const hits = [hit("goal", 12, 18, 1), hit("goalDup", 0, 5, 2), hit("boards", 0, 5, 3), hit("fans", 2, 6, 4), hit("nba", 0, 4, 5)];
    const { plan } = await recover({ source: source(), intents: [commercial], query: "celebrating fans", replacements: 5, idPrefix: "c" }, { deps: deps({ hits, queries, limits }), now });
    expect(queries).toEqual(["celebrating fans"]);
    expect(limits).toEqual([12]); // hits analysed per recovery are capped
    const reps = plan.options.filter((o) => o.kind === "REPLACE");
    expect(reps.map((o) => o.replacement!.scoreplayMediaId).sort()).toEqual(["boards", "fans", "nba"]);
    const by = (id: string) => reps.find((o) => o.replacement!.scoreplayMediaId === id)!;
    expect(by("fans")).toMatchObject({ outcome: "RESOLVES_DEMO", recheck: { verdict: "ALLOWED", clearance: "DEMO" } });
    expect(by("boards")).toMatchObject({ outcome: "STILL_BLOCKED" }); // third-party brand, independently re-checked
    // Another club's footage: evaluated under ITS own selection → no policy for a Tottenham publication.
    expect(by("nba").recheck).toMatchObject({ verdict: "NEEDS_REVIEW", policyId: "none" });
    expect(plan.recommendedId).toBe(by("fans").id);
  });

  it("licence gap (single unlicensed market): no search, nothing executable, honest next step", async () => {
    const queries: string[] = [];
    const intent = { ...commercial, usage: "EDITORIAL" as const, territory: "IN" };
    const { plan } = await recover({ source: source(), intents: [intent], query: "q", replacements: 3, idPrefix: "c" }, { deps: deps({ hits: [hit("fans", 0, 5, 1)], queries }), now });
    expect(queries).toEqual([]);
    expect(plan.licenceGap).toBe(true);
    expect(plan.options.map((o) => o.kind)).toEqual(["REQUEST_CLEARANCE"]);
    expect(plan.noPathMessage).toMatch(/usage rights for IN/);
  });

  it("CAMPAIGN restriction over several markets: keeps the licensed subset, no clip search", async () => {
    const queries: string[] = [];
    const editorial = { ...commercial, usage: "EDITORIAL" as const };
    const intents = ["GB", "FR", "ES", "DE", "IN", "US"].map((territory) => ({ ...editorial, territory }));
    const { plan } = await recover({ source: source(), intents, query: "q", replacements: 3, idPrefix: "c" }, { deps: deps({ queries }), now });
    expect(queries).toEqual([]);
    expect(plan.scope).toBe("CAMPAIGN");
    expect(plan.headline).toBe("In the plan: FR, ES, DE, IN aren't licensed");
    const adapt = plan.options.find((o) => o.kind === "ADAPT_CAMPAIGN")!;
    expect(adapt.campaignChange).toMatchObject({ territories: ["GB", "US"], dropped: ["FR", "ES", "DE", "IN"] });
    expect(adapt.recheck).toMatchObject({ verdict: "ALLOWED", allowedUses: 2, totalUses: 2 });
  });

  it("unproven media identity (NEEDS_REVIEW, CLIP) still gets re-checked replacements", async () => {
    const { plan } = await recover(
      { source: source(), intents: [commercial], query: "q", replacements: 3, idPrefix: "c" },
      { deps: deps({ hits: [hit("fans", 0, 5, 1)], refs: { goal: ref("goal", "AMBIGUOUS") } }), now },
    );
    expect(plan.current.verdict).toBe("NEEDS_REVIEW");
    expect(plan.options.find((o) => o.id === plan.recommendedId)?.replacement?.scoreplayMediaId).toBe("fans");
  });

  it("source not in the index (UNMAPPED): no replacement search, so another club's footage is never proposed", async () => {
    const queries: string[] = [];
    const { plan } = await recover(
      { source: source(), intents: [commercial], query: "q", replacements: 3, idPrefix: "c" },
      { deps: deps({ hits: [hit("fans", 0, 5, 1)], refs: { goal: ref("goal", "UNMAPPED") }, queries }), now },
    );
    expect(queries).toEqual([]);
    expect(plan.current.verdict).toBe("NEEDS_REVIEW");
    expect(plan.options.some((o) => o.kind === "REPLACE")).toBe(false);
  });

  it("nothing to fix for an allowed use", async () => {
    const queries: string[] = [];
    const intent = { ...commercial, usage: "EDITORIAL" as const };
    const { plan } = await recover({ source: source(), intents: [intent], query: "q", replacements: 3, idPrefix: "c" }, { deps: deps({ queries }), now });
    expect(queries).toEqual([]);
    expect(plan.current.verdict).toBe("ALLOWED");
    expect(plan.options).toEqual([]);
  });

  it("a clean section of the same clip that video search also matched is preferred and says so", async () => {
    assets.clap = thfc("clap", "Fans clap Man United A 9x16.mp4", 30, squad);
    observations.clap = [rubric("clap", "group"), { ...brand("clap", "manchester-united"), start: 9, end: 14.5 }];
    const hits = [hit("clap", 20, 28, 2), hit("fans", 0, 5, 3)];
    const { plan } = await recover({ source: source({ assetId: "clap", title: "Fans clap", start: 9, end: 14 }), intents: [commercial], query: "fans clapping", replacements: 3, idPrefix: "c" }, { deps: deps({ hits }), now });
    const section = plan.options.find((o) => o.kind === "SAFE_SECTION")!;
    expect(section.edl!.retained).toEqual([{ start: 20, end: 25 }]);
    expect(section.relevance).toBe("Video search also matched this section to “fans clapping” (#2).");
    expect(section.recheck?.verdict).toBe("ALLOWED");
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
