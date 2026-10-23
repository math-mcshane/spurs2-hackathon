import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CLEARANCE_LABEL, type Asset, type Decision, type EditPlan, type Evidence, type MediaRef, type PublishIntent, type Verdict } from "@/lib/contracts";
import type { Repositories } from "@/lib/server/repositories";
import { BUNDLED_POLICIES } from "@/lib/rights";
import { evaluateUses, planRecovery, type RecoveryEvalContext, type RecoveryPlan } from "@/lib/rights/recovery";
import { resetRepositoriesForTests, useMemoryRepositoriesForTests } from "@/lib/server/repositories/testing";
import { getReceipt, recordReview } from "@/lib/server/store";
import { buildGoalCampaign } from "../goal-campaign";
import { GLOBAL_TERRITORIES, goalIntents, goalPlan, parseMatch } from "../goal-intents";
import { rankMoments, type LinkedVideo, type RawMoment } from "../moment-ranking";
import { parseObjective } from "../objective-parser";
import * as goals from "../server/goal-service";
import type { GoalDeps } from "../server/goal-service";
import type { GoalSearch } from "../server/goal-search";
import { GoalViewSchema, type GoalIntent, type GoalRun, type PolicyContext } from "../types";

const NOW = new Date("2026-10-22T12:00:00Z");
const A = "Promote Tottenham merchandise to UK supporters";
const B = "Maximize global engagement from the Manchester United game";

// ---------- A Tottenham @ Manchester United library, linked by the canonical MediaResolver ----------

const ref = (id: string, method: MediaRef["method"] = "FILENAME_DURATION"): MediaRef => ({
  scoreplayMediaId: id,
  twelvelabsIndexId: "idx",
  twelvelabsVideoId: method === "AMBIGUOUS" || method === "UNMAPPED" ? undefined : `tl-${id}`,
  method,
  match: { scoreplayFilename: `MNU_TOT_${id}.mp4`, twelvelabsFilename: `MNU_TOT_${id}.mp4`, scoreplayDurationSec: 60, twelvelabsDurationSec: 60, durationDeltaSec: 0 },
  candidates: [],
  checkedAt: NOW.toISOString(),
});

const asset = (id: string, sec = 60): Asset => ({
  id,
  title: `MNU_TOT_${id}.mp4`,
  kind: "video",
  durationSec: sec,
  tags: ["Tottenham Hotspur", "Manchester United"],
  facts: { competition: "Premier League" },
  metadata: {},
  origin: "LIVE",
});

const LINKS = new Map<string, LinkedVideo>([
  ["tl-901", { asset: asset("901"), discoveredBy: "TEAM_TAG", media: ref("901") }],
  ["tl-902", { asset: asset("902"), discoveredBy: "TEAM_TAG", media: ref("902") }],
  ["tl-903", { asset: asset("903"), discoveredBy: "TEAM_TAG", media: ref("903") }],
  ["tl-904", { asset: asset("904"), discoveredBy: "TEAM_TAG", media: ref("904") }],
  ["tl-905", { asset: asset("905"), discoveredBy: "TEAM_TAG", media: ref("905") }], // re-upload of 904
  ["tl-906", { asset: asset("906"), discoveredBy: "TEAM_TAG", media: ref("906", "AMBIGUOUS") }],
]);

/** Marengo hits per question (rank order, real-looking timestamps). */
function hits(intent: GoalIntent): RawMoment[] {
  const at = (videoId: string, start: number, end: number, rank: number) => ({ videoId, start, end, rank });
  switch (intent.key) {
    case "kit":
      return [at("tl-903", 10, 16, 1), at("tl-906", 0, 5, 2)];
    case "fans-colours":
      return [at("tl-901", 0, 6.9, 1)];
    case "player-fan-bond":
      return [at("tl-901", 0.5, 6, 1)];
    case "celebration":
      return [at("tl-902", 14.8, 20.2, 1), at("tl-904", 30, 37, 2)];
    case "score":
      return [at("tl-904", 30, 37, 1), at("tl-905", 30, 37.4, 2), at("tl-902", 14, 20, 3)];
    case "near-miss":
      return [at("tl-902", 0, 9, 1)];
    case "save":
      return [at("tl-903", 40, 45, 1)];
    default:
      return [];
  }
}

function searchFor(goal: string): GoalSearch {
  const objective = parseObjective(goal, NOW);
  const intents = goalIntents(objective, "football");
  const pool = rankMoments(intents.map((intent) => ({ intent, moments: hits(intent) })), LINKS, { objective, match: parseMatch(goal) });
  return {
    intents,
    library: { videos: 6, indexed: 6, indexName: "premiere-league" },
    attempts: [],
    pool,
    search: { status: "FOUND", message: "found" },
    matchFilter: parseMatch(goal) ? { requested: parseMatch(goal)!, status: "APPLIED", videos: 6 } : undefined,
  };
}

// ---------- REROUTE fakes ----------

const decision = (verdict: Verdict, opts: { fictional?: boolean; dimension?: string } = {}): Decision => {
  const fictional = opts.fictional ?? true;
  return {
    verdict,
    reasons:
      verdict === "ALLOWED"
        ? [{ ruleId: "r-ok", dimension: "territory", outcome: "PERMIT", explanation: "Licensed", basis: "LEGAL_ENTITLEMENT" }]
        : [{ ruleId: "r-x", dimension: opts.dimension ?? "people", outcome: verdict === "BLOCKED" ? "DENY" : "MISSING", explanation: `Restricted ${opts.dimension ?? "people"}`, basis: "LEGAL_ENTITLEMENT" }],
    missingFacts: [],
    evidence: [],
    policyVersion: "1",
    policyId: fictional ? "demo-tottenham-pl" : "thfc-pl-2026",
    policyFictional: fictional,
    clearance: verdict === "ALLOWED" ? (fictional ? "DEMO" : "VERIFIED") : "NONE",
    evaluatedAt: NOW.toISOString(),
  };
};

const worst = (vs: Verdict[]): Verdict => (vs.includes("BLOCKED") ? "BLOCKED" : vs.includes("NEEDS_REVIEW") ? "NEEDS_REVIEW" : "ALLOWED");

/** The link REROUTE re-resolves at decision time (differs from search time on purpose, to prove which one is recorded). */
const decidedRef = (id: string) => ({ ...ref(id), checkedAt: "2026-10-22T12:30:00.000Z" });

/** decideCampaign fake: the verdict depends on the asset only (what a CLIP blocker looks like). */
function campaignDecider(byAsset: Record<string, Verdict>, opts: { fictional?: boolean } = {}): GoalDeps["decideCampaign"] {
  return vi.fn(async ({ edit, intents }: { edit: EditPlan; intents: PublishIntent[] }) => {
    const v = byAsset[edit.segments[0].scoreplayMediaId] ?? "NEEDS_REVIEW";
    const perIntent = intents.map((intent) => {
      const d = decision(v, opts);
      return { intent, decision: { edit, decision: d, segments: [{ segment: edit.segments[0], decision: d }] } };
    });
    const overall = { ...decision(worst(perIntent.map((p) => p.decision.decision.verdict)), opts) };
    return { overall, perIntent, media: [decidedRef(edit.segments[0].scoreplayMediaId)], notes: [] };
  });
}

// ---------- Recovery engine fakes: the REAL planner over fixture assets/observations ----------

const SQUAD = { "Dominic Solanke-Mitchell": ["Tottenham Hotspur FC"], "Micky van de Ven": ["Tottenham Hotspur FC"] };
/** A Tottenham asset as REROUTE's context loads it (ScorePlay facts the demo policy needs). */
const thfc = (id: string, facts: Partial<Asset["facts"]> = {}): Asset => ({
  ...asset(id),
  tags: ["partner content", "Premier League", "Tottenham Hotspur", "Manchester United"],
  facts: { competition: "Premier League", teams: ["Tottenham Hotspur", "Manchester United"], people: Object.keys(SQUAD), peopleTeams: SQUAD, ...facts },
});
const seen = (id: string, label: string, start: number, end: number): Evidence => ({
  scoreplayMediaId: id,
  start,
  end,
  observation: `${label.split(":").pop()}: seen`,
  source: "TWELVELABS",
  label,
  confidence: 0.9,
  origin: "CACHED",
});
/** A crowd shot without players: cleared for sales posts by the "no players" rubric. */
const CROWD_907: Evidence = { scoreplayMediaId: "907", observation: "Rubric player_focus: no_players", source: "TWELVELABS", label: "rubric:player_focus:no_players" };

type World = { evidence?: Evidence[]; replacements?: { id: string; start: number; end: number }[] };
const ASSETS = ["901", "902", "903", "904", "907"].map((id) => (id === "907" ? thfc(id, { people: [] }) : thfc(id)));

/** `recover` backed by the real `planRecovery` (no ScorePlay/TwelveLabs): every option is re-checked by the engine. */
function engineRecover(world: World = {}): GoalDeps["recover"] {
  return vi.fn(async (input: Parameters<GoalDeps["recover"]>[0]) => {
    const ctx: RecoveryEvalContext = {
      assets: Object.fromEntries(ASSETS.map((a) => [a.id, a])),
      observations: Object.fromEntries(ASSETS.map((a) => [a.id, (world.evidence ?? []).filter((e) => e.scoreplayMediaId === a.id)])),
      analysis: Object.fromEntries(ASSETS.map((a) => [a.id, { status: "AVAILABLE" as const }])),
      policies: input.policies,
      now: NOW,
    };
    const replacements = (world.replacements ?? []).map((r, i) => {
      const segment = { scoreplayMediaId: r.id, start: r.start, end: r.end, label: input.query };
      const title = ctx.assets[r.id].title;
      const alone: EditPlan = { id: `${input.idPrefix}:replace:${r.id}`, title, segments: [segment], derived: true };
      return { key: `${r.id}@${r.start}-${r.end}`, title, segment, query: input.query, rank: i + 1, evaluations: evaluateUses(ctx, alone, input.intents) };
    });
    const plan = planRecovery({ ctx, source: input.source, intents: input.intents, replacements, idPrefix: input.idPrefix });
    return { plan, media: [input.source.assetId, ...replacements.map((r) => r.segment.scoreplayMediaId)].map((id) => ref(id)), notes: [] };
  });
}

/** A fixed plan (for outcomes the fixtures don't produce on their own). */
const fixedRecover = (plan: RecoveryPlan): GoalDeps["recover"] => vi.fn(async () => ({ plan, media: [], notes: [] }));

const PACKAGES: Record<string, PolicyContext> = {
  "demo-tottenham-pl": { packageId: "demo-tottenham-pl", version: "1", title: "Tottenham Social Media Usage — Demo", club: "tottenham", kind: "DEMO", sourceType: "PRESET", verified: false, label: "Demo policy — not verified legal clearance" },
  "demo-tottenham-commercial": { packageId: "demo-tottenham-commercial", version: "1", title: "Tottenham Commercial — Demo", club: "tottenham", kind: "DEMO", sourceType: "PRESET", verified: false, label: "Demo policy — not verified legal clearance" },
};
/** Policy Center fake: the bundled policies under the requested package of the club (default: demo-tottenham-pl). */
const policiesFake: GoalDeps["policies"] = vi.fn(async (_club, packageId) => ({ policies: [...BUNDLED_POLICIES], context: PACKAGES[packageId ?? "demo-tottenham-pl"] ?? PACKAGES["demo-tottenham-pl"] }));

function deps(over: Partial<GoalDeps> = {}): GoalDeps {
  return {
    search: vi.fn(async ({ objective }) => searchFor(objective.raw)),
    decideCampaign: campaignDecider({}),
    recover: engineRecover(),
    policies: policiesFake,
    resolveMedia: vi.fn(async (id: string) => ref(id)),
    preview: vi.fn(async (r: MediaRef) => ({ source: "TWELVELABS_STREAM" as const, url: `https://cdn.example/${r.twelvelabsVideoId}.m3u8`, hls: true })),
    media: "ALLOWED",
    now: () => NOW,
    ...over,
  };
}

/** The run version the user last saw. */
const at = (v: { run: { id: string }; version: number }) => ({ id: v.run.id, expectedVersion: v.version });

let repos: Repositories;
beforeEach(() => {
  repos = useMemoryRepositoriesForTests();
});
afterEach(() => resetRepositoriesForTests());

// ---------- Objective → plan ----------

describe("objective → intent", () => {
  it("Scenario A: Tottenham merchandise to UK supporters is a commercial GB campaign on IG/FB/X", () => {
    const o = parseObjective(A, NOW);
    expect(o).toMatchObject({ club: "tottenham", scope: "MARKET", market: { code: "GB" }, product: { key: "merch" } });
    expect(goalPlan(o, "tottenham")).toMatchObject({
      club: "tottenham",
      territories: ["GB"],
      usage: "COMMERCIAL",
      channels: ["instagram", "facebook", "x"],
      competition: "Premier League",
    });
  });

  it("Scenario B: global engagement is editorial, evaluated per territory of the documented list, for the named match", () => {
    const o = parseObjective(B, NOW);
    expect(o).toMatchObject({ scope: "GLOBAL", product: { key: "engagement" } });
    expect(o.club).toBeUndefined();
    expect(parseMatch(B)).toBe("Manchester United");
    const plan = goalPlan(o, "tottenham");
    expect(plan).toMatchObject({ club: "tottenham", usage: "EDITORIAL", scope: "GLOBAL" });
    expect(plan.territories).toEqual([...GLOBAL_TERRITORIES]);
    expect(plan.territories).toEqual(["GB", "US", "FR", "ES", "DE", "IN", "NG"]);
  });

  it("intent labels, reasons and hooks never assert whose shirt, fans or player is on screen", () => {
    const merch = goalIntents(parseObjective(A, NOW), "football");
    for (const i of merch) expect(`${i.label} ${i.why}`).not.toMatch(/club shirt|our fans|Tottenham/i);
    const s = searchFor(A);
    const kit = s.pool.find((r) => r.matches[0].intent === "kit")!;
    const run = { ...runFixture(A), pool: s.pool };
    const draft = buildGoalCampaign({ run, rec: kit, campaignId: "c", version: 1, origin: "PROPOSAL", plan: run.plan, now: NOW });
    expect(draft.creative.hook).toBe("Matchday detail.");
    expect(JSON.stringify(draft.channels)).not.toMatch(/Wear it like they do|like they do|Our fans/);
  });

  it("bare “Spurs” is ambiguous: a Tottenham goal written with the nickname is accepted; only “San Antonio” means the NBA club", async () => {
    expect(parseObjective("Sell Spurs shirts in the UK", NOW).club).toBeUndefined();
    expect(parseObjective("Sell San Antonio Spurs jerseys in Mexico", NOW).club).toBe("spurs");
    const v = await goals.runGoal("Sell Spurs shirts in the UK", "tottenham", deps());
    expect(v.run.club).toBe("tottenham");
  });
});

function runFixture(goal: string): GoalRun {
  const objective = parseObjective(goal, NOW);
  return {
    id: "goal-test",
    schemaVersion: 2,
    club: "tottenham",
    submittedAt: NOW.toISOString(),
    resultsAt: NOW.toISOString(),
    objective,
    plan: goalPlan(objective, "tottenham"),
    intents: [],
    library: { videos: 0, indexed: 0 },
    search: { status: "FOUND", message: "" },
    attempts: [],
    pool: [],
    adopted: [],
    evaluations: [],
    recoveries: [],
    applied: [],
  };
}

// ---------- Search result → recommendations ----------

describe("search result → three real moments", () => {
  it("keeps Marengo's exact timestamps, links via MediaRef, drops unlinkable videos and folds re-uploads", () => {
    const pool = searchFor(B).pool;
    const top = pool[0];
    expect(top.candidate).toMatchObject({ scoreplayAssetId: "904", twelveLabsVideoId: "tl-904", startSeconds: 30, endSeconds: 37, foundBy: "TWELVELABS" });
    expect(top.media).toMatchObject({ scoreplayMediaId: "904", twelvelabsVideoId: "tl-904", method: "FILENAME_DURATION" });
    expect(top.duplicates).toEqual(["905@30-37.4"]);
    expect(pool.some((r) => r.candidate.scoreplayAssetId === "905")).toBe(false);
    expect(pool.some((r) => r.candidate.scoreplayAssetId === "906")).toBe(false); // AMBIGUOUS mapping
    for (const r of pool) expect(r.why.opportunity && r.why.media && r.why.action).toBeTruthy();
  });

  it("A and B produce different intents, top-3 ranking, angle/copy and KPI from the same library", async () => {
    const d = deps();
    const a = await goals.runGoal(A, "tottenham", d);
    const b = await goals.runGoal(B, "tottenham", d);
    // Different questions asked of the same index…
    expect(a.run.intents.map((i) => i.key)).toEqual(["kit", "fans-colours", "player-fan-bond", "celebration"]);
    expect(b.run.intents.map((i) => i.key)).toEqual(["score", "near-miss", "save", "celebration", "atmosphere"]);
    // …so a different top three, in a different order.
    expect(a.recommendations.map((r) => r.candidate.scoreplayAssetId)).toEqual(["901", "903", "902"]);
    expect(b.recommendations.map((r) => r.candidate.scoreplayAssetId)).toEqual(["904", "902", "903"]);
    expect(a.recommendations[0].headline).not.toBe(b.recommendations[0].headline);
    expect(a.recommendations[0].why.action).toMatch(/store/);
    expect(b.recommendations[0].why.action).toMatch(/comments and shares/);
    expect(a.campaign!.creative.angle).not.toBe(b.campaign!.creative.angle);
    expect(a.campaign!.channels[0].copy).not.toBe(b.campaign!.channels[0].copy);
    expect(a.campaign!.plan.usage).toBe("COMMERCIAL");
    expect(b.campaign!.plan.usage).toBe("EDITORIAL");
    // KPI: different label, never a value; honest one-line text while nothing is connected.
    expect(a.kpi).toMatchObject({ label: "Merchandise sales in United Kingdom", value: null, valueText: "Sales attribution not connected.", status: "NOT_CONNECTED" });
    expect(b.kpi).toMatchObject({ label: "Engagement (likes, comments, shares, saves) globally", value: null, valueText: "Engagement measurement not connected." });
    for (const v of [a, b]) {
      expect(JSON.stringify(v.kpi)).not.toMatch(/\d+\s*%|uplift|saved|hours/i);
      expect(v.timing.toProposalSec).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------- The service flow ----------

describe("goal → campaign → rights → alternative → review", () => {
  it("runs the search for the objective and builds a versioned proposal before any user action", async () => {
    const d = deps();
    const v = await goals.runGoal(A, "tottenham", d);
    expect(d.search).toHaveBeenCalledWith(expect.objectContaining({ club: "tottenham", objective: expect.objectContaining({ raw: A }) }));
    expect(v.run.id).toMatch(/^goal-[0-9a-f-]{36}$/);
    expect(v.version).toBe(2);
    expect(v.recommendations).toHaveLength(3);
    expect(v.campaign).toMatchObject({ version: 1, origin: "PROPOSAL", key: v.recommendations[0].key, mediaRef: { method: "FILENAME_DURATION" } });
    expect(v.campaign!.campaignId).toMatch(/^[0-9a-f-]{36}$/);
    expect(v.campaign!.intents).toHaveLength(3);
    expect(v.campaign!.intents.every((i) => i.club === "tottenham" && i.usage === "COMMERCIAL" && i.territory === "GB")).toBe(true);
    expect(v.campaign!.cta.status).toBe("NOT_CONFIGURED");
    expect(v.timing.toProposalSec).toBe(0);
    expect(v.rights.state).toBe("NOT_CHECKED");
    expect(v.reviewStatus).toBe("NOT_SUBMITTED");
    expect(await repos.campaigns.listVersions(v.campaign!.campaignId)).toHaveLength(1);
  });

  it("resolves previews per request and never stores them", async () => {
    const d = deps();
    const v = await goals.runGoal(A, "tottenham", d);
    expect(v.recommendations[0].preview).toMatchObject({ source: "TWELVELABS_STREAM", hls: true });
    const stored = await repos.goalRuns.get(v.run.id);
    expect(JSON.stringify(stored)).not.toContain("cdn.example");
    const off = await goals.getGoal(v.run.id, deps({ preview: vi.fn(async () => undefined) }));
    expect(off!.recommendations[0].preview).toBeUndefined();
    expect(off!.recommendations[0].previewNote).toMatch(/No browser-playable stream/);
  });

  it("unknown ids are null, not errors", async () => {
    expect(await goals.getGoal("goal-unknown", deps())).toBeNull();
  });

  it("rejects a goal naming another club than the selected one", async () => {
    await expect(goals.runGoal(A, "spurs", deps())).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects actions on a stale run version and never rolls the campaign back", async () => {
    const d = deps();
    const v = await goals.runGoal(A, "tottenham", d);
    const moved = await goals.selectMoment(at(v), v.recommendations[1].key, d);
    await expect(goals.selectMoment(at(v), v.recommendations[2].key, d)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(goals.checkGoalRights(at(v), d)).rejects.toMatchObject({ code: "CONFLICT" });
    const now = (await goals.getGoal(v.run.id, d))!;
    expect(now.campaign).toMatchObject({ version: 2, key: v.recommendations[1].key });
    expect(now.version).toBe(moved.version);
  });

  it("accepts a club destination only on the club's domain, as a new version", async () => {
    const d = deps();
    const v = await goals.runGoal(A, "tottenham", d);
    await expect(goals.draftGoalCampaign(at(v), "https://evil.example/shop", d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const next = await goals.draftGoalCampaign(at(v), "https://shop.tottenhamhotspur.com/", d);
    expect(next.campaign).toMatchObject({ version: 2, campaignId: v.campaign!.campaignId, cta: { status: "READY" } });
  });

  it("checks every channel × territory for a fresh publication slot and records the media the decision used", async () => {
    const d = deps({ decideCampaign: campaignDecider({}) });
    const v = await goals.runGoal(B, "tottenham", d);
    const later = new Date(NOW.getTime() + 3 * 86_400_000);
    const checked = await goals.checkGoalRights(at(v), { ...d, now: () => later });
    const call = vi.mocked(d.decideCampaign).mock.calls[0][0];
    expect(call.intents).toHaveLength(3 * GLOBAL_TERRITORIES.length);
    expect(new Set(call.intents.map((i) => `${i.platform}/${i.territory}`)).size).toBe(21);
    expect(call.intents.every((i) => Date.parse(i.publishAt) > later.getTime())).toBe(true);
    expect(call.edit.segments[0]).toMatchObject({ scoreplayMediaId: "904", start: 30, end: 37 });
    expect(checked.rights).toMatchObject({ state: "NEEDS_REVIEW", current: true, kind: "ORIGINAL" });
    expect(checked.rights.perIntent).toHaveLength(21);
    expect(checked.rights.perIntent[0].reasons[0]).toMatchObject({ basis: "LEGAL_ENTITLEMENT" });
    const recorded = await repos.evaluations.listForCampaign(v.campaign!.campaignId);
    expect(recorded).toHaveLength(21);
    expect(recorded[0].media).toEqual([decidedRef("904")]);
    expect((await repos.events.list("campaign", v.campaign!.campaignId)).map((e) => e.type)).toContain("RIGHTS_EVALUATED");
  });

  it("BLOCKED → Find a way to use it → REPLACE (engine re-checked, with title) applied as a new version and re-evaluated at once", async () => {
    const decide = campaignDecider({ "901": "BLOCKED", "907": "ALLOWED" });
    const recover = engineRecover({ evidence: [seen("901", "brand:manchester-united", 0, 30), CROWD_907], replacements: [{ id: "907", start: 3, end: 8.4 }] });
    const d = deps({ decideCampaign: decide, recover });
    let v = await goals.runGoal(A, "tottenham", d);
    expect(v.campaign!.mediaRef.scoreplayMediaId).toBe("901");
    v = await goals.checkGoalRights(at(v), d);
    expect(v.rights.state).toBe("BLOCKED");
    expect(v.canSubmit).toBe(false);
    expect(v.recovery).toBeUndefined();
    await expect(goals.submitForReview(at(v), d)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    v = await goals.findRecovery(at(v), d);
    const input = vi.mocked(d.recover).mock.calls[0][0];
    expect(input).toMatchObject({ source: { assetId: "901", range: { start: 0, end: 6.9 } }, query: v.selected!.matches[0].query, policies: BUNDLED_POLICIES });
    expect(input.intents).toHaveLength(3);
    expect(input.intents.every((i) => i.club === "tottenham" && i.territory === "GB")).toBe(true);
    expect(v.recovery).toMatchObject({ forEvaluationId: v.rights.evaluationId, scope: "CLIP" });
    const replace = v.recovery!.options.find((o) => o.kind === "REPLACE")!;
    expect(replace).toMatchObject({
      outcome: "RESOLVES_DEMO",
      applicable: true,
      recommended: true,
      replacement: { scoreplayMediaId: "907", title: "MNU_TOT_907.mp4", start: 3, end: 8.4 },
      recheck: { verdict: "ALLOWED", clearance: "DEMO", allowedUses: 3, totalUses: 3 },
    });
    expect(v.recovery!.recommendedId).toBe(replace.id);
    // The brand covers the whole selected moment: cutting it out leaves nothing, so no trim is workable.
    expect(v.recovery!.options.some((o) => o.kind === "TRIM" && o.applicable)).toBe(false);
    expect(GoalViewSchema.safeParse(JSON.parse(JSON.stringify(v))).success).toBe(true);
    // A second request for the same evaluation reuses the stored plan.
    expect((await goals.findRecovery(at(v), d)).recovery!.id).toBe(v.recovery!.id);
    expect(d.recover).toHaveBeenCalledTimes(1);

    const swapped = await goals.applyRecovery(at(v), replace.id, d);
    expect(d.resolveMedia).toHaveBeenCalledWith("907", "tottenham");
    expect(swapped.campaign).toMatchObject({ version: 2, origin: "ALTERNATIVE", key: replace.replacement!.key, mediaRef: { scoreplayMediaId: "907" } });
    expect(vi.mocked(decide).mock.calls).toHaveLength(2);
    expect(vi.mocked(decide).mock.calls[1][0].edit.segments[0]).toMatchObject({ scoreplayMediaId: "907", start: 3, end: 8.4 });
    expect(swapped.rights).toMatchObject({ state: "ALLOWED", kind: "ALTERNATIVE", current: true, campaignVersion: 2, clearanceLabel: DEMO_CLEARANCE_LABEL });
    expect(swapped.beforeAfter).toMatchObject({
      optionId: replace.id,
      kind: "REPLACE",
      before: { verdict: "BLOCKED", allowedUses: 0, totalUses: 3, title: "MNU_TOT_901.mp4" },
      after: { verdict: "ALLOWED", clearance: "DEMO", allowedUses: 3, totalUses: 3, title: "MNU_TOT_907.mp4" },
    });
    expect(swapped.canSubmit).toBe(true);
    // The plan belongs to the previous evaluation: neither shown nor applicable now.
    expect(swapped.recovery).toBeUndefined();
    await expect(goals.applyRecovery(at(swapped), replace.id, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(goals.findRecovery(at(swapped), d)).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/already allowed/) });
    // What the API returns satisfies the published GoalView contract (the browser client parses it).
    expect(GoalViewSchema.safeParse(JSON.parse(JSON.stringify(swapped))).success).toBe(true);
    expect(swapped.evaluations.map((e) => [e.kind, e.verdict])).toEqual([
      ["ORIGINAL", "BLOCKED"],
      ["ALTERNATIVE", "ALLOWED"],
    ]);
    const kinds = (await repos.evaluations.listForCampaign(v.campaign!.campaignId)).map((e) => e.kind);
    expect(kinds.filter((k) => k === "ALTERNATIVE")).toHaveLength(3);
    const types = (await repos.events.list("campaign", v.campaign!.campaignId)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["RECOVERY_PLANNED", "RECOVERY_RECHECKED", "RECOVERY_APPLIED"]));
  });

  it("TRIM: the cut is a new EDIT version (edit plan, not rendered) and REROUTE evaluates the derived edit of the retained segments", async () => {
    const decide: GoalDeps["decideCampaign"] = vi.fn(async ({ edit, intents }: { edit: EditPlan; intents: PublishIntent[] }) => {
      const d = decision(edit.derived ? "ALLOWED" : "BLOCKED", { dimension: "sponsor" });
      return { overall: d, perIntent: intents.map((intent) => ({ intent, decision: { edit, decision: d, segments: edit.segments.map((segment) => ({ segment, decision: d })) } })), media: [decidedRef("901")], notes: [] };
    });
    const d = deps({ decideCampaign: decide, recover: engineRecover({ evidence: [seen("901", "brand:dhl", 2, 3.5)] }) });
    let v = await goals.runGoal(A, "tottenham", d);
    v = await goals.checkGoalRights(at(v), d);
    v = await goals.findRecovery(at(v), d);
    const trim = v.recovery!.options.find((o) => o.kind === "TRIM")!;
    expect(trim).toMatchObject({ outcome: "RESOLVES_DEMO", applicable: true, changesGoal: false, timeline: { execution: "PLAN_NOT_RENDERED", sourceAssetId: "901" } });
    const retained = trim.timeline!.retained;
    expect(retained.length).toBeGreaterThan(1);
    expect(trim.timeline!.removed.some((r) => r.start <= 2 && r.end >= 3.5)).toBe(true);

    const cut = await goals.applyRecovery(at(v), trim.id, d);
    expect(cut.campaign).toMatchObject({ version: 2, origin: "EDIT", key: v.campaign!.key, mediaRef: { scoreplayMediaId: "901" }, edl: { retained, execution: "PLAN_NOT_RENDERED" } });
    expect(cut.edit).toMatchObject({ executionLabel: "Edit plan — not rendered", retained });
    const evaluated = vi.mocked(decide).mock.calls[1][0].edit;
    expect(evaluated.derived).toBe(true);
    expect(evaluated.segments.map((s) => ({ start: s.start, end: s.end }))).toEqual(retained);
    expect(evaluated.segments.every((s) => s.scoreplayMediaId === "901")).toBe(true);
    expect(cut.rights).toMatchObject({ state: "ALLOWED", kind: "ALTERNATIVE", campaignVersion: 2 });
    expect(cut.beforeAfter).toMatchObject({ kind: "TRIM", before: { verdict: "BLOCKED" }, after: { verdict: "ALLOWED" }, timeline: { retained } });
    expect(GoalViewSchema.safeParse(JSON.parse(JSON.stringify(cut))).success).toBe(true);
  });

  it("footage-derived URLs (previews, video and photo thumbnails) reach the goal view only when media access is ALLOWED", async () => {
    const MEDIA_URL = /https?:\/\/[^"\s]*(scoreplay|amazonaws|cloudfront|twelvelabs)/i;
    const withThumbs = (s: GoalSearch): GoalSearch => ({
      ...s,
      pool: s.pool.map((r) => ({ ...r, candidate: { ...r.candidate, thumbnailUrl: `https://cdn.scoreplay.io/thumbs/${r.candidate.scoreplayAssetId}.jpg` } })),
    });
    const media = (access: GoalDeps["media"]) =>
      deps({
        media: access,
        search: vi.fn(async ({ objective }) => withThumbs(searchFor(objective.raw))),
        decideCampaign: campaignDecider({ "901": "BLOCKED", "907": "ALLOWED" }),
        recover: engineRecover({ evidence: [seen("901", "brand:manchester-united", 0, 30), CROWD_907], replacements: [{ id: "907", start: 3, end: 8.4 }] }),
        preview: vi.fn(async (r: MediaRef) => ({ source: "TWELVELABS_STREAM" as const, url: `https://d1abc.cloudfront.net/${r.twelvelabsVideoId}.m3u8`, hls: true })),
        photos: vi.fn(async () => ({
          photos: [
            {
              scoreplayMediaId: "11",
              filename: "CK1_11.JPG",
              people: [],
              orientation: "PORTRAIT" as const,
              matchReason: "caption mentions a celebration",
              thumbnailUrl: "https://cdn.scoreplay.io/photos/11/thumb.jpg",
              rights: { verdict: "NEEDS_REVIEW" as const, clearance: "NONE" as const, allowedUses: 0, totalUses: 3, demoPolicy: true },
            },
          ],
          attempt: { service: "ScorePlay" as const, query: "club photos (metadata only)", outcome: "OK" as const, detail: "1 suggested" },
        })),
      });
    const allowed = media("ALLOWED");
    let v = await goals.runGoal(A, "tottenham", allowed);
    v = await goals.checkGoalRights(at(v), allowed);
    v = await goals.findRecovery(at(v), allowed);
    v = await goals.applyRecovery(at(v), v.recovery!.recommendedId!, allowed);

    const reviewer = JSON.stringify(await goals.getGoal(v.run.id, allowed));
    expect(reviewer).toMatch(MEDIA_URL);
    expect(reviewer).toContain("cloudfront.net/tl-907");
    expect(reviewer).toContain("cdn.scoreplay.io/thumbs");
    expect(reviewer).toContain("cdn.scoreplay.io/photos/11/thumb.jpg");

    for (const access of ["DISABLED", "REVIEWER_ONLY"] as const) {
      const d = media(access);
      const view = (await goals.getGoal(v.run.id, d))!;
      expect(GoalViewSchema.safeParse(view).success).toBe(true);
      expect(view.recommendations.length).toBeGreaterThan(1);
      expect(view.campaign).toMatchObject({ mediaRef: { scoreplayMediaId: "907" } });
      expect(JSON.stringify(view)).not.toMatch(MEDIA_URL);
      expect(view.photos[0]).toMatchObject({ scoreplayMediaId: "11" });
      expect(d.preview).not.toHaveBeenCalled();
      expect(view.recommendations[0].previewNote).toMatch(access === "DISABLED" ? /Video preview disabled until the organizers confirm playback rights/ : /signed-in reviewers only/);
    }
  });

  it("recovery options of an earlier moment are not offered after switching moments", async () => {
    const d = deps({
      decideCampaign: campaignDecider({ "901": "BLOCKED", "903": "BLOCKED" }),
      recover: engineRecover({ evidence: [seen("901", "brand:manchester-united", 0, 30), CROWD_907], replacements: [{ id: "907", start: 3, end: 8.4 }] }),
    });
    let v = await goals.runGoal(A, "tottenham", d);
    v = await goals.checkGoalRights(at(v), d);
    v = await goals.findRecovery(at(v), d);
    const id = v.recovery!.recommendedId!;
    v = await goals.selectMoment(at(v), v.recommendations.find((r) => r.candidate.scoreplayAssetId === "903")!.key, d);
    await expect(goals.applyRecovery(at(v), id, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    v = await goals.checkGoalRights(at(v), d);
    expect(v.recovery).toBeUndefined();
    await expect(goals.applyRecovery(at(v), id, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a CAMPAIGN restriction (unlicensed markets) offers ADAPT_CAMPAIGN, is planned once, and applying it limits the territories and re-checks ALLOWED", async () => {
    const d = deps({ decideCampaign: territoryDecider });
    let v = await goals.runGoal(B, "tottenham", d);
    v = await goals.checkGoalRights(at(v), d);
    expect(v.rights.state).toBe("NEEDS_REVIEW");
    expect(v.nextStep).not.toMatch(/No licence covers/);
    const first = await goals.findRecovery(at(v), d);
    const again = await goals.findRecovery(at(first), d);
    expect(d.recover).toHaveBeenCalledTimes(1);
    expect(again.recovery!.id).toBe(first.recovery!.id);
    expect(first.recovery!.options.some((o) => o.kind === "REPLACE" || o.kind === "TRIM")).toBe(false);
    const adapt = first.recovery!.options.find((o) => o.kind === "ADAPT_CAMPAIGN")!;
    expect(adapt).toMatchObject({ applicable: true, campaignChange: { territories: ["GB", "US"], dropped: ["FR", "ES", "DE", "IN", "NG"] } });
    expect(first.recovery!.recommendedId).toBe(adapt.id);

    const adapted = await goals.applyRecovery(at(again), adapt.id, d);
    expect(adapted.campaign).toMatchObject({ version: 2, origin: "REMEDY", plan: { territories: ["GB", "US"] } });
    expect(adapted.campaign!.intents).toHaveLength(6);
    expect(vi.mocked(d.decideCampaign).mock.calls.at(-1)![0].intents.map((i) => i.territory).sort()).toEqual(["GB", "GB", "GB", "US", "US", "US"]);
    expect(adapted.rights).toMatchObject({ state: "ALLOWED", kind: "ALTERNATIVE", current: true, campaignVersion: 2, clearance: "DEMO", clearanceLabel: DEMO_CLEARANCE_LABEL });
    expect(adapted.rights.perIntent).toHaveLength(6);
    expect(adapted.beforeAfter).toMatchObject({ kind: "ADAPT_CAMPAIGN", before: { verdict: "NEEDS_REVIEW", totalUses: 21 }, after: { verdict: "ALLOWED", allowedUses: 6, totalUses: 6 } });
    expect(adapted.canSubmit).toBe(true);
    expect(GoalViewSchema.safeParse(JSON.parse(JSON.stringify(adapted))).success).toBe(true);
  });

  it("NOT_VIABLE and NEXT_STEP options are shown but can never be applied", async () => {
    const recheck = { verdict: "BLOCKED" as const, clearance: "NONE" as const, allowedUses: 0, totalUses: 3, remaining: [], policyId: "demo-tottenham-pl", policyVersion: "1", evaluatedAt: NOW.toISOString() };
    const plan: RecoveryPlan = {
      scope: "CLIP",
      headline: "Restricted for every use",
      problems: [{ scope: "CLIP", pervasive: false, text: "Partner brand on screen", ruleIds: ["THFC-13-partner-exclusivity"], at: { start: 2, end: 3.5 }, evidence: [] }],
      current: recheck,
      licenceGap: false,
      options: [
        { id: "trim-1", kind: "TRIM", title: "Remove 0:01.5–0:06.0", summary: "Cut the brand", tradeoff: "Keeps 1.4 s of 6.9 s", changesGoal: false, outcome: "NOT_VIABLE", notViableBecause: "Leaves 1.4 s — shorter than a 3 s post." },
        { id: "request_clearance-2", kind: "REQUEST_CLEARANCE", title: "Request clearance", summary: "Ask the rights holder", tradeoff: "Takes time", changesGoal: false, outcome: "NEXT_STEP" },
      ],
      noPathMessage: "No change PULSE can make clears this use under the selected policy. The next step is a clearance request.",
    };
    const d = deps({ decideCampaign: campaignDecider({ "901": "BLOCKED" }), recover: fixedRecover(plan) });
    let v = await goals.runGoal(A, "tottenham", d);
    v = await goals.checkGoalRights(at(v), d);
    v = await goals.findRecovery(at(v), d);
    expect(v.recovery!.options.map((o) => [o.id, o.outcome, o.applicable, o.recommended])).toEqual([
      ["trim-1", "NOT_VIABLE", false, false],
      ["request_clearance-2", "NEXT_STEP", false, false],
    ]);
    expect(v.recovery!.recommendedId).toBeUndefined();
    expect(v.nextStep).toBe(plan.noPathMessage);
    await expect(goals.applyRecovery(at(v), "trim-1", d)).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Leaves 1.4 s — shorter than a 3 s post." });
    await expect(goals.applyRecovery(at(v), "request_clearance-2", d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(goals.applyRecovery(at(v), "no-such-option", d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await goals.getGoal(v.run.id, d))!.campaign).toMatchObject({ version: 1 });
  });

  it("switching the rule package makes the verdict stale: no recovery or submission until rights are checked again", async () => {
    const d = deps({ decideCampaign: campaignDecider({ "901": "NEEDS_REVIEW" }) });
    let v = await goals.runGoal(A, "tottenham", d);
    expect(v.policy).toMatchObject({ packageId: "demo-tottenham-pl" });
    v = await goals.checkGoalRights(at(v), d);
    expect(v).toMatchObject({ rights: { current: true }, canSubmit: true });
    await expect(goals.setRunPolicy(at(v), "no-such-package", d)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const switched = await goals.setRunPolicy(at(v), "demo-tottenham-commercial", d);
    expect(switched.policy).toMatchObject({ packageId: "demo-tottenham-commercial" });
    expect(switched).toMatchObject({ rights: { current: false }, canSubmit: false });
    expect(switched.nextStep).toBe("Check rights for every planned channel and country.");
    await expect(goals.findRecovery(at(switched), d)).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/rule package changed/) });
    await expect(goals.submitForReview(at(switched), d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const events = await repos.events.list("goal", v.run.id);
    expect(events.find((e) => e.type === "POLICY_CONTEXT_CHANGED")).toMatchObject({ payload: { from: "demo-tottenham-pl@1", to: "demo-tottenham-commercial@1" } });
    expect(vi.mocked(d.policies)).toHaveBeenCalledWith("tottenham", "demo-tottenham-commercial");

    const rechecked = await goals.checkGoalRights(at(switched), d);
    expect(rechecked).toMatchObject({ rights: { current: true }, canSubmit: true });
    const stored = await repos.goalRuns.get(v.run.id);
    expect(JSON.stringify(stored)).toContain("demo-tottenham-commercial");
    expect((await goals.submitForReview(at(rechecked), d)).reviewStatus).toBe("PENDING");
    expect(GoalViewSchema.safeParse(JSON.parse(JSON.stringify(rechecked))).success).toBe(true);
  });

  it("demo clearance can be reviewed but is never publishable; the receipt covers every use; NEEDS_REVIEW can be submitted", async () => {
    const d = deps({ decideCampaign: campaignDecider({ "904": "ALLOWED" }) });
    const v = await goals.runGoal(B, "tottenham", d);
    const checked = await goals.checkGoalRights(at(v), d);
    expect(checked).toMatchObject({ canSubmit: true, publishable: false, rights: { clearance: "DEMO", clearanceLabel: DEMO_CLEARANCE_LABEL } });
    const submitted = await goals.submitForReview(at(checked), d);
    expect(submitted).toMatchObject({ reviewStatus: "PENDING", canSubmit: false, publishable: false, writeback: { status: "NOT_STARTED" } });
    expect((await repos.campaigns.get(v.campaign!.campaignId)).receiptId).toBe(submitted.receiptId);
    const receipt = await getReceipt(submitted.receiptId!);
    expect(receipt.intents).toHaveLength(21);
    expect(receipt.media).toEqual([decidedRef("904")]);

    await recordReview(submitted.receiptId!, { status: "APPROVED", reviewer: "Ana" }, () => {});
    const approved = (await goals.getGoal(v.run.id, d))!;
    expect(GoalViewSchema.safeParse(JSON.parse(JSON.stringify(approved))).success).toBe(true);
    expect(approved).toMatchObject({ reviewStatus: "APPROVED", publishable: false });
    expect(approved.publishNote).toContain(DEMO_CLEARANCE_LABEL);

    const review = deps({ decideCampaign: campaignDecider({ "901": "NEEDS_REVIEW" }) });
    const nr = await goals.runGoal(A, "tottenham", review);
    const nrChecked = await goals.checkGoalRights(at(nr), review);
    expect((await goals.submitForReview(at(nrChecked), review)).reviewStatus).toBe("PENDING");
  });

  it("verified clearance + human approval is the only publishable state", async () => {
    const d = deps({ decideCampaign: campaignDecider({ "901": "ALLOWED" }, { fictional: false }) });
    const v = await goals.runGoal(A, "tottenham", d);
    const checked = await goals.checkGoalRights(at(v), d);
    const submitted = await goals.submitForReview(at(checked), d);
    expect(submitted.publishable).toBe(false);
    await recordReview(submitted.receiptId!, { status: "APPROVED", reviewer: "Ana" }, () => {});
    expect((await goals.getGoal(v.run.id, d))!.publishable).toBe(true);
  });

  it("a re-check after submission supersedes the submission: no approval or publishability carries over", async () => {
    const verdicts: Record<string, Verdict> = { "901": "ALLOWED" };
    const d = deps({ decideCampaign: campaignDecider(verdicts, { fictional: false }) });
    const v = await goals.runGoal(A, "tottenham", d);
    const checked = await goals.checkGoalRights(at(v), d);
    const submitted = await goals.submitForReview(at(checked), d);
    await recordReview(submitted.receiptId!, { status: "APPROVED", reviewer: "Ana" }, () => {});
    const approved = (await goals.getGoal(v.run.id, d))!;
    expect(approved.publishable).toBe(true);

    verdicts["901"] = "BLOCKED";
    const rechecked = await goals.checkGoalRights(at(approved), d);
    expect(rechecked).toMatchObject({ rights: { state: "BLOCKED" }, reviewStatus: "NOT_SUBMITTED", receiptId: undefined, publishable: false, canSubmit: false });

    verdicts["901"] = "ALLOWED";
    const again = await goals.checkGoalRights(at(rechecked), d);
    expect(again).toMatchObject({ reviewStatus: "NOT_SUBMITTED", canSubmit: true, publishable: false });
  });

  it("a new version after submission needs a new check and submission", async () => {
    const d = deps({ decideCampaign: campaignDecider({ "901": "ALLOWED", "902": "ALLOWED" }) });
    const v = await goals.runGoal(A, "tottenham", d);
    const checked = await goals.checkGoalRights(at(v), d);
    const submitted = await goals.submitForReview(at(checked), d);
    const switched = await goals.selectMoment(at(submitted), v.recommendations[1].key, d);
    expect(switched).toMatchObject({ reviewStatus: "NOT_SUBMITTED", canSubmit: false, rights: { state: "NOT_CHECKED" }, campaign: { version: 2, origin: "SELECTED" } });
    await expect(goals.submitForReview(at(switched), d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------- More goals: Mexico jerseys, tickets, sponsor activation ----------

const MX = "Sell more Spurs jerseys in Mexico";
const TICKETS = "Sell tickets for the next home game";
const SPONSOR = "Activate our sleeve sponsor with fans in the UK";

/** The demo Tottenham policy's licensed territories (THFC-3), decided per use like REROUTE does. */
const LICENSED = ["GB", "IE", "US", "CA", "AU", "NZ"];
const SELECTION = { policyId: "demo-tottenham-pl", kind: "DEMO" as const, considered: [] };
function territoryDecision(intent: PublishIntent): Decision {
  const ok = LICENSED.includes(intent.territory);
  return {
    ...decision(ok ? "ALLOWED" : "NEEDS_REVIEW"),
    reasons: [
      {
        ruleId: "THFC-3-licensed-territories",
        dimension: "territory",
        outcome: ok ? "PERMIT" : "MISSING",
        explanation: ok ? "Licensed territory" : `territory ${intent.territory} is not licensed (licensed: ${LICENSED.join(", ")})`,
        basis: "LEGAL_ENTITLEMENT",
      },
    ],
    policySelection: SELECTION,
  };
}
const territoryDecider: GoalDeps["decideCampaign"] = vi.fn(async ({ edit, intents }: { edit: EditPlan; intents: PublishIntent[] }) => {
  const perIntent = intents.map((intent) => {
    const d = territoryDecision(intent);
    return { intent, decision: { edit, decision: d, segments: [{ segment: edit.segments[0], decision: d }] } };
  });
  const overall = { ...territoryDecision(perIntent.find((p) => p.decision.decision.verdict !== "ALLOWED")?.intent ?? intents[0]), policySelection: SELECTION };
  return { overall, perIntent, media: [decidedRef(edit.segments[0].scoreplayMediaId)], notes: [] };
});

describe("more goals at plan level", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("Mexico: “Sell more Spurs jerseys in Mexico” with Tottenham selected → MX, jerseys, COMMERCIAL, Spanish (es-MX) copy", async () => {
    const o = parseObjective(MX, NOW);
    expect(o).toMatchObject({ scope: "MARKET", market: { code: "MX", label: "Mexico", matched: "mexico" }, product: { key: "jersey", matched: "jerseys" }, kpi: "Jersey sales in Mexico" });
    expect(o.club).toBeUndefined(); // bare "Spurs": the selected club decides
    const v = await goals.runGoal(MX, "tottenham", deps());
    expect(v.run.plan).toMatchObject({ club: "tottenham", territories: ["MX"], usage: "COMMERCIAL", channels: ["instagram", "facebook", "x"] });
    expect(v.campaign!.audience).toMatchObject({ market: { code: "MX" }, language: "es", locale: "es-MX", cohort: "Tottenham Hotspur supporters in Mexico" });
    expect(v.campaign!.creative.hookLanguage).toBe("es");
    expect(v.campaign!.channels[0].copy).toContain("Lleva los colores de Tottenham Hotspur.");
    expect(v.campaign!.cta).toMatchObject({ text: "Ver camisetas", status: "NOT_CONFIGURED" });
    expect(v.campaign!.checklist.find((c) => c.item === "Localized copy")).toMatchObject({ status: "DONE", note: "Written in es-MX." });
    expect(v.kpi).toMatchObject({ label: "Jersey sales in Mexico", value: null, valueText: "Sales attribution not connected." });

    vi.stubEnv("PULSE_COMMERCE_DESTINATIONS", "tottenham:jersey:MX=https://shop.tottenhamhotspur.com/es-mx/camisetas");
    const configured = await goals.runGoal(MX, "tottenham", deps());
    expect(configured.campaign!.cta).toMatchObject({ status: "READY", destination: { source: "CONFIGURED", url: "https://shop.tottenhamhotspur.com/es-mx/camisetas" } });
    expect(configured.campaign!.channels.find((c) => c.channel === "x")!.copy).toContain("Ver camisetas: https://shop.tottenhamhotspur.com/es-mx/camisetas");
  });

  it("Mexico not licensed: licence gap, no clip swaps and NO campaign change (never re-targeted to other countries) — request a licence", async () => {
    const d = deps({ decideCampaign: territoryDecider });
    let v = await goals.runGoal(MX, "tottenham", d);
    v = await goals.checkGoalRights(at(v), d);
    expect(v.rights).toMatchObject({ state: "NEEDS_REVIEW", current: true });
    expect(v.rights.perIntent.every((p) => p.territory === "MX" && p.verdict === "NEEDS_REVIEW")).toBe(true);
    const evaluation = (await repos.goalRuns.get(v.run.id))!.evaluations.at(-1)!;
    expect(evaluation.licenceGap).toEqual({ territories: ["MX"], platforms: [] });
    expect(evaluation.policy).toMatchObject({ packageId: "demo-tottenham-pl" });
    expect(v.nextStep).toMatch(/^No licence covers Mexico \(MX\) — request a licence before review\./);
    // A human reviewer cannot grant a missing licence: NEEDS_REVIEW, yet not submittable.
    expect(v.canSubmit).toBe(false);
    await expect(goals.submitForReview(at(v), d)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No licence covers Mexico (MX) — request a licence before review.",
    });

    v = await goals.findRecovery(at(v), d);
    const kinds = v.recovery!.options.map((o) => o.kind);
    expect(kinds).not.toContain("ADAPT_CAMPAIGN");
    expect(kinds).not.toContain("REPLACE");
    const clearance = v.recovery!.options.find((o) => o.kind === "REQUEST_CLEARANCE")!;
    expect(clearance).toMatchObject({ outcome: "NEXT_STEP", applicable: false });
    expect(v.recovery!.recommendedId).toBeUndefined();
    expect(v.recovery!.noPathMessage).toMatch(/MX/);
    expect(v.nextStep).toMatch(/^No licence covers Mexico \(MX\)/);
    await expect(goals.applyRecovery(at(v), clearance.id, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const stored = (await goals.getGoal(v.run.id, d))!;
    expect(stored.campaign).toMatchObject({ version: 1, plan: { territories: ["MX"] } });
    expect(GoalViewSchema.safeParse(JSON.parse(JSON.stringify(v))).success).toBe(true);
  });

  it("tickets: home territory, commercial, ticketing CTA only via a configured or club-domain link, sales KPI not connected", async () => {
    const o = parseObjective(TICKETS, NOW);
    expect(o).toMatchObject({ scope: "UNSPECIFIED", product: { key: "tickets" }, kpi: "Ticket sales" });
    expect(parseMatch(TICKETS)).toBeUndefined(); // "the next home game" is not a fixture name
    const d = deps();
    const v = await goals.runGoal(TICKETS, "tottenham", d);
    expect(v.run.plan).toMatchObject({ territories: ["GB"], usage: "COMMERCIAL" });
    expect(v.run.intents[0]).toMatchObject({ key: "atmosphere" });
    expect(v.campaign!.cta).toMatchObject({ text: "View ticket options", status: "NOT_CONFIGURED" });
    expect(v.campaign!.channels[0].copy).toContain("Be there next time.");
    expect(v.campaign!.channels[0].copy).not.toMatch(/View ticket options|on sale|available|\d{1,2}\s*(?:Oct|Nov|Dec)/i);
    expect(v.nextStep).toMatch(/ticketing link isn't set yet/);
    expect(v.kpi).toMatchObject({ label: "Ticket sales", value: null, valueText: "Sales attribution not connected." });
    await expect(goals.draftGoalCampaign(at(v), "https://tickets.example.com/spurs", d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const linked = await goals.draftGoalCampaign(at(v), "https://www.tottenhamhotspur.com/tickets/", d);
    expect(linked.campaign!.cta).toMatchObject({ status: "READY", destination: { kind: "ticketing", source: "PRODUCER_ENTERED" } });

    vi.stubEnv("PULSE_COMMERCE_DESTINATIONS", "tottenham:tickets:*=https://www.tottenhamhotspur.com/tickets/");
    const configured = await goals.runGoal(TICKETS, "tottenham", d);
    expect(configured.campaign!.cta).toMatchObject({ status: "READY", destination: { kind: "ticketing", source: "CONFIGURED" } });
    expect(configured.campaign!.channels.find((c) => c.channel === "facebook")!.copy).toContain("View ticket options: https://www.tottenhamhotspur.com/tickets/");
  });

  it("sponsor activation: SPONSORED use in GB, no sponsor ever named by PULSE, partner credit missing, tracking not connected", async () => {
    const o = parseObjective(SPONSOR, NOW);
    expect(o).toMatchObject({ market: { code: "GB" }, product: { key: "sponsor" } });
    const v = await goals.runGoal(SPONSOR, "tottenham", deps());
    expect(v.run.plan).toMatchObject({ territories: ["GB"], usage: "SPONSORED" });
    expect(v.campaign!.intents.every((i) => i.usage === "SPONSORED")).toBe(true);
    expect(v.campaign!.cta.status).toBe("NOT_APPLICABLE");
    const copy = v.campaign!.channels.map((c) => c.copy).join("\n");
    expect(copy).toContain("[Partner credit exactly as specified in the brief]");
    expect(copy).not.toMatch(/AIA|Nike|cinch|sleeve/i);
    expect(v.campaign!.checklist.find((c) => c.item === "Partner credit")).toMatchObject({ status: "MISSING" });
    expect(v.kpi).toMatchObject({ label: "Sponsor deliverables in United Kingdom", value: null, valueText: "Sponsor delivery tracking not connected.", status: "NOT_CONNECTED" });
    expect(v.kpi.note).not.toMatch(/ledger/);
  });
});
