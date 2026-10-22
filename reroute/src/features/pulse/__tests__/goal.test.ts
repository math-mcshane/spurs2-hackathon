import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Asset, EditDecision, EditPlan, PublishIntent, Verdict } from "@/lib/contracts";
import { loadPolicy } from "@/lib/rights";
import type { ContextDeps } from "@/lib/server/context";
import { decideEdit } from "@/lib/server/decide";
import { describeUse, presentRights, sharedBlocker } from "../goal-view";
import { goalIntents, parseMatch } from "../goal-intents";
import { parseObjective } from "../objective-parser";
import { seasonOf } from "../moment-ranking";
import { searchGoal, type GoalSearchDeps } from "../server/goal-search";
import * as goals from "../server/goal-service";
import type { ScorePlayHttp } from "../server/scoreplay-discovery";
import type { AssetPage, TwelveLabsSdk } from "../server/twelvelabs-moments";
import type { GoalRightsCheck } from "../types";

const STATE = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  return mkdtempSync(`${tmpdir()}/pulse-goal-test-`);
});
vi.mock("@/lib/state-dir", () => ({ STATE_ROOT: STATE }));
afterAll(() => rmSync(STATE, { recursive: true, force: true }));

const NOW = new Date("2026-10-22T12:00:00Z");
const MERCH = "Promote Tottenham merchandise to UK fans using the best moments from the Manchester United match.";
const GLOBAL = "Maximize global engagement from the Manchester United match.";

// ---------- A Tottenham library: ScorePlay workspace + the TwelveLabs index (linked by filename + duration) ----------

const LIBRARY = [
  { id: 901, name: "Away End FT.mov", sec: 6.9 },
  { id: 902, name: "Goal Slo Mo 9x16.mp4", sec: 45 },
  { id: 903, name: "Full Match | 2026-27.mp4", sec: 6000 },
  { id: 904, name: "MNU_1_6_TOT_20_21_HIGHLIGHTS.mp4", sec: 159 },
  { id: 905, name: "MNU_1_6_TOT_20_21_HIGHLIGHTS_2.mp4", sec: 159 }, // re-upload of 904
  { id: 906, name: "Not indexed.mp4", sec: 30 },
];

const scoreplay = (status = 200): ScorePlayHttp => ({
  apiKey: "k",
  fetch: (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const json = url.pathname.endsWith("/tag/search")
      ? { tags: [{ ID: 10797072, name: "tottenham hotspur" }] }
      : { media: LIBRARY.map((v) => ({ ID: v.id, name: v.name, type: "video", media_duration: v.sec * 1e9 })), count: LIBRARY.length };
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch,
});

/** What the index returns per question (Marengo rank order). tl-999 is indexed but not in this workspace. */
function hits(query: string) {
  const at = (videoId: string, start: number, end: number, rank: number) => ({ videoId, start, end, rank });
  if (query.includes("shirt with the crest")) return [at("tl-903", 100, 106, 1)];
  if (query.includes("celebrating a goal")) return [at("tl-902", 14.8, 20.2, 1), at("tl-904", 130, 137, 2), at("tl-905", 130, 137, 3)];
  if (query.includes("away end")) return [at("tl-901", 0, 6.9, 1), at("tl-999", 0, 5, 2)];
  if (query.includes("applauding")) return [at("tl-901", 0.5, 6, 1)];
  if (query.includes("goal being scored")) return [at("tl-904", 130, 137, 1), at("tl-905", 130, 137, 2), at("tl-903", 4752, 4757, 3)];
  if (query.includes("crossbar")) return [at("tl-902", 0, 14.8, 1)];
  if (query.includes("making a save")) return [at("tl-903", 182, 187, 1)];
  if (query.includes("singing")) return [at("tl-901", 0, 6.9, 5)];
  return [];
}

let indexSeq = 0;
function library(opts: { previews?: boolean; search?: TwelveLabsSdk["search"]["create"] } = {}): GoalSearchDeps & { retrieve: Mock } {
  const entries = LIBRARY.filter((v) => v.id !== 906)
    .map((v) => ({ id: `tl-${v.id}`, status: "ready", systemMetadata: { filename: v.name, duration: v.sec }, user_metadata: { scoreplay_id: `other-${v.id}` } }))
    .concat({ id: "tl-999", status: "ready", systemMetadata: { filename: "elsewhere.mp4", duration: 5 }, user_metadata: { scoreplay_id: "x" } });
  const page: AssetPage = { data: entries, hasNextPage: () => false, getNextPage: async () => page };
  const retrieve = vi.fn(async (_index: string, videoId: string) =>
    videoId === "tl-901" ? { hls: { videoUrl: "https://cdn.example/901.m3u8", status: "COMPLETE" } } : {},
  );
  const sdk: TwelveLabsSdk = {
    indexes: {
      retrieve: async () => ({ indexName: "premiere-league", videoCount: entries.length, models: [{ modelName: "marengo3.0", modelOptions: ["visual", "audio"] }] }),
      indexedAssets: { list: async () => page },
      videos: { retrieve },
    },
    search: { create: opts.search ?? (async (req) => ({ data: hits(req.queryText) })), retrieve: async () => ({ data: [] }) },
  };
  const indexId = `idx-goal-${++indexSeq}`;
  return { scoreplay: scoreplay(), twelvelabs: () => ({ sdk, indexId }), previews: opts.previews ?? true, retrieve };
}

const search = (goal: string, deps = library()) => searchGoal({ club: "tottenham", objective: parseObjective(goal, NOW), match: parseMatch(goal) }, deps);

describe("goal → real candidates", () => {
  it("normalizes TwelveLabs hits into ScorePlay moments with exact timestamps; unmapped hits are dropped", async () => {
    const r = await search(MERCH);
    expect(r.search.status).toBe("FOUND");
    expect(r.library).toMatchObject({ videos: 6, indexed: 5, indexName: "premiere-league", latestSeason: "2026-27" });
    const away = r.pool.find((p) => p.candidate.scoreplayAssetId === "901")!;
    expect(away.candidate).toMatchObject({
      twelveLabsVideoId: "tl-901",
      startSeconds: 0,
      endSeconds: 6.9,
      foundBy: "TWELVELABS",
      origin: "LIVE",
      mapping: { via: "FILENAME_DURATION", indexedScoreplayId: "other-901", filename: "Away End FT.mov" },
    });
    // Overlapping hits from two questions are one moment, supported by both.
    expect(away.matches.map((m) => [m.intent, m.rank])).toEqual([
      ["fans-colours", 1],
      ["player-fan-bond", 1],
    ]);
    expect(r.pool.some((p) => p.candidate.twelveLabsVideoId === "tl-999")).toBe(false);
    expect(r.pool.every((p) => p.candidate.foundBy === "TWELVELABS")).toBe(true);
  });

  it("previews only through a returned stream; otherwise says why, and makes no stream calls when switched off", async () => {
    const r = await search(MERCH);
    expect(r.pool.find((p) => p.candidate.scoreplayAssetId === "901")!.preview).toEqual({ source: "TWELVELABS_STREAM", url: "https://cdn.example/901.m3u8", hls: true });
    const other = r.pool.find((p) => p.candidate.scoreplayAssetId === "902")!;
    expect(other.preview).toBeUndefined();
    expect(other.previewNote).toMatch(/Neither ScorePlay nor TwelveLabs returned a browser-playable stream.*open ScorePlay asset 902 at 0:15–0:20/);

    const off = library({ previews: false });
    const silent = await search(MERCH, off);
    expect(off.retrieve).not.toHaveBeenCalled();
    expect(silent.pool.every((p) => !p.preview && /switched off/.test(p.previewNote))).toBe(true);
  });

  it("reports an unreachable library or index instead of proposing anything", async () => {
    const down = await search(MERCH, { ...library(), scoreplay: scoreplay(401) });
    expect(down).toMatchObject({ pool: [], search: { status: "UNAVAILABLE", code: "UNAUTHORIZED" } });

    const failing = await search(MERCH, library({ search: async () => Promise.reject(Object.assign(new Error("x"), { statusCode: 429 })) }));
    expect(failing).toMatchObject({ pool: [], search: { status: "UNAVAILABLE", code: "RATE_LIMITED" } });
  });
});

describe("objective-dependent ranking", () => {
  it("asks different questions of the same library for different goals", () => {
    const merch = goalIntents(parseObjective(MERCH, NOW), "football").map((i) => i.key);
    const global = goalIntents(parseObjective(GLOBAL, NOW), "football").map((i) => i.key);
    expect(merch).toEqual(["kit", "celebration", "fans-colours", "player-fan-bond"]);
    expect(global).toEqual(["score", "celebration", "near-miss", "save", "atmosphere"]);
    expect(goalIntents(parseObjective(GLOBAL, NOW), "basketball")[0].query).toMatch(/dunk/);
  });

  it("ranks the same footage differently for merchandise in the UK and global engagement", async () => {
    const merch = await search(MERCH);
    const global = await search(GLOBAL);
    expect(merch.pool[0].candidate.scoreplayAssetId).toBe("901"); // fans in club colours
    expect(global.pool[0].candidate.scoreplayAssetId).toBe("902"); // goal / big chance
    expect(merch.pool.slice(0, 3).map((p) => p.candidate.scoreplayAssetId)).not.toEqual(global.pool.slice(0, 3).map((p) => p.candidate.scoreplayAssetId));
  });

  it("discounts earlier-season footage only when the goal names a match", async () => {
    const named = await search(GLOBAL);
    const archive = named.pool.find((p) => p.candidate.scoreplayAssetId === "904")!;
    expect(archive).toMatchObject({ season: "2020-21", breakdown: { contextFactor: 0.6 } });
    const unnamed = await search("Maximize global engagement");
    expect(unnamed.pool.find((p) => p.candidate.scoreplayAssetId === "904")!.breakdown.contextFactor).toBe(1);
    expect(unnamed.pool[0].candidate.scoreplayAssetId).toBe("904");
  });

  it("leads with distinct assets and treats a re-upload of the same file as the same asset", async () => {
    const r = await search(GLOBAL);
    const lead = r.pool.slice(0, 4).map((p) => p.candidate.scoreplayAssetId);
    expect(new Set(lead).size).toBe(4);
    expect(lead).not.toContain("905");
    expect(r.pool.map((p) => p.candidate.scoreplayAssetId)).toContain("905");
  });

  it("reads seasons and matches from what the user and the filenames say", () => {
    expect(seasonOf("9x16_MNU_0_3_TOT_PL_18_19_HIGHLIGHTS.mp4")).toBe("2018-19");
    expect(seasonOf("Manchester United vs Spurs | Full Match | 2026-27.mp4")).toBe("2026-27");
    expect(seasonOf("9x16_MNU_1_1_TOT_HIGHLIGHTS.mp4")).toBeUndefined();
    expect(parseMatch(MERCH)).toBe("Manchester United");
    expect(parseMatch("Sell shirts in France against Arsenal")).toBe("Arsenal");
    expect(parseMatch("Grow followers in France")).toBeUndefined();
  });
});

// ---------- Rights presentation ----------

const check = (over: Partial<GoalRightsCheck> = {}): GoalRightsCheck => ({
  key: "901@0-6.9",
  state: "NEEDS_REVIEW",
  checkedAt: NOW.toISOString(),
  scoreplayAssetId: "901",
  policyId: "demo-tottenham-pl",
  policyVersion: "1",
  policyFictional: true,
  reasons: [],
  missingFacts: [],
  edit: { id: "e", title: "t", derived: false, segments: [{ scoreplayMediaId: "901", start: 0, end: 6.9 }] },
  intent: { territory: "GB", platform: "instagram", usage: "ORGANIC", competition: "Premier League", publishAt: NOW.toISOString() },
  rerouteUrl: "/?asset=901",
  ...over,
});

describe("rights-state presentation", () => {
  it("renders REROUTE reasons as plain topics while keeping REROUTE's words", () => {
    const licence = "No rule in policy demo-spurs-fr-sponsored grants territory for this asset and intent";
    const r = presentRights(
      check({
        reasons: [
          ...["territory", "platform", "usage"].map((dimension) => ({ dimension, outcome: "MISSING" as const, explanation: licence })),
          { dimension: "sponsor", outcome: "MISSING", explanation: "Sponsors/branding in asset 901 are not recorded in ScorePlay metadata" },
          { dimension: "sponsor", outcome: "MISSING", explanation: "No video analysis for asset 901; on-screen sponsors cannot be confirmed." },
        ],
      }),
      check().intent,
    );
    expect(r).toMatchObject({ state: "NEEDS_REVIEW", cleared: false, headline: "Needs a rights review" });
    expect(r.issues).toEqual([
      { topic: "Licence terms", outcome: "MISSING", dimensions: ["territory", "platform", "usage"], explanations: [licence] },
      expect.objectContaining({ topic: "Sponsors and brands on screen", explanations: expect.arrayContaining([expect.stringContaining("not recorded in ScorePlay")]) }),
    ]);
    expect(describeUse(check().intent)).toBe("Organic Instagram post in United Kingdom (GB) · Premier League");
  });

  it("calls a moment cleared only for ALLOWED under a non-fictional policy", () => {
    expect(presentRights(undefined, check().intent)).toMatchObject({ state: "NOT_CHECKED", cleared: false });
    expect(presentRights(check({ state: "ALLOWED" }), check().intent)).toMatchObject({
      state: "ALLOWED",
      cleared: false,
      headline: "Allowed under a demo policy — not a real clearance",
    });
    expect(presentRights(check({ state: "ALLOWED", policyFictional: false }), check().intent)).toMatchObject({ cleared: true });
    const blocked = presentRights(check({ state: "BLOCKED", reasons: [{ dimension: "people", outcome: "DENY", explanation: "Interviews may not be sponsored" }] }), check().intent);
    expect(blocked).toMatchObject({ cleared: false, headline: "Blocked for this use" });
    expect(blocked.detail).toContain("people on screen");
  });

  it("names a blocker every checked moment shares, ignoring asset ids, and nothing otherwise", () => {
    const same = (id: string) =>
      check({ scoreplayAssetId: id, reasons: [{ dimension: "people", outcome: "MISSING", explanation: `No video analysis for asset ${id} (custom_id ${id})` }] });
    expect(sharedBlocker([same("130851438"), same("130851415")])).toMatch(/All 2 moments .* people on screen/);
    expect(sharedBlocker([same("130851438"), check({ reasons: [{ dimension: "sponsor", outcome: "MISSING", explanation: "x" }] })])).toBeUndefined();
    expect(sharedBlocker([same("130851438"), check({ state: "ALLOWED" })])).toBeUndefined();
  });
});

// ---------- Service: goal → campaign → REROUTE → another way ----------

type Ruling = { verdict: Verdict; fictional?: boolean };
function decider(rule: (assetId: string) => Ruling) {
  const calls: { edit: EditPlan; intent: PublishIntent }[] = [];
  const decide = async (edit: EditPlan, intent: PublishIntent): Promise<EditDecision> => {
    calls.push({ edit, intent });
    const id = edit.segments[0].scoreplayMediaId;
    const { verdict, fictional = true } = rule(id);
    return {
      edit,
      segments: [],
      decision: {
        verdict,
        reasons:
          verdict === "ALLOWED"
            ? [{ ruleId: "p", dimension: "territory", outcome: "PERMIT", explanation: "permitted" }]
            : [{ ruleId: "r", dimension: "sponsor", outcome: verdict === "BLOCKED" ? "DENY" : "MISSING", explanation: `Sponsors/branding in asset ${id} are not recorded` }],
        missingFacts: verdict === "NEEDS_REVIEW" ? [`Sponsors/branding in asset ${id}`] : [],
        evidence: [],
        policyId: fictional ? "demo-tottenham-pl" : "club-contract",
        policyVersion: "1",
        policyFictional: fictional,
        evaluatedAt: NOW.toISOString(),
      },
    };
  };
  return { decide, calls };
}

const deps = (decide: goals.GoalDeps["decide"]): goals.GoalDeps => ({ search: (input) => searchGoal(input, library()), decide, now: () => NOW });

describe("goal service", () => {
  beforeEach(() => {
    rmSync(path.join(STATE, ".data"), { recursive: true, force: true });
    delete process.env.PULSE_COMMERCE_DESTINATIONS;
  });

  it("submits a goal, keeps it as the latest run, and refuses goals with nothing to aim at", async () => {
    const { decide } = decider(() => ({ verdict: "NEEDS_REVIEW" }));
    expect(await goals.getGoal()).toBeNull();
    const view = await goals.runGoal(MERCH, "tottenham", deps(decide));
    expect(view.run.objective.summary).toBe("Sell merchandise in United Kingdom");
    expect(view.run.match).toBe("Manchester United");
    expect(view.recommendations).toHaveLength(3);
    expect(view.recommendations.every((r) => r.rights.state === "NOT_CHECKED")).toBe(true);
    expect(view.kpi).toEqual(expect.objectContaining({ label: "Merchandise sales in United Kingdom", value: null, status: "NOT_CONNECTED" }));
    expect((await goals.getGoal())?.run.id).toBe(view.run.id);
    await expect(goals.runGoal("do better", "tottenham", deps(decide))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("recovers from a review verdict without restarting: same goal, alternatives evaluated independently by REROUTE", async () => {
    const verdicts: Record<string, Ruling> = { "901": { verdict: "NEEDS_REVIEW" }, "902": { verdict: "BLOCKED" }, "903": { verdict: "ALLOWED" } };
    const { decide, calls } = decider((id) => verdicts[id] ?? { verdict: "NEEDS_REVIEW" });
    const d = deps(decide);
    const { run } = await goals.runGoal(MERCH, "tottenham", d);
    const first = (await goals.getGoal(run.id))!.recommendations[0];
    expect(first.candidate.scoreplayAssetId).toBe("901");

    const drafted = await goals.draftGoalCampaign(run.id, first.key, undefined, d);
    expect(drafted.campaign).toMatchObject({
      objective: { summary: "Sell merchandise in United Kingdom" },
      media: { scoreplayAssetId: "901", startSeconds: 0, endSeconds: 6.9 },
      rerouteIntent: { territory: "GB", platform: "instagram", usage: "ORGANIC", competition: "Premier League" },
      cta: { status: "NOT_CONFIGURED" },
      stage: "PROPOSED",
      rights: { state: "NOT_CHECKED" },
    });
    expect(drafted.campaign!.checklist.find((c) => c.item === "Destination URL")).toMatchObject({ status: "MISSING" });
    expect(drafted.campaign!.checklist.find((c) => c.item === "Product inventory")).toMatchObject({ status: "NOT_CONNECTED" });

    const reviewed = await goals.checkGoalRights(run.id, d);
    expect(reviewed.campaign).toMatchObject({ stage: "PROPOSED", rights: { state: "NEEDS_REVIEW", cleared: false } });

    const recovered = await goals.findAlternatives(run.id, d);
    const r = recovered.recovery!;
    expect(r.forKey).toBe(first.key);
    // The next-best moments on other assets, each sent to REROUTE once, with the same use.
    const altAssets = calls.slice(1).map((c) => c.edit.segments[0].scoreplayMediaId);
    expect(altAssets).toHaveLength(3);
    expect(altAssets).not.toContain("901");
    expect(calls.every((c) => c.intent.territory === "GB" && c.intent.usage === "ORGANIC")).toBe(true);
    expect(r.groups.BLOCKED.map((a) => a.candidate.scoreplayAssetId)).toEqual(["902"]);
    expect(r.groups.ALLOWED.map((a) => a.candidate.scoreplayAssetId)).toEqual(["903"]);
    expect(r.groups.ALLOWED[0].rights.cleared).toBe(false); // fictional policy
    expect(r.groups.NEEDS_REVIEW).toHaveLength(1);
    expect(r.groups.UNCHECKED.every((a) => a.rights.state === "NOT_CHECKED")).toBe(true);
    expect(recovered.run.objective.raw).toBe(MERCH);

    // "Use this instead": same goal, same draft, the alternative's recorded verdict applies to it.
    const alt = r.groups.ALLOWED[0];
    const switched = await goals.draftGoalCampaign(run.id, alt.key, undefined, d);
    expect(switched.campaign).toMatchObject({ id: drafted.campaign!.id, createdAt: drafted.campaign!.createdAt, media: { scoreplayAssetId: "903" }, stage: "PROPOSED" });
    expect(switched.campaign!.rights).toMatchObject({ state: "ALLOWED", cleared: false });
    expect(switched.recovery?.groups.ALLOWED[0].key).toBe(alt.key);

    // A fictional ALLOWED is never approvable; the fresh verdict is still recorded.
    await expect(goals.approveGoalCampaign(run.id, "Sam", d)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await goals.getGoal(run.id))!.campaign!.stage).toBe("PROPOSED");
    await expect(goals.findAlternatives(run.id, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Asking again never re-sends a moment REROUTE already evaluated.
    await goals.draftGoalCampaign(run.id, first.key, undefined, d);
    const before = calls.length;
    const again = await goals.findAlternatives(run.id, d);
    const resent = calls.slice(before).map((c) => `${c.edit.segments[0].scoreplayMediaId}@${c.edit.segments[0].start}`);
    expect(resent.some((k) => [first, ...r.groups.NEEDS_REVIEW, ...r.groups.BLOCKED, ...r.groups.ALLOWED].some((x) => x.key.startsWith(`${k}-`)))).toBe(false);
    expect(again.recovery!.groups.ALLOWED.map((a) => a.key)).toContain(alt.key);
  });

  it("moves proposed → rights cleared → ready for approval → approved only on a real ALLOWED", async () => {
    let ruling: Ruling = { verdict: "ALLOWED", fictional: false };
    const { decide } = decider(() => ruling);
    const d = deps(decide);
    const { run, recommendations } = await goals.runGoal(MERCH, "tottenham", d);
    await goals.draftGoalCampaign(run.id, recommendations[0].key, undefined, d);
    const cleared = await goals.checkGoalRights(run.id, d);
    expect(cleared.campaign).toMatchObject({ stage: "RIGHTS_CLEARED", rights: { cleared: true } });
    await expect(goals.approveGoalCampaign(run.id, "Sam", d)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const withUrl = await goals.draftGoalCampaign(run.id, recommendations[0].key, "https://shop.example.com/uk", d);
    expect(withUrl.campaign).toMatchObject({ stage: "READY_FOR_APPROVAL", cta: { status: "READY", destination: { source: "PRODUCER_ENTERED" } } });
    expect(withUrl.campaign!.channels.find((c) => c.channel === "x")!.copy).toContain("https://shop.example.com/uk");

    const approved = await goals.approveGoalCampaign(run.id, "Sam", d);
    expect(approved.campaign).toMatchObject({ stage: "APPROVED", approval: { by: "Sam" } });

    ruling = { verdict: "NEEDS_REVIEW" };
    await expect(goals.approveGoalCampaign(run.id, "Sam", d)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await goals.getGoal(run.id))!.campaign).toMatchObject({ stage: "PROPOSED", rights: { state: "NEEDS_REVIEW" } });
  });
});

// ---------- The complete PULSE → REROUTE handoff, decided by the real rights engine ----------

describe("PULSE → REROUTE handoff", () => {
  beforeEach(() => rmSync(path.join(STATE, ".data"), { recursive: true, force: true }));

  const asset = (id: string, facts: Asset["facts"], tags: string[]): Asset => ({ id, title: id, kind: "video", durationSec: 60, tags, facts, metadata: {}, origin: "LIVE" });
  const context: ContextDeps = {
    getAsset: async (id) =>
      id === "901"
        ? asset(id, { competition: "Premier League", people: ["A Player"], sponsors: ["Kit sponsor"] }, ["match"])
        : asset(id, { competition: "Premier League" }, []),
    video: () => ({
      search: async () => [],
      observations: async (id) => {
        if (id === "901") return [];
        throw new Error(`No TwelveLabs video in index has custom_id ${id}`);
      },
    }),
    humanObservations: async () => [],
  };
  const real = (edit: EditPlan, intent: PublishIntent) => decideEdit(edit, intent, { deps: context, policy: loadPolicy("demo-tottenham-pl"), now: NOW });

  it("sends the exact moment and use to REROUTE and shows its verdict without upgrading it", async () => {
    const d: goals.GoalDeps = { search: (input) => searchGoal(input, library()), decide: real, now: () => NOW };
    const { run, recommendations } = await goals.runGoal(MERCH, "tottenham", d);
    await goals.draftGoalCampaign(run.id, recommendations[0].key, undefined, d);
    const allowed = await goals.checkGoalRights(run.id, d);
    // REROUTE's fictional Tottenham policy permits organic GB match footage — still not a real clearance.
    expect(allowed.campaign!.rights).toMatchObject({ state: "ALLOWED", cleared: false, policyId: "demo-tottenham-pl", policyFictional: true });
    expect(allowed.campaign!.stage).toBe("PROPOSED");
    const link = new URLSearchParams(allowed.campaign!.rights.rerouteUrl!.split("?")[1]);
    expect(Object.fromEntries(["asset", "start", "end", "territory", "usage", "competition"].map((k) => [k, link.get(k)]))).toEqual({
      asset: "901",
      start: "0",
      end: "6.9",
      territory: "GB",
      usage: "ORGANIC",
      competition: "Premier League",
    });

    const second = recommendations.find((r) => r.candidate.scoreplayAssetId === "902")!;
    await goals.draftGoalCampaign(run.id, second.key, undefined, d);
    const review = await goals.checkGoalRights(run.id, d);
    expect(review.campaign!.rights.state).toBe("NEEDS_REVIEW");
    const said = review.campaign!.rights.issues.flatMap((i) => i.explanations);
    expect(said).toContainEqual(expect.stringContaining("No video analysis for asset 902"));
    expect(review.campaign!.rights.missingFacts).toContainEqual(expect.stringContaining("Video analysis (sponsors/people on screen) for asset 902"));
  });
});
