import { describe, expect, it } from "vitest";
import type { Decision, Evidence, PublishIntent } from "@/lib/contracts";
import { decisionFindings, plannedUsesLabel, reasonFinding, rightsIssues } from "../goal-view";
import { segmentLabel } from "../studio/MomentPreview";

const brand: Evidence = { scoreplayMediaId: "130851320", start: 9, end: 14, observation: "Manchester United: crest on kit", source: "TWELVELABS", label: "brand:manchester-united", confidence: 0.9 };
const person: Evidence = { scoreplayMediaId: "130851320", start: 2, end: 4, observation: "Player #18", source: "TWELVELABS", label: "person:player-18" };

describe("reasonFinding: real evidence vs the rule applied", () => {
  it("puts timecoded TwelveLabs evidence under 'what we found' and the policy text under 'rule applied'", () => {
    const f = reasonFinding(
      { ruleId: "THFC-13", dimension: "sponsor", outcome: "DENY", basis: "LEGAL_ENTITLEMENT", explanation: "Sales posts can't show other brands.", scoreplayMediaId: "130851320", start: 7, end: 15 },
      { evidence: [brand, person], fictional: true },
    );
    expect(f).toEqual({
      dimension: "sponsor",
      outcome: "DENY",
      found: [{ text: "Manchester United: crest on kit (9–14 s)", source: "TwelveLabs video analysis" }],
      rule: { id: "THFC-13", text: "Sales posts can't show other brands.", tag: "Demo policy · fictional" },
    });
  });

  it("ignores evidence from another clip or outside the reason's window", () => {
    const f = reasonFinding(
      { ruleId: "r", dimension: "sponsor", outcome: "DENY", explanation: "x", scoreplayMediaId: "130851320", start: 0, end: 5 },
      { evidence: [brand, { ...brand, scoreplayMediaId: "other", start: 1, end: 2 }], fictional: false },
    );
    expect(f?.found).toEqual([{ text: "What ScorePlay records about this clip (asset 130851320).", source: "ScorePlay data" }]);
    expect(f?.rule.tag).toBe("Verified policy");
  });

  it("attributes licence reasons to the campaign plan and analysis gaps to TwelveLabs; skips permits", () => {
    expect(reasonFinding({ dimension: "territory", outcome: "DENY", explanation: "Not licensed for France (FR)." }, { fictional: true, plannedUse: "Commercial Instagram post in France (FR)" })?.found).toEqual([
      { text: "Planned use: Commercial Instagram post in France (FR).", source: "Your campaign plan" },
    ]);
    expect(reasonFinding({ dimension: "people", outcome: "MISSING", basis: "TECHNICAL_OBSERVATION", explanation: "x" }, { fictional: true })?.found[0].source).toBe("Video analysis · TwelveLabs");
    expect(reasonFinding({ dimension: "territory", outcome: "PERMIT", explanation: "GB licensed" }, { fictional: true })).toBeNull();
  });

  it("a restriction shows only the brands its rule restricts — never the target partner seen in the same seconds", () => {
    const aia: Evidence = { ...brand, start: 10, end: 19, observation: "AIA: on the shirt", label: "brand:aia" };
    const dhl: Evidence = { ...brand, start: 15, end: 17, observation: "DHL: on the boards", label: "brand:dhl" };
    const f = reasonFinding(
      { ruleId: "THFC-13", dimension: "sponsor", outcome: "DENY", explanation: "x", scoreplayMediaId: "130851320", start: 15, end: 17 },
      {
        evidence: [aia, dhl],
        fictional: true,
        sponsorship: {
          target: { name: "AIA", label: "brand:aia", relationship: "PARTNER", ruleId: "THFC-12" },
          brands: [
            { name: "AIA", label: "brand:aia", role: "TARGET", ruleId: "THFC-12", certainty: "AI_OBSERVATION", spans: ["10–19 s"] },
            { name: "DHL", label: "brand:dhl", role: "COMPETING_RESTRICTED", ruleId: "THFC-13", certainty: "AI_OBSERVATION", spans: ["15–17 s"] },
          ],
        },
      },
    );
    expect(f?.found).toEqual([{ text: "DHL: on the boards (15–17 s)", source: "TwelveLabs video analysis" }]);
  });
});

describe("people named only by AI", () => {
  const named = ["Pedro Porro", "Giovani Lo Celso", "Angelo Stiller", "Ange Postecoglou"];
  const slug = (n: string) => n.toLowerCase().replace(/ /g, "-");
  const decision: Decision = {
    verdict: "NEEDS_REVIEW",
    reasons: named.map((n) => ({
      ruleId: `subject:person:${slug(n)}`,
      dimension: "people",
      outcome: "MISSING" as const,
      basis: "TECHNICAL_OBSERVATION" as const,
      explanation: `AI named “${n}”; ScorePlay identity data can't confirm it — a reviewer must verify who it is.`,
      scoreplayMediaId: "130851359",
      start: 114.7,
      end: 120.1,
    })),
    missingFacts: [],
    evidence: named.map((n) => ({ scoreplayMediaId: "130851359", start: 115, end: 118, observation: `${n}: celebrating`, source: "TWELVELABS" as const, label: `person:${slug(n)}` })),
    policyVersion: "1",
    policyId: "demo-tottenham-pl",
    policyFictional: true,
    clearance: "NONE",
    evaluatedAt: "2026-10-23T12:00:00.000Z",
  };

  it("are one concise finding, each person's observation still listed", () => {
    const findings = decisionFindings(decision);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule.text).toBe(
      "4 people named by AI couldn't be verified against ScorePlay: Pedro Porro, Giovani Lo Celso, Angelo Stiller and Ange Postecoglou — a reviewer must verify who they are.",
    );
    expect(findings[0].found).toHaveLength(4);
    expect(rightsIssues(decision.reasons, decision.evidence)[0].explanations).toEqual([findings[0].rule.text]);
  });
});

describe("plannedUsesLabel", () => {
  const i = (platform: string): Pick<PublishIntent, "platform" | "territory" | "usage"> => ({ platform, territory: "GB", usage: "COMMERCIAL" });
  it("names every use a re-check covered", () => {
    expect(plannedUsesLabel([i("instagram"), i("facebook"), i("x")])).toBe("all 3 planned uses (Instagram, Facebook, X · GB · commercial)");
    expect(plannedUsesLabel([i("instagram")])).toBe("the planned use (Instagram · GB · commercial)");
  });
});

describe("segmentLabel", () => {
  it("never shows an end past the asset's duration", () => {
    expect(segmentLabel(0, 6.6, 6.4)).toBe("0:00–0:06 of 0:06");
    expect(segmentLabel(7, 15, 30)).toBe("0:07–0:15 of 0:30");
    expect(segmentLabel(7, 15, undefined)).toBe("0:07–0:15");
  });
});
