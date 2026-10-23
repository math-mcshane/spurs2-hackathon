import { describe, expect, it } from "vitest";
import {
  DecisionSchema,
  EditDecisionSchema,
  canPublish,
  type Asset,
  type Decision,
  type EditPlan,
  type Evidence,
  type PublishIntent,
} from "@/lib/contracts";
import demoSpurs from "./policies/demo-spurs-fr-sponsored.json";
import demoTottenhamCommercial from "./policies/demo-tottenham-commercial.json";
import demoTottenham from "./policies/demo-tottenham-pl.json";
import {
  PolicySchema,
  classifyBlocker,
  evaluateEdit,
  listPolicies,
  loadPolicy,
  selectPolicy,
  type AnalysisStatus,
} from "./index";

const now = new Date("2026-10-22T12:00:00Z");
const ANALYSED: AnalysisStatus = { status: "AVAILABLE" };
const NOT_ANALYSED: AnalysisStatus = { status: "NOT_CONFIGURED", detail: "TWELVELABS_API_KEY is not set" };

const THFC_TAGS = ["partner content", "Premier League", "Tottenham Hotspur", "Manchester United", "Match"];
function thfc(id: string, facts: Partial<Asset["facts"]> = {}, extraTags: string[] = []): Asset {
  return {
    id,
    title: `Clip ${id}`,
    kind: "video",
    durationSec: 20,
    tags: [...THFC_TAGS, ...extraTags],
    facts: { competition: "Premier League", teams: ["Tottenham Hotspur", "Manchester United"], ...facts },
    metadata: {},
    origin: "LIVE",
  };
}
const nba = (id: string, facts: Partial<Asset["facts"]> = {}): Asset => ({
  id,
  title: `NBA ${id}`,
  kind: "video",
  durationSec: 20,
  tags: ["NBA"],
  facts: { competition: "NBA", teams: ["San Antonio Spurs (SAS)", "Sacramento Kings (SAC)"], people: ["Victor Wembanyama"], sponsors: [], ...facts },
  metadata: {},
  origin: "LIVE",
});

const SQUAD = { "Dominic Solanke-Mitchell": ["Tottenham Hotspur FC"], "Micky van de Ven": ["Tottenham Hotspur FC"] };
const playerClip = thfc("goal", { people: ["Dominic Solanke-Mitchell", "Micky van de Ven"], peopleTeams: SQUAD });
const highlights = thfc("hl", { people: ["Dominic Solanke-Mitchell"], peopleTeams: SQUAD }, ["Highlights"]);
const fullMatch = thfc("full", {}, ["Full Match"]);
const crowd = thfc("crowd", { people: [] }); // ScorePlay positively lists no player

const ev = (id: string, label: string, extra: Partial<Evidence> = {}): Evidence => ({
  scoreplayMediaId: id,
  start: 2,
  end: 6,
  observation: `${label.split(":").pop()}: seen`,
  source: "TWELVELABS",
  label,
  confidence: 0.9,
  origin: "LIVE",
  ...extra,
});
const rubric = (id: string, answer: string): Evidence => ({
  scoreplayMediaId: id,
  observation: `Rubric player_focus: ${answer}`,
  source: "TWELVELABS",
  label: `rubric:player_focus:${answer}`,
  origin: "LIVE",
});

const base: PublishIntent = {
  territory: "GB",
  platform: "instagram",
  usage: "EDITORIAL",
  competition: "Premier League",
  club: "tottenham",
  publishAt: "2026-11-01T18:00:00Z",
};
const commercial: PublishIntent = { ...base, usage: "COMMERCIAL" };

function decide(asset: Asset, intent: PublishIntent, opts: { observations?: Evidence[]; analysis?: AnalysisStatus } = {}): Decision {
  const edit: EditPlan = { id: `e-${asset.id}`, title: "t", derived: false, segments: [{ scoreplayMediaId: asset.id, start: 0, end: 10 }] };
  const result = evaluateEdit({
    edit,
    assets: { [asset.id]: asset },
    observations: { [asset.id]: opts.observations ?? [] },
    analysis: { [asset.id]: opts.analysis ?? ANALYSED },
    intent,
    now,
  });
  EditDecisionSchema.parse(result); // always honours the shared contract
  for (const r of result.decision.reasons) expect(r.basis, `${r.ruleId} has a basis`).toBeDefined();
  return DecisionSchema.parse(result.segments[0].decision);
}

const blockerOf = (d: Decision, intent: PublishIntent) => classifyBlocker([{ intent, decision: d }]).blocker;

const open = (d: Decision) => d.reasons.filter((r) => r.outcome !== "PERMIT");

describe("bundled policies", () => {
  it.each([demoSpurs, demoTottenham])("$id validates, is DEMO and says so", (raw) => {
    const policy = PolicySchema.parse(raw);
    expect(policy.kind).toBe("DEMO");
    expect(policy.disclaimer).toContain("FICTIONAL DEMO POLICY");
  });

  it("lists policies with kind/club; there is no default policy", () => {
    expect(listPolicies().map((p) => [p.id, p.kind, p.club])).toEqual([
      ["demo-spurs-fr-sponsored", "DEMO", "spurs"],
      ["demo-tottenham-pl", "DEMO", "tottenham"],
    ]);
    expect(() => loadPolicy("nope")).toThrow(/Unknown rights policy/);
  });

  it("rejects a people/sponsor PERMIT that does not say whom it covers", () => {
    const bad = { ...demoSpurs, rules: [{ ...demoSpurs.rules[1], covers: undefined }] };
    expect(PolicySchema.safeParse(bad).success).toBe(false);
  });
});

describe("policy selection", () => {
  it("selects the Tottenham PL policy for Tottenham footage published by Tottenham", () => {
    const { policy, selection } = selectPolicy(base, [playerClip]);
    expect(policy?.id).toBe("demo-tottenham-pl");
    expect(selection).toMatchObject({ policyId: "demo-tottenham-pl", kind: "DEMO" });
  });

  it("never evaluates Tottenham (Premier League) footage under the San Antonio Spurs NBA policy", () => {
    const spursIntent: PublishIntent = { ...base, club: "spurs", competition: "NBA", territory: "US" };
    const { policy, selection } = selectPolicy(spursIntent, [playerClip]);
    expect(policy).toBeNull();
    expect(selection.considered.find((c) => c.policyId === "demo-spurs-fr-sponsored")).toMatchObject({ applicable: false });
    const d = decide(playerClip, spursIntent);
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(d.policyId).toBe("none");
    expect(d.reasons.every((r) => r.basis === "POLICY_SELECTION")).toBe(true);
    expect(d.reasons.map((r) => r.explanation).join(" ")).toMatch(/Tottenham Hotspur|Manchester United/);
  });

  it("no publishing club ⇒ NEEDS_REVIEW (POLICY_SELECTION) and a CAMPAIGN blocker", () => {
    const d = decide(playerClip, { ...base, club: undefined });
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(d.reasons[0]).toMatchObject({ basis: "POLICY_SELECTION", dimension: "policy" });
    expect(blockerOf(d, { ...base, club: undefined }).scope).toBe("CAMPAIGN");
  });

  it("footage without the required provenance tag is not covered (CLIP blocker)", () => {
    const foreign = { ...crowd, id: "nopartner", tags: crowd.tags.filter((t) => t !== "partner content") };
    const d = decide(foreign, base);
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(d.reasons[0]).toMatchObject({ basis: "POLICY_SELECTION", dimension: "provenance" });
    expect(blockerOf(d, base).scope).toBe("CLIP");
  });
});

describe("Tottenham demo policy", () => {
  it("EDITORIAL match footage: ALLOWED with DEMO clearance, never publishable", () => {
    const d = decide(playerClip, base, { analysis: NOT_ANALYSED });
    expect(d.verdict).toBe("ALLOWED");
    expect(d.clearance).toBe("DEMO");
    expect(d.policyFictional).toBe(true);
    expect(canPublish({ decision: d, humanReviewStatus: "APPROVED" })).toBe(false);
  });

  it("COMMERCIAL use of broadcast highlights is BLOCKED with a human-readable reason (CLIP blocker)", () => {
    const d = decide(highlights, commercial);
    expect(d.verdict).toBe("BLOCKED");
    const deny = d.reasons.find((r) => r.outcome === "DENY")!;
    expect(deny).toMatchObject({ ruleId: "THFC-6-no-broadcast-footage-in-ads", dimension: "usage", basis: "LEGAL_ENTITLEMENT" });
    expect(deny.explanation).toMatch(/can't be used to sell merchandise/);
    expect(blockerOf(d, commercial).scope).toBe("CLIP");
  });

  it("missing analysis is a TECHNICAL gap, not a missing licence", () => {
    const d = decide(playerClip, commercial, { analysis: NOT_ANALYSED });
    expect(d.verdict).toBe("NEEDS_REVIEW");
    const gaps = open(d);
    expect([...new Set(gaps.map((r) => r.dimension))].sort()).toEqual(["people", "sponsor"]);
    for (const r of gaps) {
      expect(r.basis).toBe("TECHNICAL_OBSERVATION");
      expect(r.explanation).toMatch(/video was not analysed/);
    }
  });

  it("an unproven ScorePlay↔TwelveLabs link is MEDIA_IDENTITY", () => {
    const d = decide(playerClip, commercial, { analysis: { status: "UNLINKABLE", detail: "2 candidate videos match" } });
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(open(d).every((r) => r.basis === "MEDIA_IDENTITY")).toBe(true);
  });

  it("COMMERCIAL: own-squad players (verified in ScorePlay) + official partner ⇒ ALLOWED (DEMO)", () => {
    const obs = [rubric("goal", "group"), ev("goal", "brand:aia"), ev("goal", "person:solanke")];
    const d = decide(playerClip, commercial, { observations: obs });
    expect(d.verdict).toBe("ALLOWED");
    expect(d.clearance).toBe("DEMO");
  });

  it("COMMERCIAL: a person named only by AI, unknown to ScorePlay ⇒ MISSING unverified identification (never DENY, no rights claim)", () => {
    const obs = [rubric("goal", "group"), ev("goal", "person:bruno-fernandes")];
    const d = decide(playerClip, commercial, { observations: obs });
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(open(d)).toEqual([
      expect.objectContaining({ dimension: "people", outcome: "MISSING", basis: "TECHNICAL_OBSERVATION", ruleId: "subject:person:bruno-fernandes" }),
    ]);
    expect(open(d)[0].explanation).toMatch(/^AI named .*ScorePlay identity data can't confirm it.* a reviewer must verify/);
    expect(open(d)[0].explanation).not.toMatch(/isn't on|can't cover|not a club player/);
  });

  it("COMMERCIAL: a player registered to another club is not covered by the image-rights pool", () => {
    const rival = thfc("rival", { people: ["Bruno Fernandes"], peopleTeams: { "Bruno Fernandes": ["Manchester United"] } });
    const d = decide(rival, commercial, { observations: [rubric("rival", "single_player")] });
    expect(open(d)[0].explanation).toMatch(/plays for Manchester United/);
  });

  it("COMMERCIAL: a third-party brand seen with confidence ≥ 0.6 ⇒ BLOCKED; below 0.6 it cannot block", () => {
    const strong = decide(playerClip, commercial, { observations: [rubric("goal", "group"), ev("goal", "brand:snapdragon", { confidence: 0.85 })] });
    expect(strong.verdict).toBe("BLOCKED");
    expect(strong.reasons.find((r) => r.outcome === "DENY")).toMatchObject({ ruleId: "THFC-13-partner-exclusivity", start: 2, end: 6 });

    const weak = decide(playerClip, commercial, { observations: [rubric("goal", "group"), ev("goal", "brand:snapdragon", { confidence: 0.4 })] });
    expect(weak.verdict).toBe("NEEDS_REVIEW");
    expect(weak.reasons.find((r) => r.ruleId === "THFC-13-partner-exclusivity")).toMatchObject({ outcome: "MISSING", basis: "TECHNICAL_OBSERVATION" });
  });

  it("COMMERCIAL crowd shot: no listed player + analysis finds none ⇒ stadium clause ⇒ ALLOWED (DEMO)", () => {
    const d = decide(crowd, commercial, { observations: [rubric("crowd", "no_players")] });
    expect(d.verdict).toBe("ALLOWED");
    expect(d.reasons.some((r) => r.ruleId === "THFC-10-stadium-conditions-of-entry" && r.outcome === "PERMIT")).toBe(true);
    // Players on screen but unidentified ⇒ never ALLOWED.
    expect(decide(crowd, commercial, { observations: [rubric("crowd", "group")] }).verdict).toBe("NEEDS_REVIEW");
  });

  it("an UNKNOWN ScorePlay people list is never 'no players', even when analysis finds none (CLIP)", () => {
    const unknownPeople = thfc("unknown-people");
    const d = decide(unknownPeople, commercial, { observations: [rubric("unknown-people", "no_players")] });
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(open(d)).toEqual([expect.objectContaining({ dimension: "people", basis: "LEGAL_ENTITLEMENT", ruleId: "fact:people" })]);
    expect(blockerOf(d, commercial).scope).toBe("CLIP");
  });

  it("unlicensed territory ⇒ NEEDS_REVIEW and a CAMPAIGN blocker with the licensed territories", () => {
    const intent = { ...base, territory: "IN" };
    const d = decide(playerClip, intent);
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(open(d)).toEqual([expect.objectContaining({ dimension: "territory", basis: "LEGAL_ENTITLEMENT" })]);
    const blocker = blockerOf(d, intent);
    expect(blocker).toMatchObject({ scope: "CAMPAIGN", dimensions: ["territory"] });
    expect(blocker.suggestion).toMatch(/GB, IE, US, CA, AU, NZ/);
  });

  it("CAMPAIGN blocker aggregates every unlicensed territory across the campaign's uses, with a remedy", () => {
    const uses = ["GB", "FR", "ES", "US", "IN"].map((territory) => ({ ...base, territory }));
    const { blocker, remedy } = classifyBlocker(uses.map((intent) => ({ intent, decision: decide(playerClip, intent) })));
    expect(blocker).toMatchObject({ scope: "CAMPAIGN", dimensions: ["territory"], ruleIds: ["THFC-3-licensed-territories"] });
    expect(blocker.explanation).toMatch(/Not licensed for France \(FR\), Spain \(ES\) and India \(IN\)\./);
    expect(blocker.suggestion).toMatch(/Drop FR, ES, IN; licensed territories: GB, IE, US, CA, AU, NZ/);
    expect(remedy).toEqual({ territories: ["GB", "US"] });
  });

  it("a near-miss caused by a missing ASSET fact is CLIP-scope, not CAMPAIGN", () => {
    const spursIntent: PublishIntent = { territory: "FR", platform: "instagram", usage: "ORGANIC", competition: "NBA", club: "spurs", publishAt: base.publishAt };
    const d = decide({ ...nba("nocomp", { competition: undefined }), tags: ["NBA"] }, spursIntent);
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(open(d).some((r) => r.dimension === "territory" && r.ruleId.startsWith("fact:competition:"))).toBe(true);
    expect(blockerOf(d, spursIntent).scope).toBe("CLIP");
  });

  it("a publish date in the past ⇒ NEEDS_REVIEW (not BLOCKED), CAMPAIGN scope, asks for a current date", () => {
    const stale = { ...base, publishAt: "2026-10-01T10:00:00Z" }; // now = 2026-10-22
    const d = decide(playerClip, stale);
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(open(d)).toEqual([expect.objectContaining({ ruleId: "intent:publish-date-past", dimension: "expiry" })]);
    expect(blockerOf(d, stale)).toMatchObject({ scope: "CAMPAIGN" });
    expect(blockerOf(d, stale).suggestion).toMatch(/future/);
    // Within the grace window it is still "now".
    expect(decide(playerClip, { ...base, publishAt: "2026-10-22T11:58:00Z" }).verdict).toBe("ALLOWED");
  });

  it("full-match recordings are geo-restricted to the home market (CLIP blocker)", () => {
    const intent = { ...base, territory: "US" };
    const d = decide(fullMatch, intent);
    expect(d.verdict).toBe("BLOCKED");
    expect(blockerOf(d, intent).scope).toBe("CLIP");
    expect(decide(fullMatch, base).verdict).toBe("ALLOWED");
  });

  it("publishAt outside the licence term ⇒ BLOCKED (expiry) and a CAMPAIGN blocker", () => {
    const late = { ...base, publishAt: "2027-08-01T10:00:00Z" };
    const d = decide(playerClip, late);
    expect(d.verdict).toBe("BLOCKED");
    expect(d.reasons.find((r) => r.outcome === "DENY")).toMatchObject({ ruleId: "policy-term", dimension: "expiry" });
    expect(blockerOf(d, late)).toMatchObject({ scope: "CAMPAIGN" });
    expect(blockerOf(d, late).suggestion).toMatch(/2026-07-01 and 2027-06-30/);
  });

  it("unknown is never ALLOWED: competition not recorded ⇒ NEEDS_REVIEW", () => {
    const d = decide(thfc("nocomp", { competition: undefined }), base);
    expect(d.verdict).toBe("NEEDS_REVIEW");
    expect(d.clearance).toBe("NONE");
  });

  it("an asset that could not be loaded ⇒ NEEDS_REVIEW (MEDIA_IDENTITY)", () => {
    const edit: EditPlan = { id: "x", title: "x", derived: false, segments: [{ scoreplayMediaId: "missing", start: 0, end: 5 }] };
    const r = evaluateEdit({ edit, assets: {}, observations: {}, analysis: {}, intent: base, now });
    expect(r.decision.verdict).toBe("NEEDS_REVIEW");
    expect(r.decision.reasons[0].basis).toBe("MEDIA_IDENTITY");
  });
});

describe("sponsor intent (target sponsor vs other brands on screen)", () => {
  const sponsored: PublishIntent = { ...base, usage: "SPONSORED" };
  const promoting = (targetSponsor: string): PublishIntent => ({ ...sponsored, targetSponsor });
  const aia = ev("goal", "brand:aia", { start: 1, end: 9, observation: "AIA: logo on the shirt" });
  const dhl = ev("goal", "brand:dhl", { start: 5, end: 7, observation: "DHL: logo on the boards" });
  const kraken = ev("goal", "brand:kraken", { start: 2, end: 8, observation: "Kraken: logo on the sleeve" });
  const sponsor = (d: Decision) => d.reasons.filter((r) => r.dimension === "sponsor");

  it("target partner (AIA under THFC-12) is permitted; a competing brand (DHL) is denied by THFC-13 alone", () => {
    const d = decide(playerClip, promoting("AIA"), { observations: [aia, dhl] });
    expect(d.verdict).toBe("BLOCKED");
    expect(open(d)).toEqual([expect.objectContaining({ ruleId: "THFC-13-partner-exclusivity", outcome: "DENY" })]);
    expect(open(d)[0].explanation).toMatch(/DHL/);
    expect(open(d)[0].explanation).not.toMatch(/AIA/);
    expect(d.sponsorship).toEqual({
      target: { name: "AIA", label: "brand:aia", relationship: "PARTNER", ruleId: "THFC-12-official-partners" },
      brands: [
        { name: "AIA", label: "brand:aia", role: "TARGET", ruleId: "THFC-12-official-partners", certainty: "AI_OBSERVATION", spans: ["1–9 s"] },
        { name: "DHL", label: "brand:dhl", role: "COMPETING_RESTRICTED", ruleId: "THFC-13-partner-exclusivity", certainty: "AI_OBSERVATION", spans: ["5–7 s"] },
      ],
    });
  });

  it("target partner alone on screen ⇒ ALLOWED (DEMO), with the campaign-partner permission recorded", () => {
    const d = decide(playerClip, promoting("AIA"), { observations: [aia] });
    expect(d.verdict).toBe("ALLOWED");
    expect(sponsor(d).map((r) => [r.ruleId, r.outcome])).toContainEqual(["target-sponsor:aia", "PERMIT"]);
  });

  it("a target the rules don't describe (Kraken under demo-tottenham-pl) ⇒ NEEDS_REVIEW — never DENY, never PERMIT", () => {
    for (const observations of [[kraken], []]) {
      const d = decide(playerClip, promoting("Kraken"), { observations });
      expect(d.verdict).toBe("NEEDS_REVIEW");
      expect(sponsor(d).map((r) => [r.ruleId, r.outcome])).toEqual([["target-sponsor:kraken", "MISSING"]]);
      expect(sponsor(d)[0].explanation).toMatch(/doesn't describe a relationship with Kraken .* a reviewer must confirm/);
      expect(d.sponsorship!.target).toMatchObject({ name: "Kraken", relationship: "UNKNOWN" });
      expect(blockerOf(d, promoting("Kraken")).scope).toBe("CAMPAIGN");
    }
  });

  it("an undescribed target never shields other brands: DHL is still denied", () => {
    const d = decide(playerClip, promoting("Kraken"), { observations: [kraken, dhl] });
    expect(d.verdict).toBe("BLOCKED");
    expect(open(d).map((r) => [r.ruleId, r.outcome])).toEqual([
      ["THFC-13-partner-exclusivity", "DENY"],
      ["target-sponsor:kraken", "MISSING"],
    ]);
    expect(open(d)[0].explanation).not.toMatch(/Kraken/);
  });

  it("no target named ⇒ the rules apply literally (Kraken on screen is a non-partner under THFC-13)", () => {
    const d = decide(playerClip, sponsored, { observations: [kraken] });
    expect(d.verdict).toBe("BLOCKED");
    expect(d.sponsorship).toMatchObject({ target: null, brands: [{ label: "brand:kraken", role: "COMPETING_RESTRICTED" }] });
  });

  it("the same target is a partner where the package names it (Kraken under demo-tottenham-commercial)", () => {
    const policy = PolicySchema.parse(demoTottenhamCommercial);
    const edit: EditPlan = { id: "e", title: "t", derived: false, segments: [{ scoreplayMediaId: "goal", start: 0, end: 10 }] };
    const r = evaluateEdit({ edit, assets: { goal: playerClip }, observations: { goal: [kraken] }, analysis: { goal: ANALYSED }, intent: promoting("Kraken"), now, policies: [policy] });
    expect(r.decision.verdict).toBe("ALLOWED");
    expect(r.decision.sponsorship!.target).toMatchObject({ relationship: "PARTNER", ruleId: "THFC-C15-official-partners" });
  });

  it("a target means nothing for an organic post: the incidental-branding rule applies", () => {
    const d = decide(playerClip, { ...base, usage: "ORGANIC", targetSponsor: "Kraken" }, { observations: [kraken] });
    expect(d.verdict).toBe("ALLOWED");
    expect(d.sponsorship).toMatchObject({ target: null, brands: [{ role: "INCIDENTAL", ruleId: "THFC-11-incidental-branding" }] });
  });

  it("AI names are reconciled with ScorePlay tags tolerantly (accents, surnames) before anyone is flagged", () => {
    const tagged = thfc("goal", { people: ["Pierre-Emile Højbjerg", "Micky van de Ven"], peopleTeams: { "Pierre-Emile Højbjerg": ["Tottenham Hotspur FC"], "Micky van de Ven": ["Tottenham Hotspur FC"] } });
    const d = decide(tagged, commercial, { observations: [ev("goal", "person:hojbjerg"), ev("goal", "person:mickey-van-de-ven")] });
    expect(d.verdict).toBe("ALLOWED");
  });
});

describe("San Antonio Spurs demo policy", () => {
  const organic: PublishIntent = { territory: "FR", platform: "instagram", usage: "ORGANIC", competition: "NBA", club: "spurs", publishAt: "2026-11-01T18:00:00Z" };

  it("organic NBA footage in FR: ALLOWED (DEMO)", () => {
    expect(decide(nba("g"), organic, { analysis: NOT_ANALYSED })).toMatchObject({ verdict: "ALLOWED", clearance: "DEMO", policyId: "demo-spurs-fr-sponsored" });
  });

  it("HUMAN-flagged rival sponsor in a SPONSORED post ⇒ BLOCKED; analysis gap ⇒ cannot rule it out", () => {
    const rival: Evidence = { scoreplayMediaId: "g", start: 1, end: 3, observation: "Rival board", source: "HUMAN", label: "brand:rival-sponsor" };
    const sponsored = { ...organic, usage: "SPONSORED" as const };
    expect(decide(nba("g"), sponsored, { observations: [rival] }).verdict).toBe("BLOCKED");
    const gap = decide(nba("g"), sponsored, { analysis: NOT_ANALYSED });
    expect(gap.verdict).toBe("NEEDS_REVIEW");
    expect(open(gap)[0]).toMatchObject({ ruleId: "SPURS-3-rival-sponsor-exclusivity", basis: "TECHNICAL_OBSERVATION" });
  });

  it("GB geo-block ⇒ BLOCKED, CAMPAIGN blocker", () => {
    const gb = { ...organic, territory: "GB" };
    const d = decide(nba("g"), gb);
    expect(d.verdict).toBe("BLOCKED");
    expect(blockerOf(d, gb).scope).toBe("CAMPAIGN");
  });
});
