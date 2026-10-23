import { describe, expect, it } from "vitest";
import type { Evidence, PublishIntent } from "@/lib/contracts";
import { plannedUsesLabel, reasonFinding } from "../goal-view";
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
