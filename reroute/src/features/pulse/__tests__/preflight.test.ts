import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, Decision, EditPlan, Evidence, MediaRef, PublishIntent, Reason, Verdict } from "@/lib/contracts";
import { BUNDLED_POLICIES } from "@/lib/rights";
import type { Repositories } from "@/lib/server/repositories";
import { resetRepositoriesForTests, useMemoryRepositoriesForTests } from "@/lib/server/repositories/testing";
import { goalIntents, parseMatch } from "../goal-intents";
import { rankMoments, type LinkedVideo, type RawMoment } from "../moment-ranking";
import { parseObjective } from "../objective-parser";
import * as goals from "../server/goal-service";
import type { GoalDeps } from "../server/goal-service";
import type { GoalSearch } from "../server/goal-search";
import { preflightOpportunity } from "../server/preflight";
import type { PolicyContext } from "../types";

const NOW = new Date("2026-10-22T12:00:00Z");
const SPONSOR = "Activate our sponsor with Solanke's late goal for UK fans";
const GLOBAL = "Maximize global engagement from the Manchester United game";

// ---------- A small linked library and Marengo-like hits for any question ----------

const ref = (id: string): MediaRef => ({
  scoreplayMediaId: id,
  twelvelabsIndexId: "idx",
  twelvelabsVideoId: `tl-${id}`,
  method: "FILENAME_DURATION",
  match: { scoreplayFilename: `MNU_TOT_${id}.mp4`, twelvelabsFilename: `MNU_TOT_${id}.mp4`, scoreplayDurationSec: 60, twelvelabsDurationSec: 60, durationDeltaSec: 0 },
  candidates: [],
  checkedAt: NOW.toISOString(),
});
const asset = (id: string): Asset => ({
  id,
  title: `MNU_TOT_${id}.mp4`,
  kind: "video",
  durationSec: 60,
  tags: ["Tottenham Hotspur", "Manchester United"],
  facts: { competition: "Premier League" },
  metadata: {},
  origin: "LIVE",
});
const LINKS = new Map<string, LinkedVideo>(["901", "902", "903"].map((id) => [`tl-${id}`, { asset: asset(id), discoveredBy: "TEAM_TAG", media: ref(id) }]));
const MOMENTS: RawMoment[] = [
  { videoId: "tl-901", start: 9, end: 20, rank: 1 },
  { videoId: "tl-902", start: 30, end: 37, rank: 2 },
  { videoId: "tl-903", start: 40, end: 45, rank: 3 },
];

function searchFor(goal: string): GoalSearch {
  const objective = parseObjective(goal, NOW);
  const intents = goalIntents(objective, "football");
  const pool = rankMoments(intents.map((intent) => ({ intent, moments: MOMENTS })), LINKS, { objective, match: parseMatch(goal) });
  return { intents, library: { videos: 3, indexed: 3, indexName: "premiere-league" }, attempts: [], pool, search: { status: "FOUND", message: "found" } };
}

// ---------- REROUTE fake: per-use reasons; overall = worst ----------

type Rule = (intent: PublishIntent, edit: EditPlan) => { verdict: Verdict; reasons: Reason[]; evidence?: Evidence[] };

const decision = (verdict: Verdict, reasons: Reason[], evidence: Evidence[] = []): Decision => ({
  verdict,
  reasons,
  missingFacts: [],
  evidence,
  policyVersion: "1",
  policyId: "demo-tottenham-pl",
  policyFictional: true,
  clearance: verdict === "ALLOWED" ? "DEMO" : "NONE",
  evaluatedAt: NOW.toISOString(),
});
const PERMIT: Reason = { ruleId: "r-ok", dimension: "territory", outcome: "PERMIT", explanation: "Licensed", basis: "LEGAL_ENTITLEMENT" };

function decider(rule: Rule): GoalDeps["decideCampaign"] {
  return vi.fn(async ({ edit, intents }: { edit: EditPlan; intents: PublishIntent[] }) => {
    const perIntent = intents.map((intent) => {
      const r = rule(intent, edit);
      const d = decision(r.verdict, r.reasons, r.evidence);
      return { intent, decision: { edit, decision: d, segments: [{ segment: edit.segments[0], decision: d }] } };
    });
    const vs = perIntent.map((p) => p.decision.decision.verdict);
    const worst: Verdict = vs.includes("BLOCKED") ? "BLOCKED" : vs.includes("NEEDS_REVIEW") ? "NEEDS_REVIEW" : "ALLOWED";
    const overall = decision(worst, perIntent.flatMap((p) => p.decision.decision.reasons));
    return { overall, perIntent, media: [ref(edit.segments[0].scoreplayMediaId)], notes: [] };
  });
}

const allowAll: Rule = () => ({ verdict: "ALLOWED", reasons: [PERMIT] });

/** A partner logo on the hoardings of asset 901 at 15–17 s, seen by TwelveLabs. */
const dhlOn901: Rule = (_intent, edit) => {
  const seg = edit.segments[0];
  if (seg.scoreplayMediaId !== "901") return allowAll(_intent, edit);
  const at = { scoreplayMediaId: "901", start: 15, end: 17 };
  return {
    verdict: "BLOCKED",
    reasons: [
      PERMIT,
      { ruleId: "THFC-13-partner-exclusivity", dimension: "sponsor", outcome: "DENY", explanation: "Competing partner branding cannot appear in sponsored posts.", basis: "LEGAL_ENTITLEMENT", ...at },
    ],
    evidence: [{ ...at, observation: "DHL logo on hoardings", source: "TWELVELABS", label: "brand:dhl", confidence: 0.92, origin: "CACHED" }],
  };
};

const LICENSED: Record<string, true> = { GB: true, US: true };
/** Only GB and US are licensed: the other markets of a global plan are refused by the licence term. */
const twoMarkets: Rule = (intent) =>
  LICENSED[intent.territory]
    ? { verdict: "ALLOWED", reasons: [PERMIT] }
    : { verdict: "BLOCKED", reasons: [{ ruleId: "policy-term", dimension: "territory", outcome: "DENY", explanation: `Not licensed: territory ${intent.territory}.`, basis: "LEGAL_ENTITLEMENT" }] };

const PACKAGES: Record<string, PolicyContext> = {
  "demo-tottenham-pl": { packageId: "demo-tottenham-pl", version: "1", title: "Tottenham Social — Demo", club: "tottenham", kind: "DEMO", sourceType: "PRESET", verified: false, label: "Demo policy — not verified legal clearance" },
  "demo-tottenham-commercial": { packageId: "demo-tottenham-commercial", version: "1", title: "Tottenham Commercial — Demo", club: "tottenham", kind: "DEMO", sourceType: "PRESET", verified: false, label: "Demo policy — not verified legal clearance" },
};

function deps(over: Partial<GoalDeps> = {}): GoalDeps {
  return {
    search: vi.fn(async ({ objective }) => searchFor(objective.raw)),
    decideCampaign: decider(allowAll),
    recover: vi.fn(),
    policies: vi.fn(async (_club, packageId) => ({ policies: [...BUNDLED_POLICIES], context: PACKAGES[packageId ?? "demo-tottenham-pl"] })),
    resolveMedia: vi.fn(async (id: string) => ref(id)),
    preview: vi.fn(async () => undefined),
    media: "DISABLED",
    now: () => NOW,
    ...over,
  };
}

let repos: Repositories;
beforeEach(() => {
  repos = useMemoryRepositoriesForTests();
});
afterEach(() => resetRepositoriesForTests());

describe("opportunity preflight (selection-time REROUTE check)", () => {
  it("a BLOCKED moment reports the timecoded brand restriction as a CLIP finding, under the card's basis", async () => {
    const d = deps({ decideCampaign: decider(dhlOn901) });
    const v = await goals.runGoal(SPONSOR, "tottenham", d);
    const rec = v.recommendations.find((r) => r.candidate.scoreplayAssetId === "901")!;

    const p = await preflightOpportunity({ id: v.run.id, key: rec.key }, d);

    expect(p).toMatchObject({ key: rec.key, basis: rec.preflightBasis, verdict: "BLOCKED", clearance: "NONE", illustrative: true, scope: "CLIP", edited: false, blockedTerritories: ["GB"] });
    expect(p.segments).toEqual([{ scoreplayMediaId: "901", start: 9, end: 20 }]);
    expect(p.allowedUses).toBe(0);
    expect(p.totalUses).toBe(v.run.plan.channels.length);
    // One finding across every channel: what TwelveLabs saw, where, and the rule applied.
    expect(p.findings).toHaveLength(1);
    expect(p.findings[0]).toMatchObject({
      topic: "Sponsors and brands on screen",
      outcome: "DENY",
      found: "DHL logo on hoardings (15–17 s)",
      at: { start: 15, end: 17 },
      ruleId: "THFC-13-partner-exclusivity",
      rule: "Competing partner branding cannot appear in sponsored posts.",
      territories: ["GB"],
    });
    expect(p.licenceGap).toBeUndefined();
    expect(p.policy?.packageId).toBe("demo-tottenham-pl");

    // Another card of the same goal is checked on its own footage.
    const other = v.recommendations.find((r) => r.candidate.scoreplayAssetId !== "901")!;
    expect(await preflightOpportunity({ id: v.run.id, key: other.key }, d)).toMatchObject({ verdict: "ALLOWED", clearance: "DEMO", findings: [], blockedTerritories: [] });
  });

  it("each unconfirmed person is backed by their own observation, not the first person seen in the window", async () => {
    const seen = (name: string, slug: string): Evidence => ({ scoreplayMediaId: "901", start: 10, end: 18, observation: `${name}: seen`, source: "TWELVELABS", label: `person:${slug}`, confidence: 0.9, origin: "CACHED" });
    const unconfirmed = (slug: string): Reason => ({ ruleId: `subject:person:${slug}`, dimension: "people", outcome: "MISSING", explanation: `Can't confirm ${slug}.`, basis: "LEGAL_ENTITLEMENT", scoreplayMediaId: "901", start: 10, end: 18 });
    const people: Rule = (intent, edit) =>
      edit.segments[0].scoreplayMediaId === "901"
        ? { verdict: "NEEDS_REVIEW", reasons: [unconfirmed("solanke"), unconfirmed("porro")], evidence: [seen("Solanke", "solanke"), seen("Porro", "Porro")] }
        : allowAll(intent, edit);
    const d = deps({ decideCampaign: decider(people) });
    const v = await goals.runGoal(SPONSOR, "tottenham", d);
    const rec = v.recommendations.find((r) => r.candidate.scoreplayAssetId === "901")!;

    const p = await preflightOpportunity({ id: v.run.id, key: rec.key }, d);

    expect(p).toMatchObject({ verdict: "NEEDS_REVIEW", scope: "CLIP" });
    expect(p.findings.map((f) => [f.ruleId, f.found, f.topic])).toEqual([
      ["subject:person:solanke", "Solanke: seen (10–18 s)", "People on screen"],
      ["subject:person:porro", "Porro: seen (10–18 s)", "People on screen"],
    ]);
  });

  it("a global plan with five unlicensed markets is a CAMPAIGN restriction naming them, not a licence gap", async () => {
    const d = deps({ decideCampaign: decider(twoMarkets) });
    const v = await goals.runGoal(GLOBAL, "tottenham", d);
    const rec = v.recommendations[0];

    const p = await preflightOpportunity({ id: v.run.id, key: rec.key }, d);

    expect(p.verdict).toBe("BLOCKED");
    expect(p.scope).toBe("CAMPAIGN");
    expect(p.blockedTerritories).toEqual(["FR", "ES", "DE", "IN", "NG"]);
    expect(p.licenceGap).toBeUndefined(); // GB and US are licensed: keep the licensed part
    expect(p.allowedUses).toBe(2 * v.run.plan.channels.length);
    expect(p.totalUses).toBe(7 * v.run.plan.channels.length);
    expect(p.plannedUses).toMatch(/^all \d+ planned uses/);
    expect(p.findings.every((f) => f.topic === "Territory" && f.outcome === "DENY" && !f.at)).toBe(true);
    expect(p.findings.flatMap((f) => f.territories).sort()).toEqual(["DE", "ES", "FR", "IN", "NG"]);
  });

  it("is read-only on the run: no version bump, no recorded evaluation", async () => {
    const d = deps({ decideCampaign: decider(dhlOn901) });
    const v = await goals.runGoal(SPONSOR, "tottenham", d);
    const before = await repos.goalRuns.getVersioned(v.run.id);

    for (const rec of v.recommendations) await preflightOpportunity({ id: v.run.id, key: rec.key }, d);

    const after = await repos.goalRuns.getVersioned(v.run.id);
    expect(after.version).toBe(before.version);
    expect(after.run.evaluations).toEqual([]);
    // The user's next action still succeeds against the version they saw.
    const checked = await goals.checkGoalRights({ id: v.run.id, expectedVersion: v.version }, d);
    expect(checked.rights.state).toBe("BLOCKED");
  });

  it("a rule-package switch changes every card's basis, and the preflight follows the new package", async () => {
    const d = deps();
    const v = await goals.runGoal(SPONSOR, "tottenham", d);
    const rec = v.recommendations[0];
    const old = await preflightOpportunity({ id: v.run.id, key: rec.key }, d);

    const switched = await goals.setRunPolicy({ id: v.run.id, expectedVersion: v.version }, "demo-tottenham-commercial", d);
    const now = switched.recommendations.find((r) => r.key === rec.key)!;

    expect(now.preflightBasis).not.toBe(rec.preflightBasis);
    const fresh = await preflightOpportunity({ id: v.run.id, key: rec.key }, d);
    expect(fresh.basis).toBe(now.preflightBasis);
    expect(fresh.basis).not.toBe(old.basis);
    expect(fresh.policy?.packageId).toBe("demo-tottenham-commercial");
    expect(vi.mocked(d.policies)).toHaveBeenLastCalledWith("tottenham", "demo-tottenham-commercial");
  });

  it("rejects a moment that is not one of the goal's results", async () => {
    const d = deps();
    const v = await goals.runGoal(SPONSOR, "tottenham", d);
    await expect(preflightOpportunity({ id: v.run.id, key: "999@0-5" }, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(d.decideCampaign).not.toHaveBeenCalled();
  });
});
