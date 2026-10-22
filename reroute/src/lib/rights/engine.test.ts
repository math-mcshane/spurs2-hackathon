import { describe, expect, it } from "vitest";
import {
  DecisionSchema,
  EditDecisionSchema,
  MANDATORY_DIMENSIONS,
  type Asset,
  type EditPlan,
  type Evidence,
  type PublishIntent,
} from "@/lib/contracts";
import demoSpurs from "./policies/demo-spurs-fr-sponsored.json";
import demoTottenham from "./policies/demo-tottenham-pl.json";
import { evaluateEdit, evaluateSegment, listPolicies, loadPolicy, PolicySchema, type Policy } from "./index";

const now = new Date("2026-10-22T12:00:00Z");
const spursPolicy = loadPolicy("demo-spurs-fr-sponsored");
const thfcPolicy = loadPolicy("demo-tottenham-pl");

function asset(id: string, facts: Asset["facts"], tags: string[] = []): Asset {
  return { id, title: id, kind: "video", durationSec: 15, tags, facts, metadata: {}, origin: "LIVE" };
}

const spursGame = asset("sp-game", {
  competition: "NBA",
  team: "San Antonio Spurs",
  people: ["Victor Wembanyama"],
  sponsors: [],
});
const spursAlt = asset("sp-alt", { competition: "NBA", team: "San Antonio Spurs", people: [], sponsors: [] });

const rivalBrand: Evidence = {
  scoreplayMediaId: "sp-game",
  start: 4,
  end: 9,
  observation: "Rival-sponsor courtside board visible",
  source: "HUMAN",
  label: "brand:rival-sponsor",
};

const organic: PublishIntent = {
  territory: "FR",
  platform: "instagram",
  usage: "ORGANIC",
  competition: "NBA",
  publishAt: "2026-11-01T18:00:00Z",
};
const sponsored: PublishIntent = { ...organic, usage: "SPONSORED" };

const demoEdit: EditPlan = {
  id: "edit-1",
  title: "15s Spurs edit",
  derived: false,
  segments: [
    { scoreplayMediaId: "sp-game", start: 0, end: 4 },
    { scoreplayMediaId: "sp-game", start: 4, end: 9 },
    { scoreplayMediaId: "sp-game", start: 9, end: 15 },
  ],
};

function decideEdit(edit: EditPlan, intent: PublishIntent, extra: Partial<{ assets: Record<string, Asset>; policy: Policy }> = {}) {
  const result = evaluateEdit({
    edit,
    assets: extra.assets ?? { "sp-game": spursGame, "sp-alt": spursAlt },
    observations: { "sp-game": [rivalBrand] },
    intent,
    policy: extra.policy ?? spursPolicy,
    now,
  });
  EditDecisionSchema.parse(result); // always honours the shared contract
  return result;
}

function decideSegment(a: Asset, intent: PublishIntent, observations: Evidence[] = [], policy = spursPolicy) {
  const decision = evaluateSegment({
    segment: { scoreplayMediaId: a.id, start: 0, end: 15 },
    asset: a,
    observations,
    intent,
    policy,
    now,
  });
  DecisionSchema.parse(decision);
  return decision;
}

describe("bundled policies", () => {
  it.each([demoSpurs, demoTottenham])("$id validates against PolicySchema and is labelled fictional", (raw) => {
    const policy = PolicySchema.parse(raw);
    expect(policy.fictional).toBe(true);
    expect(policy.disclaimer).toContain("FICTIONAL DEMO POLICY");
  });

  it("lists policies and loads the Spurs demo policy by default", () => {
    expect(listPolicies().map((p) => p.id).sort()).toEqual(["demo-spurs-fr-sponsored", "demo-tottenham-pl"]);
    expect(loadPolicy().id).toBe(process.env.REROUTE_POLICY_ID || "demo-spurs-fr-sponsored");
    expect(() => loadPolicy("nope")).toThrow(/Unknown rights policy/);
  });

  it("rejects a people/sponsor PERMIT that does not say whom it covers", () => {
    const bad = { ...demoSpurs, rules: [{ ...demoSpurs.rules[1], covers: undefined }] };
    expect(PolicySchema.safeParse(bad).success).toBe(false);
  });
});

describe("demo scenario", () => {
  it("ORGANIC / FR / instagram on the demo edit → ALLOWED with every dimension permitted", () => {
    const { decision, segments } = decideEdit(demoEdit, organic);
    expect(decision.verdict).toBe("ALLOWED");
    expect(decision.missingFacts).toEqual([]);
    expect(decision.policyFictional).toBe(true);
    expect(decision.policyId).toBe("demo-spurs-fr-sponsored");
    expect(decision.evaluatedAt).toBe(now.toISOString());
    for (const s of segments) {
      const permitted = new Set(s.decision.reasons.filter((r) => r.outcome === "PERMIT").map((r) => r.dimension));
      expect([...permitted].sort()).toEqual([...MANDATORY_DIMENSIONS].sort());
    }
  });

  it("switching ORGANIC → SPONSORED flips the same edit to BLOCKED, only on 4–9 s", () => {
    expect(decideEdit(demoEdit, organic).decision.verdict).toBe("ALLOWED");
    const { decision, segments } = decideEdit(demoEdit, sponsored);
    expect(decision.verdict).toBe("BLOCKED");
    expect(segments.map((s) => s.decision.verdict)).toEqual(["ALLOWED", "BLOCKED", "ALLOWED"]);

    const deny = segments[1].decision.reasons.find((r) => r.outcome === "DENY");
    expect(deny).toMatchObject({
      ruleId: "SPURS-3-rival-sponsor-exclusivity",
      dimension: "sponsor",
      scoreplayMediaId: "sp-game",
      start: 4,
      end: 9,
    });
    expect(segments[1].decision.evidence).toContainEqual(rivalBrand);
    expect(decision.reasons.filter((r) => r.outcome === "DENY")).toHaveLength(1);
  });

  it("evidence outside a segment's range does not affect it", () => {
    const d = evaluateSegment({
      segment: { scoreplayMediaId: "sp-game", start: 9, end: 15 },
      asset: spursGame,
      observations: [rivalBrand, { ...rivalBrand, start: 0, end: 4 }],
      intent: sponsored,
      policy: spursPolicy,
      now,
    });
    expect(d.verdict).toBe("ALLOWED");
    expect(d.evidence).not.toContainEqual(rivalBrand);
  });

  it("evidence without timecodes applies to the whole asset", () => {
    const untimed = { ...rivalBrand, start: undefined, end: undefined };
    const d = decideSegment(spursGame, sponsored, [untimed]);
    expect(d.verdict).toBe("BLOCKED");
  });

  it("a replacement segment from a different asset is judged on its own facts", () => {
    const rerouted: EditPlan = {
      ...demoEdit,
      id: "edit-1-reroute",
      derived: true,
      derivedFrom: "edit-1",
      segments: [demoEdit.segments[0], { scoreplayMediaId: "sp-alt", start: 20, end: 25 }, demoEdit.segments[2]],
    };
    expect(decideEdit(rerouted, sponsored).decision.verdict).toBe("ALLOWED");

    const unknownAlt = asset("sp-alt", { team: "San Antonio Spurs", people: [], sponsors: [] }); // competition unknown
    const result = decideEdit(rerouted, sponsored, { assets: { "sp-game": spursGame, "sp-alt": unknownAlt } });
    expect(result.segments.map((s) => s.decision.verdict)).toEqual(["ALLOWED", "NEEDS_REVIEW", "ALLOWED"]);
    expect(result.decision.verdict).toBe("NEEDS_REVIEW");
    expect(result.decision.missingFacts.join("\n")).toMatch(/Competition of asset sp-alt is not recorded/);
  });

  it("a derived edit gets no inherited verdict: it is re-evaluated in full", () => {
    const derived: EditPlan = { ...demoEdit, id: "edit-1-copy", derived: true, derivedFrom: "edit-1" };
    expect(decideEdit(derived, sponsored).decision.verdict).toBe("BLOCKED");
  });

  it("segments whose asset metadata was not loaded → NEEDS_REVIEW", () => {
    const edit: EditPlan = { ...demoEdit, segments: [{ scoreplayMediaId: "missing", start: 0, end: 3 }] };
    const { decision } = decideEdit(edit, organic);
    expect(decision.verdict).toBe("NEEDS_REVIEW");
    expect(decision.missingFacts).toEqual(["ScorePlay asset missing metadata was not loaded"]);
  });
});

describe("three-state semantics", () => {
  it("explicit verified DENY → BLOCKED (territory geo-block, sponsored TikTok)", () => {
    expect(decideSegment(spursGame, { ...organic, territory: "GB" }).verdict).toBe("BLOCKED");
    expect(decideSegment(spursGame, { ...sponsored, platform: "tiktok" }).verdict).toBe("BLOCKED");
  });

  it.each([
    ["unknown platform", { ...organic, platform: "tiktok" }, /does not cover platform "tiktok"/],
    ["unknown territory", { ...organic, territory: "JP" }, /does not cover territory "JP"/],
    ["competition conflict", { ...organic, competition: "Premier League" }, /intended competition is Premier League/],
  ] as const)("%s → NEEDS_REVIEW, never ALLOWED", (_name, intent, missing) => {
    const d = decideSegment(spursGame, intent);
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(d.missingFacts.join("\n")).toMatch(missing);
  });

  it.each([
    ["competition", { ...spursGame.facts, competition: undefined }],
    ["people", { ...spursGame.facts, people: undefined }],
    ["sponsors", { ...spursGame.facts, sponsors: undefined }],
  ] as const)("unknown %s fact → NEEDS_REVIEW (no false ALLOWED)", (_name, facts) => {
    const d = decideSegment(asset("sp-x", facts), organic);
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(d.reasons.some((r) => r.outcome === "MISSING")).toBe(true);
  });

  it("unknown competition makes a competition-scoped DENY uncertain, not ignored", () => {
    const d = decideSegment(asset("sp-x", { people: [], sponsors: [] }), { ...organic, territory: "GB" });
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(d.reasons).toContainEqual(
      expect.objectContaining({ ruleId: "SPURS-4-gb-geo-block", outcome: "MISSING", dimension: "territory" }),
    );
  });

  it("an empty policy never allows anything", () => {
    const empty: Policy = { ...spursPolicy, id: "empty", rules: [] };
    const d = decideSegment(spursGame, organic, [], empty);
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(d.reasons.map((r) => r.ruleId)).toEqual(MANDATORY_DIMENSIONS.map((dim) => `no-rule:${dim}`));
  });

  it("expired permission (publishAt after validUntil) is not a permit", () => {
    const d = decideSegment(spursGame, { ...organic, publishAt: "2027-01-15T10:00:00Z" });
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(d.reasons.some((r) => r.outcome === "PERMIT")).toBe(false);
    expect(d.missingFacts.join("\n")).toMatch(/SPURS-1-nba-social-license expired on 2026-12-31/);
  });

  it("a person seen in the segment must be covered by a permission", () => {
    const presser = asset("thfc-presser", { competition: "Premier League", people: [], sponsors: [] }, ["Press Conference"]);
    const intent: PublishIntent = { ...organic, competition: "Premier League" };
    const spokesperson: Evidence = { scoreplayMediaId: "thfc-presser", observation: "Club spokesperson at the desk", source: "HUMAN", label: "person:club-spokesperson" };
    const coach: Evidence = { scoreplayMediaId: "thfc-presser", start: 2, end: 30, observation: "Head coach speaking", source: "TWELVELABS", label: "person:Head Coach" };

    expect(decideSegment(presser, intent, [spokesperson], thfcPolicy).verdict).toBe("ALLOWED");
    const d = decideSegment(presser, intent, [spokesperson, coach], thfcPolicy);
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(d.missingFacts).toContain("No permission in policy demo-tottenham-pl covers person:head-coach");
    expect(d.evidence).toContainEqual(coach);

    expect(decideSegment(presser, { ...intent, usage: "SPONSORED" }, [spokesperson], thfcPolicy).verdict).toBe("BLOCKED");
  });

  it("Tottenham match footage: organic allowed, sponsored not permitted → NEEDS_REVIEW", () => {
    const match = asset("thfc-match", { competition: "Premier League", people: ["Son"], sponsors: ["Kit sponsor"] }, ["match"]);
    const intent: PublishIntent = { ...organic, territory: "GB", competition: "Premier League" };
    expect(decideSegment(match, intent, [], thfcPolicy).verdict).toBe("ALLOWED");
    expect(decideSegment(match, { ...intent, usage: "SPONSORED" }, [], thfcPolicy).verdict).toBe("NEEDS_REVIEW");
  });
});
