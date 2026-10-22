import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CLEARANCE_LABEL, type Asset, type Blocker, type Candidate, type Decision, type EditPlan, type MediaRef, type PublishIntent, type Verdict } from "@/lib/contracts";
import type { Repositories } from "@/lib/server/repositories";
import { resetRepositoriesForTests, useMemoryRepositoriesForTests } from "@/lib/server/repositories/testing";
import { recordReview } from "@/lib/server/store";
import { buildGoalCampaign } from "../goal-campaign";
import { GLOBAL_TERRITORIES, goalIntents, goalPlan, parseMatch } from "../goal-intents";
import { rankMoments, type LinkedVideo, type RawMoment } from "../moment-ranking";
import { parseObjective } from "../objective-parser";
import * as goals from "../server/goal-service";
import type { GoalDeps } from "../server/goal-service";
import type { GoalSearch } from "../server/goal-search";
import { GoalViewSchema, type GoalIntent, type GoalRun } from "../types";

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

/** decideCampaign fake: the verdict depends on the asset only (what a CLIP blocker looks like). */
function campaignDecider(byAsset: Record<string, Verdict>, opts: { fictional?: boolean } = {}): GoalDeps["decideCampaign"] {
  return vi.fn(async ({ edit, intents }: { edit: EditPlan; intents: PublishIntent[] }) => {
    const v = byAsset[edit.segments[0].scoreplayMediaId] ?? "NEEDS_REVIEW";
    const perIntent = intents.map((intent) => {
      const d = decision(v, opts);
      return { intent, decision: { edit, decision: d, segments: [{ segment: edit.segments[0], decision: d }] } };
    });
    const overall = { ...decision(worst(perIntent.map((p) => p.decision.decision.verdict)), opts) };
    return { overall, perIntent };
  });
}

function candidate(id: string, start: number, end: number, verdict: Verdict, base: EditPlan): Candidate {
  const segment = { scoreplayMediaId: id, start, end, label: "q" };
  const proposedEdit: EditPlan = { ...base, id: `${base.id}~${id}`, segments: [segment], derived: true, derivedFrom: base.id };
  const d = decision(verdict);
  return {
    hit: { scoreplayMediaId: id, twelvelabsVideoId: `tl-${id}`, start, end, rank: 1, origin: "LIVE", mapping: "FILENAME_DURATION" },
    proposedEdit,
    segmentDecision: d,
    editDecision: { edit: proposedEdit, decision: d, segments: [{ segment, decision: d }] },
    eligible: verdict === "ALLOWED",
  };
}

const CLIP: Blocker = { scope: "CLIP", dimensions: ["people"], ruleIds: ["r-x"], explanation: "A person on screen is restricted", suggestion: "Use footage without this person" };
const CAMPAIGN: Blocker = { scope: "CAMPAIGN", dimensions: ["territory"], ruleIds: ["r-t"], explanation: "Not licensed in NG", suggestion: "Licensed territories: GB, US, FR, ES, DE, IN" };

function deps(over: Partial<GoalDeps> = {}): GoalDeps {
  return {
    search: vi.fn(async ({ objective }) => searchFor(objective.raw)),
    decideCampaign: campaignDecider({}),
    resolve: vi.fn(async (input) => ({ query: input.query ?? "q", blocker: CLIP, candidates: [candidate("907", 3, 8.4, "ALLOWED", input.edit)], best: undefined })),
    resolveMedia: vi.fn(async (id: string) => ref(id)),
    now: () => NOW,
    ...over,
  };
}

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
    const draft = buildGoalCampaign({ run, rec: kit, campaignId: "c", version: 1, origin: "PROPOSAL", now: NOW });
    expect(draft.creative.hook).toBe("Matchday detail.");
    expect(JSON.stringify(draft.channels)).not.toMatch(/Wear it like they do|like they do|Our fans/);
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
    alternatives: [],
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

  it("A and B produce different recommendations, copy and KPI", async () => {
    const d = deps();
    const a = await goals.runGoal(A, "tottenham", d);
    const b = await goals.runGoal(B, "tottenham", d);
    expect(a.recommendations.map((r) => r.key)).not.toEqual(b.recommendations.map((r) => r.key));
    expect(a.recommendations[0].headline).not.toBe(b.recommendations[0].headline);
    expect(a.recommendations[0].why.action).toMatch(/store/);
    expect(b.recommendations[0].why.action).toMatch(/comments and shares/);
    expect(a.campaign!.channels[0].copy).not.toBe(b.campaign!.channels[0].copy);
    expect(a.kpi.label).toMatch(/Merchandise sales/);
    expect(b.kpi.label).toMatch(/Engagement/);
    expect(a.kpi.value).toBeNull();
  });
});

// ---------- The service flow ----------

describe("goal → campaign → rights → alternative → review", () => {
  it("runs the search for the objective and builds a versioned proposal before any user action", async () => {
    const d = deps();
    const v = await goals.runGoal(A, "tottenham", d);
    expect(d.search).toHaveBeenCalledWith(expect.objectContaining({ club: "tottenham", objective: expect.objectContaining({ raw: A }) }));
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

  it("rejects a goal naming another club than the selected one", async () => {
    await expect(goals.runGoal(A, "spurs", deps())).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts a club destination only on the club's domain, as a new version", async () => {
    const d = deps();
    const v = await goals.runGoal(A, "tottenham", d);
    await expect(goals.draftGoalCampaign(v.run.id, "https://evil.example/shop", d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const next = await goals.draftGoalCampaign(v.run.id, "https://shop.tottenhamhotspur.com/", d);
    expect(next.campaign).toMatchObject({ version: 2, campaignId: v.campaign!.campaignId, cta: { status: "READY" } });
  });

  it("checks every channel × territory and records each evaluation", async () => {
    const d = deps({ decideCampaign: campaignDecider({}) });
    const v = await goals.runGoal(B, "tottenham", d);
    const checked = await goals.checkGoalRights(v.run.id, d);
    const call = vi.mocked(d.decideCampaign).mock.calls[0][0];
    expect(call.intents).toHaveLength(3 * GLOBAL_TERRITORIES.length);
    expect(new Set(call.intents.map((i) => `${i.platform}/${i.territory}`)).size).toBe(21);
    expect(call.edit.segments[0]).toMatchObject({ scoreplayMediaId: "904", start: 30, end: 37 });
    expect(checked.rights).toMatchObject({ state: "NEEDS_REVIEW", current: true, kind: "ORIGINAL" });
    expect(checked.rights.perIntent).toHaveLength(21);
    expect(checked.rights.perIntent[0].reasons[0]).toMatchObject({ basis: "LEGAL_ENTITLEMENT" });
    expect(await repos.evaluations.listForCampaign(v.campaign!.campaignId)).toHaveLength(21);
    expect((await repos.events.list("campaign", v.campaign!.campaignId)).map((e) => e.type)).toContain("RIGHTS_EVALUATED");
  });

  it("BLOCKED → resolver search → alternative swapped into a new version and re-checked independently", async () => {
    const decide = campaignDecider({ "901": "BLOCKED", "907": "ALLOWED" });
    const d = deps({ decideCampaign: decide });
    const v = await goals.runGoal(A, "tottenham", d);
    expect(v.campaign!.mediaRef.scoreplayMediaId).toBe("901");
    const blocked = await goals.checkGoalRights(v.run.id, d);
    expect(blocked.rights.state).toBe("BLOCKED");
    expect(blocked.canSubmit).toBe(false);
    await expect(goals.submitForReview(v.run.id, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const alt = await goals.findAlternatives(v.run.id, d);
    const resolveInput = vi.mocked(d.resolve).mock.calls[0][0];
    expect(resolveInput).toMatchObject({ segmentIndex: 0, intent: { platform: "instagram", territory: "GB", club: "tottenham" } });
    expect(resolveInput.query).toBe(blocked.selected!.matches[0].query);
    expect(alt.blocker).toEqual(CLIP);
    expect(alt.alternatives!.candidates).toHaveLength(1);

    const key = alt.alternatives!.candidates[0].key;
    const swapped = await goals.useAlternative(v.run.id, key, d);
    expect(d.resolveMedia).toHaveBeenCalledWith("907", "tottenham");
    expect(swapped.campaign).toMatchObject({ version: 2, origin: "ALTERNATIVE", key, mediaRef: { scoreplayMediaId: "907" } });
    expect(vi.mocked(decide).mock.calls).toHaveLength(2);
    expect(vi.mocked(decide).mock.calls[1][0].edit.segments[0]).toMatchObject({ scoreplayMediaId: "907", start: 3, end: 8.4 });
    expect(swapped.rights).toMatchObject({ state: "ALLOWED", kind: "ALTERNATIVE", campaignVersion: 2, clearanceLabel: DEMO_CLEARANCE_LABEL });
    // What the API returns satisfies the published GoalView contract (the browser client parses it).
    expect(GoalViewSchema.safeParse(JSON.parse(JSON.stringify(swapped))).success).toBe(true);
    expect(swapped.evaluations.map((e) => [e.kind, e.verdict])).toEqual([
      ["ORIGINAL", "BLOCKED"],
      ["ALTERNATIVE", "ALLOWED"],
    ]);
    const kinds = (await repos.evaluations.listForCampaign(v.campaign!.campaignId)).map((e) => e.kind);
    expect(kinds.filter((k) => k === "ALTERNATIVE")).toHaveLength(3);
  });

  it("a CAMPAIGN-scoped blocker offers no replacement clips and is never searched again", async () => {
    const d = deps({
      decideCampaign: campaignDecider({ "904": "BLOCKED" }),
      resolve: vi.fn(async (input) => ({ query: "q", blocker: CAMPAIGN, candidates: [candidate("907", 0, 7, "BLOCKED", input.edit)] })),
    });
    const v = await goals.runGoal(B, "tottenham", d);
    await goals.checkGoalRights(v.run.id, d);
    const first = await goals.findAlternatives(v.run.id, d);
    const again = await goals.findAlternatives(v.run.id, d);
    expect(d.resolve).toHaveBeenCalledTimes(1);
    expect(first.blocker).toMatchObject({ scope: "CAMPAIGN", suggestion: CAMPAIGN.suggestion });
    expect(first.alternatives!.candidates).toEqual([]);
    expect(again.alternatives!.id).toBe(first.alternatives!.id);
    await expect(goals.useAlternative(v.run.id, "907@0-7", d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("demo clearance can be reviewed but is never publishable; NEEDS_REVIEW can be submitted", async () => {
    const d = deps({ decideCampaign: campaignDecider({ "904": "ALLOWED" }) });
    const v = await goals.runGoal(B, "tottenham", d);
    const checked = await goals.checkGoalRights(v.run.id, d);
    expect(checked).toMatchObject({ canSubmit: true, publishable: false, rights: { clearance: "DEMO", clearanceLabel: DEMO_CLEARANCE_LABEL } });
    const submitted = await goals.submitForReview(v.run.id, d);
    expect(submitted).toMatchObject({ reviewStatus: "PENDING", canSubmit: false, publishable: false, writeback: { status: "NOT_STARTED" } });
    expect(submitted.receiptId).toBeTruthy();
    expect((await repos.campaigns.get(v.campaign!.campaignId)).receiptId).toBe(submitted.receiptId);

    await recordReview(submitted.receiptId!, { status: "APPROVED", reviewer: "Ana" }, () => {});
    const approved = (await goals.getGoal(v.run.id))!;
    expect(GoalViewSchema.safeParse(JSON.parse(JSON.stringify(approved))).success).toBe(true);
    expect(approved).toMatchObject({ reviewStatus: "APPROVED", publishable: false });
    expect(approved.publishNote).toContain(DEMO_CLEARANCE_LABEL);

    const review = deps({ decideCampaign: campaignDecider({ "901": "NEEDS_REVIEW" }) });
    const nr = await goals.runGoal(A, "tottenham", review);
    await goals.checkGoalRights(nr.run.id, review);
    expect((await goals.submitForReview(nr.run.id, review)).reviewStatus).toBe("PENDING");
  });

  it("verified clearance + human approval is the only publishable state", async () => {
    const d = deps({ decideCampaign: campaignDecider({ "901": "ALLOWED" }, { fictional: false }) });
    const v = await goals.runGoal(A, "tottenham", d);
    await goals.checkGoalRights(v.run.id, d);
    const submitted = await goals.submitForReview(v.run.id, d);
    expect(submitted.publishable).toBe(false);
    await recordReview(submitted.receiptId!, { status: "APPROVED", reviewer: "Ana" }, () => {});
    expect((await goals.getGoal(v.run.id))!.publishable).toBe(true);
  });

  it("a new version after submission needs a new check and submission", async () => {
    const d = deps({ decideCampaign: campaignDecider({ "901": "ALLOWED", "902": "ALLOWED" }) });
    const v = await goals.runGoal(A, "tottenham", d);
    await goals.checkGoalRights(v.run.id, d);
    await goals.submitForReview(v.run.id, d);
    const other = v.recommendations[1].key;
    const switched = await goals.selectMoment(v.run.id, other, d);
    expect(switched).toMatchObject({ reviewStatus: "NOT_SUBMITTED", canSubmit: false, rights: { state: "NOT_CHECKED" }, campaign: { version: 2, origin: "SELECTED" } });
    await expect(goals.submitForReview(v.run.id, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
