import { describe, expect, it } from "vitest";
import { canPublish, type Asset, type Evidence, type PublishIntent } from "@/lib/contracts";
import { BUNDLED_POLICIES, type AnalysisStatus } from "../index";
import { buildEdl, buildTimeline, edlToEditPlan, mergeIntervals, remapEvidence, subtractIntervals } from "./edl";
import { isUnverifiedPerson } from "../engine";
import { evaluateUses, locateProblems, planRecovery, summarizeUses, type RecoveryEvalContext, type ReplacementInput } from "./plan";

const now = new Date("2026-10-22T12:00:00Z");
const AVAILABLE: AnalysisStatus = { status: "AVAILABLE" };
const SQUAD = { "Dominic Solanke-Mitchell": ["Tottenham Hotspur FC"], "Micky van de Ven": ["Tottenham Hotspur FC"] };

function thfc(id: string, facts: Partial<Asset["facts"]> = {}, durationSec = 30, extraTags: string[] = []): Asset {
  return {
    id,
    title: `Clip ${id}.mp4`,
    kind: "video",
    durationSec,
    tags: ["partner content", "Premier League", "Tottenham Hotspur", "Manchester United", ...extraTags],
    facts: { competition: "Premier League", teams: ["Tottenham Hotspur", "Manchester United"], people: ["Dominic Solanke-Mitchell", "Micky van de Ven"], peopleTeams: SQUAD, ...facts },
    metadata: {},
    origin: "LIVE",
  };
}

const ev = (id: string, label: string, start: number, end: number, extra: Partial<Evidence> = {}): Evidence => ({
  scoreplayMediaId: id,
  start,
  end,
  observation: `${label.split(":").pop()}: seen`,
  source: "TWELVELABS",
  label,
  confidence: 0.9,
  origin: "CACHED",
  ...extra,
});

const intent = (over: Partial<PublishIntent> = {}): PublishIntent => ({
  territory: "GB",
  platform: "instagram",
  usage: "COMMERCIAL",
  competition: "Premier League",
  club: "tottenham",
  publishAt: "2026-11-01T18:00:00Z",
  ...over,
});
const SALES = ["instagram", "facebook", "x"].map((platform) => intent({ platform }));

function ctxOf(assets: Asset[], evidence: Evidence[]): RecoveryEvalContext {
  return {
    assets: Object.fromEntries(assets.map((a) => [a.id, a])),
    observations: Object.fromEntries(assets.map((a) => [a.id, evidence.filter((e) => e.scoreplayMediaId === a.id)])),
    analysis: Object.fromEntries(assets.map((a) => [a.id, AVAILABLE])),
    policies: BUNDLED_POLICIES,
    now,
  };
}

describe("EDL interval math", () => {
  it("removes a timecoded segment and keeps the exact source intervals", () => {
    expect(subtractIntervals({ start: 6.87, end: 14.67 }, [{ start: 9, end: 11 }])).toEqual([
      { start: 6.87, end: 9 },
      { start: 11, end: 14.67 },
    ]);
  });

  it("merges overlapping and touching removals before subtracting", () => {
    expect(mergeIntervals([{ start: 3, end: 5 }, { start: 1, end: 3 }, { start: 4, end: 6 }, { start: 8, end: 9 }])).toEqual([
      { start: 1, end: 6 },
      { start: 8, end: 9 },
    ]);
    expect(subtractIntervals({ start: 0, end: 10 }, [{ start: 2, end: 4 }, { start: 4, end: 5 }])).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 10 },
    ]);
  });

  it("clips removals to the range and computes the new duration and output timeline", () => {
    const edl = buildEdl({
      id: "e",
      sourceAssetId: "a",
      sourceTitle: "A",
      range: { start: 10, end: 19 },
      removals: [{ start: 14.5, end: 17.5, reason: "DHL", ruleIds: ["THFC-13"], evidence: [] }, { start: 0, end: 10.2, reason: "before", ruleIds: ["x"], evidence: [] }],
      minPieceSec: 1,
    })!;
    expect(edl.retained).toEqual([
      { start: 10.2, end: 14.5 },
      { start: 17.5, end: 19 },
    ]);
    expect(edl.durationSec).toBe(5.8);
    expect(edl.originalDurationSec).toBe(9);
    expect(edl.timeline).toEqual([
      { sourceStart: 10.2, sourceEnd: 14.5, outStart: 0, outEnd: 4.3 },
      { sourceStart: 17.5, sourceEnd: 19, outStart: 4.3, outEnd: 5.8 },
    ]);
    expect(edl.execution).toBe("PLAN_NOT_RENDERED");
  });

  it("drops leftover flashes shorter than the minimum piece and records them as removed", () => {
    const edl = buildEdl({ id: "e", sourceAssetId: "a", sourceTitle: "A", range: { start: 0, end: 10 }, removals: [{ start: 0.5, end: 9, reason: "r", ruleIds: ["r"], evidence: [] }], minPieceSec: 1 })!;
    expect(edl.retained).toEqual([{ start: 9, end: 10 }]);
    expect(edl.removed.map((r) => [r.start, r.end])).toEqual([
      [0, 0.5],
      [0.5, 9],
    ]);
    expect(buildEdl({ id: "e", sourceAssetId: "a", sourceTitle: "A", range: { start: 0, end: 2 }, removals: [{ start: 0, end: 2, reason: "r", ruleIds: [], evidence: [] }], minPieceSec: 1 })).toBeUndefined();
  });

  it("remaps source-timed evidence onto the output timeline (and nowhere when it was cut)", () => {
    const timeline = buildTimeline([
      { start: 10, end: 14.5 },
      { start: 17.5, end: 19 },
    ]);
    expect(remapEvidence(ev("a", "brand:aia", 12, 18), timeline)).toEqual([
      { start: 2, end: 4.5 },
      { start: 4.5, end: 5 },
    ]);
    expect(remapEvidence(ev("a", "brand:dhl", 15, 17), timeline)).toEqual([]);
    expect(remapEvidence({ scoreplayMediaId: "a", observation: "summary", source: "TWELVELABS" }, timeline)).toEqual([{ start: 0, end: 6 }]);
  });

  it("turns an EDL into a derived edit of the kept source intervals, distinct from the source id", () => {
    const edl = buildEdl({ id: "camp:v2:trim", sourceAssetId: "a", sourceTitle: "A", range: { start: 0, end: 10 }, removals: [{ start: 4, end: 6, reason: "r", ruleIds: ["r"], evidence: [] }], minPieceSec: 1 })!;
    const plan = edlToEditPlan(edl);
    expect(plan).toMatchObject({ id: "camp:v2:trim", derived: true, derivedFrom: "a" });
    expect(plan.id).not.toBe("a");
    expect(plan.segments.map((s) => [s.scoreplayMediaId, s.start, s.end])).toEqual([
      ["a", 0, 4],
      ["a", 6, 10],
    ]);
  });
});

describe("Recovery engine — localization", () => {
  it("separates a localized brand from footage-wide and campaign-wide restrictions", () => {
    const asset = thfc("c1");
    const ctx = ctxOf([asset], [ev("c1", "brand:dhl", 15, 17)]);
    const where = locateProblems(ctx, "c1", [{ start: 10, end: 19 }], [intent({ territory: "FR" })]);
    expect(where.localized).toHaveLength(1);
    expect(where.localized[0]).toMatchObject({ start: 15, end: 17, ruleIds: ["THFC-13-partner-exclusivity"] });
    expect(where.localized[0].evidence.map((e) => e.label)).toEqual(["brand:dhl"]);
    expect(where.campaign.map((c) => c.reason.dimension)).toContain("territory");
    expect(where.pervasive).toEqual([]);
  });
});

describe("Recovery engine — planRecovery", () => {
  it("TRIM: removes the one localized blocker and the independent re-check allows the kept footage (demo)", () => {
    const asset = thfc("goal");
    const ctx = ctxOf([asset], [ev("goal", "brand:aia", 10, 19), ev("goal", "brand:dhl", 15, 17)]);
    const plan = planRecovery({ ctx, source: { assetId: "goal", title: asset.title, range: { start: 10, end: 19 } }, intents: SALES, idPrefix: "c" });
    expect(plan.current).toMatchObject({ verdict: "BLOCKED", allowedUses: 0, totalUses: 3 });
    const trim = plan.options.find((o) => o.kind === "TRIM")!;
    expect(trim.title).toBe("Remove 0:14.5–0:17.5");
    expect(trim.edl!.retained).toEqual([
      { start: 10, end: 14.5 },
      { start: 17.5, end: 19 },
    ]);
    expect(trim.edl!.durationSec).toBe(6);
    expect(trim.recheck).toMatchObject({ verdict: "ALLOWED", clearance: "DEMO", allowedUses: 3, totalUses: 3 });
    expect(trim.outcome).toBe("RESOLVES_DEMO");
    expect(plan.recommendedId).toBe(trim.id);
    // The goal is preserved: same uses, same usage.
    expect(trim.intents).toEqual(SALES);
    expect(trim.changesGoal).toBe(false);
  });

  it("TRIM: a second blocker outside the removed range keeps the cut blocked (no copied verdict)", () => {
    const asset = thfc("two");
    // Two runs disagree: run A sees the board 9–11 s, run B until 14.5 s. Each is a separate observation.
    const runA = ev("two", "brand:manchester-united", 9, 11, { analysisRun: "pegasus:product" });
    const runB = ev("two", "brand:manchester-united", 9, 14.5, { analysisRun: "pegasus:audit-2026-10-23" });
    const ctx = ctxOf([asset], [runA, runB]);
    // A naive cut of run A's span only, re-checked with every run's evidence: still blocked by run B.
    const naive = buildEdl({ id: "naive", sourceAssetId: "two", sourceTitle: asset.title, range: { start: 6, end: 18 }, removals: [{ start: 9, end: 11, reason: "run A", ruleIds: ["THFC-13-partner-exclusivity"], evidence: [runA] }], minPieceSec: 1 })!;
    const naiveCheck = summarizeUses(evaluateUses(ctx, edlToEditPlan(naive), SALES));
    expect(naiveCheck.verdict).toBe("BLOCKED");
    expect(naiveCheck.remaining.map((r) => r.ruleId)).toContain("THFC-13-partner-exclusivity");
    // The engine itself cuts the union of both runs (plus margin) and the re-check passes.
    const plan = planRecovery({ ctx, source: { assetId: "two", title: asset.title, range: { start: 6, end: 18 } }, intents: SALES, idPrefix: "c" });
    const trim = plan.options.find((o) => o.kind === "TRIM")!;
    expect(trim.edl!.removed.filter((r) => r.ruleIds.length).map((r) => [r.start, r.end])).toEqual([[8.5, 15]]);
    expect(trim.recheck?.verdict).toBe("ALLOWED");
  });

  it("TRIM: rejects a cut that leaves too little footage, and says why", () => {
    const asset = thfc("fans");
    const ctx = ctxOf(
      [asset],
      [ev("fans", "person:player-18", 5, 7, { observation: "Player #18: shorts number" }), ev("fans", "brand:manchester-united", 9, 14.5, { observation: "Manchester United: crest on hoarding" })],
    );
    const plan = planRecovery({ ctx, source: { assetId: "fans", title: asset.title, range: { start: 6.87, end: 14.67 } }, intents: SALES, idPrefix: "c" });
    const trim = plan.options.find((o) => o.kind === "TRIM")!;
    expect(trim.outcome).toBe("NOT_VIABLE");
    expect(trim.notViableBecause).toMatch(/would leave 1\.0 s of 7\.8 s/);
    expect(trim.recheck).toBeUndefined();
    expect(plan.problems.filter((p) => p.at).map((p) => [p.at!.start, p.at!.end])).toEqual([
      [6.87, 7],
      [9, 14.5],
    ]);
    // Multiple independent blockers are both localized and both cut.
    expect(trim.edl!.removed.filter((r) => r.ruleIds.length).map((r) => r.ruleIds[0])).toEqual(["subject:person:player-18", "THFC-13-partner-exclusivity"]);
    // A rejected trim is never recommended.
    expect(plan.recommendedId).not.toBe(trim.id);
  });

  it("SAFE_SECTION: finds the best clean continuous section of the same asset and re-checks it", () => {
    const asset = thfc("fans2", {}, 30.44);
    const ctx = ctxOf([asset], [ev("fans2", "person:player-18", 5, 7), ev("fans2", "brand:manchester-united", 9, 14.5), ev("fans2", "person:player-5", 20.5, 23)]);
    const plan = planRecovery({ ctx, source: { assetId: "fans2", title: asset.title, range: { start: 6.87, end: 14.67 } }, intents: SALES, idPrefix: "c" });
    const section = plan.options.find((o) => o.kind === "SAFE_SECTION")!;
    // Clean windows (± 0.5 s margins): 15–20 s and 23.5–30.44 s. The one closest to the chosen moment wins.
    expect(section.edl!.retained).toEqual([{ start: 15, end: 20 }]);
    expect(section.recheck?.verdict).toBe("ALLOWED");
    expect(section.relevance).toMatch(/^0\.3 s away .*search did not match this section/);
  });

  it("a footage-wide restriction cannot be cut out: the trim's re-check still fails", () => {
    // Highlights can't be used in sales posts (asset tag rule) — present everywhere in the clip.
    const asset = thfc("hl", {}, 30, ["Highlights"]);
    const ctx = ctxOf([asset], [ev("hl", "brand:dhl", 4, 6)]);
    const plan = planRecovery({ ctx, source: { assetId: "hl", title: asset.title, range: { start: 0, end: 12 } }, intents: SALES, idPrefix: "c" });
    expect(plan.problems.some((p) => p.pervasive && p.ruleIds.includes("THFC-6-no-broadcast-footage-in-ads"))).toBe(true);
    const trim = plan.options.find((o) => o.kind === "TRIM")!;
    expect(trim.outcome).toBe("STILL_BLOCKED");
    expect(trim.recheck?.remaining.map((r) => r.ruleId)).toContain("THFC-6-no-broadcast-footage-in-ads");
    expect(trim.notViableBecause).toMatch(/^Still restricted after this change: /);
    expect(trim.recheck).toMatchObject({ allowedUses: 0, restrictedUses: SALES.length, unresolvedUses: 0, totalUses: SALES.length });
  });

  it("CAMPAIGN restriction: adapts the markets (smallest change) and re-checks only the licensed uses", () => {
    const asset = thfc("glob");
    const ctx = ctxOf([asset], []);
    const intents = ["GB", "US", "FR", "ES"].map((territory) => intent({ territory, usage: "EDITORIAL" }));
    const plan = planRecovery({ ctx, source: { assetId: "glob", title: asset.title, range: { start: 0, end: 14.8 } }, intents, idPrefix: "c" });
    expect(plan.scope).toBe("CAMPAIGN");
    expect(plan.options.some((o) => o.kind === "TRIM" || o.kind === "SAFE_SECTION")).toBe(false);
    const adapt = plan.options.find((o) => o.kind === "ADAPT_CAMPAIGN")!;
    expect(adapt.campaignChange).toMatchObject({ territories: ["GB", "US"], dropped: ["FR", "ES"] });
    expect(adapt.recheck).toMatchObject({ verdict: "ALLOWED", allowedUses: 2, totalUses: 2 });
    expect(plan.recommendedId).toBe(adapt.id);
    expect(plan.options.find((o) => o.kind === "REQUEST_CLEARANCE")?.summary).toMatch(/usage rights for FR, ES/);
  });

  it("licence gap: no licensed market → no executable option, honest next step", () => {
    const asset = thfc("mx");
    const plan = planRecovery({ ctx: ctxOf([asset], []), source: { assetId: "mx", title: asset.title, range: { start: 0, end: 8 } }, intents: [intent({ territory: "MX" })], idPrefix: "c" });
    expect(plan.options.filter((o) => o.outcome === "RESOLVES_DEMO" && !o.changesGoal)).toEqual([]);
    expect(plan.recommendedId).toBeUndefined();
    expect(plan.noPathMessage).toMatch(/No licensed path: Request additional usage rights for MX/);
    expect(plan.options.at(-1)).toMatchObject({ kind: "REQUEST_CLEARANCE", outcome: "NEXT_STEP" });
  });

  it("ambiguous observation: low-confidence AI brand cannot block, it asks for review — and the cut resolves it", () => {
    const asset = thfc("amb");
    const ctx = ctxOf([asset], [ev("amb", "brand:betx", 3, 4, { confidence: 0.4 })]);
    const plan = planRecovery({ ctx, source: { assetId: "amb", title: asset.title, range: { start: 0, end: 10 } }, intents: SALES, idPrefix: "c" });
    expect(plan.current.verdict).toBe("NEEDS_REVIEW");
    const trim = plan.options.find((o) => o.kind === "TRIM")!;
    expect(trim.edl!.removed.map((r) => [r.start, r.end])).toEqual([[2.5, 4.5]]);
    expect(trim.recheck?.verdict).toBe("ALLOWED");
  });

  it("missing analysis: nothing can be localized, so no cut is proposed and review is required", () => {
    const asset = thfc("na");
    const ctx = { ...ctxOf([asset], []), analysis: { na: { status: "NOT_CONFIGURED", detail: "no key" } as AnalysisStatus } };
    const plan = planRecovery({ ctx, source: { assetId: "na", title: asset.title, range: { start: 0, end: 10 } }, intents: SALES, idPrefix: "c" });
    expect(plan.current.verdict).toBe("NEEDS_REVIEW");
    expect(plan.options.some((o) => o.kind === "TRIM")).toBe(false);
    expect(plan.problems.every((p) => p.pervasive)).toBe(true);
  });

  it("missing policy data: no applicable policy is a campaign problem with no executable fix", () => {
    const asset = thfc("np");
    const plan = planRecovery({
      ctx: ctxOf([asset], []),
      source: { assetId: "np", title: asset.title, range: { start: 0, end: 10 } },
      intents: [intent({ club: "arsenal" })],
      idPrefix: "c",
    });
    expect(plan.current.verdict).toBe("NEEDS_REVIEW");
    expect(plan.recommendedId).toBeUndefined();
    expect(plan.options.map((o) => o.kind)).toEqual(["REQUEST_CLEARANCE"]);
  });

  it("REPLACE: ranks a search-backed, re-checked replacement; blocked replacements are never recommended", () => {
    const fans = thfc("fans3");
    const clean = thfc("crowd", { people: [] });
    const rival = thfc("rival");
    const ctx = ctxOf([fans, clean, rival], [ev("fans3", "brand:manchester-united", 0, 30), ev("rival", "brand:manchester-united", 0, 30)]);
    const replacement = (asset: Asset, rank: number): ReplacementInput => {
      const segment = { scoreplayMediaId: asset.id, start: 1, end: 8.8 };
      return { key: `${asset.id}@1-8.8`, title: asset.title, segment, query: "fans", rank, evaluations: evaluateUses(ctx, { id: asset.id, title: asset.title, segments: [segment], derived: true }, SALES) };
    };
    // Crowd shot needs the "no players" rubric to be cleared for sales posts.
    ctx.observations.crowd = [{ scoreplayMediaId: "crowd", observation: "Rubric player_focus: no_players", source: "TWELVELABS", label: "rubric:player_focus:no_players" }];
    const plan = planRecovery({
      ctx,
      source: { assetId: "fans3", title: fans.title, range: { start: 6.87, end: 14.67 } },
      intents: SALES,
      replacements: [replacement(rival, 1), replacement(clean, 2)],
      idPrefix: "c",
    });
    const reps = plan.options.filter((o) => o.kind === "REPLACE");
    expect(reps.map((o) => [o.replacement!.scoreplayMediaId, o.outcome])).toEqual([
      ["crowd", "RESOLVES_DEMO"],
      ["rival", "STILL_BLOCKED"],
    ]);
    expect(plan.recommendedId).toBe(reps[0].id);
  });

  it("no valid alternative: every option fails → no recommendation, clearance request", () => {
    const fans = thfc("fans4");
    const rival = thfc("rival2");
    const ctx = ctxOf([fans, rival], [ev("fans4", "brand:manchester-united", 0, 30), ev("rival2", "brand:manchester-united", 0, 30)]);
    const segment = { scoreplayMediaId: "rival2", start: 0, end: 7.8 };
    const plan = planRecovery({
      ctx,
      source: { assetId: "fans4", title: fans.title, range: { start: 6.87, end: 14.67 } },
      intents: SALES,
      replacements: [{ key: "r", title: rival.title, segment, query: "fans", rank: 1, evaluations: evaluateUses(ctx, { id: "r", title: "r", segments: [segment], derived: true }, SALES) }],
      idPrefix: "c",
      limits: { minPostSec: 3 },
    });
    // The organic post still works but changes the goal: it is offered, never recommended.
    expect(plan.options.find((o) => o.kind === "CHANGE_USAGE")).toMatchObject({ changesGoal: true, outcome: "RESOLVES_DEMO" });
    expect(plan.recommendedId).toBeUndefined();
    expect(plan.noPathMessage).toMatch(/clearance request/);
  });

  it("flagship: promoting partner AIA, the DHL boards are cut (★ TRIM 0:14.5–0:17.5) and the re-check clears every use", () => {
    const asset = thfc("solanke");
    const ctx = ctxOf([asset], [ev("solanke", "brand:aia", 10, 19, { observation: "AIA: on the shirt" }), ev("solanke", "brand:dhl", 15, 17, { observation: "DHL: on the boards" })]);
    const intents = SALES.map((i) => ({ ...i, usage: "SPONSORED" as const, targetSponsor: "AIA" }));
    const plan = planRecovery({ ctx, source: { assetId: "solanke", title: asset.title, range: { start: 9.07, end: 19.73 } }, intents, idPrefix: "c" });
    expect(plan.current).toMatchObject({ verdict: "BLOCKED", allowedUses: 0, restrictedUses: 3, unresolvedUses: 0 });
    expect(plan.problems.map((p) => p.ruleIds)).toEqual([["THFC-13-partner-exclusivity"]]);
    expect(plan.headline).toMatch(/DHL/);
    expect(plan.headline).not.toMatch(/AIA/);
    const best = plan.options.find((o) => o.id === plan.recommendedId)!;
    expect(best).toMatchObject({ kind: "TRIM", title: "Remove 0:14.5–0:17.5", outcome: "RESOLVES_DEMO" });
    expect(best.recheck).toMatchObject({ verdict: "ALLOWED", allowedUses: 3, restrictedUses: 0, unresolvedUses: 0, totalUses: 3 });
  });

  it("a replacement whose re-check needs review (people named only by AI) is a candidate, never the recommendation", () => {
    const source = thfc("src16");
    const keyHighlights = thfc("kh", { people: ["Dominic Solanke-Mitchell"] }, 200);
    const named = ["pedro-porro", "giovani-lo-celso", "angelo-stiller", "ange-postecoglou"];
    const ctx = ctxOf([source, keyHighlights], [ev("src16", "brand:kraken", 0, 30), ...named.map((p) => ev("kh", `person:${p}`, 115, 118))]);
    const intents = SALES.map((i) => ({ ...i, usage: "SPONSORED" as const }));
    const segment = { scoreplayMediaId: "kh", start: 114.7, end: 120.1 };
    const plan = planRecovery({
      ctx,
      source: { assetId: "src16", title: source.title, range: { start: 14.8, end: 20.2 } },
      intents,
      replacements: [{ key: "kh", title: keyHighlights.title, segment, query: "celebration", rank: 1, evaluations: evaluateUses(ctx, { id: "kh", title: "kh", segments: [segment], derived: true }, intents) }],
      idPrefix: "c",
    });
    const rep = plan.options.find((o) => o.kind === "REPLACE")!;
    expect(rep.outcome).toBe("NEEDS_REVIEW");
    expect(rep.recheck).toMatchObject({ verdict: "NEEDS_REVIEW", allowedUses: 0, restrictedUses: 0, unresolvedUses: 3, totalUses: 3 });
    // Unverified identifications, not a rights verdict on the people.
    expect(rep.recheck!.remaining).toHaveLength(4);
    expect(rep.recheck!.remaining.every((r) => isUnverifiedPerson(r) && r.outcome === "MISSING" && /^AI named/.test(r.explanation))).toBe(true);
    expect(plan.recommendedId).toBeUndefined();
    expect(plan.noPathMessage).toMatch(/^No verified correction: .*One candidate still needs a reviewer — not a fix\./);
    // Ranked: what clears every use (here only by changing the goal) before what still needs a reviewer.
    expect(plan.options.map((o) => o.outcome)).toEqual(["RESOLVES_DEMO", "NEEDS_REVIEW", "NOT_VIABLE", "NEXT_STEP"]);
  });

  it("recommended is only ever an option that clears every use and keeps the goal", () => {
    const asset = thfc("any");
    const ctx = ctxOf([asset], [ev("any", "brand:dhl", 4, 6), ev("any", "person:unknown-player", 12, 14)]);
    const plan = planRecovery({ ctx, source: { assetId: "any", title: asset.title, range: { start: 2, end: 16 } }, intents: SALES, idPrefix: "c" });
    for (const o of plan.options) if (o.outcome !== "RESOLVES_DEMO" || o.changesGoal) expect(o.id).not.toBe(plan.recommendedId);
    for (const o of plan.options) if (o.recheck) expect(o.recheck.allowedUses + o.recheck.restrictedUses + o.recheck.unresolvedUses).toBe(o.recheck.totalUses);
  });

  it("a demo-policy ALLOWED re-check can never authorize publication, even after approval", () => {
    const asset = thfc("pub");
    const ctx = ctxOf([asset], [ev("pub", "brand:dhl", 15, 17)]);
    const plan = planRecovery({ ctx, source: { assetId: "pub", title: asset.title, range: { start: 10, end: 19 } }, intents: SALES, idPrefix: "c" });
    const trim = plan.options.find((o) => o.kind === "TRIM")!;
    const decision = evaluateUses(ctx, trim.edit!, SALES)[0].decision.decision;
    expect(decision).toMatchObject({ verdict: "ALLOWED", clearance: "DEMO", policyFictional: true });
    expect(canPublish({ decision, humanReviewStatus: "APPROVED" })).toBe(false);
  });
});
