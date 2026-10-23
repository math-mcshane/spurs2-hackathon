import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as NextServer from "next/server";
import type { EditDecision, Verdict } from "@/lib/contracts";
import { computeBusinessMetrics } from "../business-metrics";
import { detectOpportunities, freshnessScore, matchBrief } from "../detect-opportunities";
import { isPulseBoardEnabled } from "../flags";
import { useMemoryRepositoriesForTests } from "@/lib/server/repositories/testing";
import * as opportunitiesRoute from "@/app/api/pulse/opportunities/route";
import * as refreshRoute from "@/app/api/pulse/refresh/route";
import * as handoffRoute from "@/app/api/pulse/handoff/route";
import * as businessRoute from "@/app/api/pulse/business/route";
import * as goalRoute from "@/app/api/pulse/goal/route";
import { lookupMedia } from "../server/media-lookup";
import * as svc from "../server/service";
import { buildHandoff, handoffToReroute } from "../handoff-to-reroute";
import { buildView, rankOpportunities } from "../rank-opportunities";
import { analyzeMarket, momentumLevel, shiftConfidence } from "../market-signals";
import { parseObjective } from "../objective-parser";
import { marketFit } from "../objective-ranker";
import { SIGNAL_FIXTURE, SPONSOR_BRIEFS, fixtureSignals } from "../signal-adapter";
import type {
  DetectedOpportunity,
  LedgerEntry,
  MediaCandidate,
  MediaLookup,
  OpportunityView,
  RightsState,
  SponsorBrief,
  Topic,
} from "../types";

// vi.hoisted runs before static imports are bound, so builtins must be loaded inside it.
const STATE = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  return mkdtempSync(`${tmpdir()}/pulse-test-`);
});
vi.mock("@/lib/state-dir", () => ({ STATE_ROOT: STATE }));
// Route handlers call next/server `connection()`, which needs a Next request scope.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof NextServer>()), connection: async () => {} }));

const verdict = vi.hoisted(() => ({ current: "NEEDS_REVIEW" as Verdict }));
vi.mock("@/lib/server/decide", () => ({
  decideEdit: vi.fn(async (edit): Promise<EditDecision> => {
    const decision = {
      verdict: verdict.current,
      reasons: [{ ruleId: "r", dimension: "sponsor", outcome: "MISSING" as const, explanation: "unknown sponsor" }],
      missingFacts: [],
      evidence: [],
      policyVersion: "t",
      policyId: "test-policy",
      policyFictional: true,
      clearance: verdict.current === "ALLOWED" ? ("DEMO" as const) : ("NONE" as const),
      evaluatedAt: new Date().toISOString(),
    };
    return { edit, decision, segments: [] };
  }),
}));

const candidate = (over: Partial<MediaCandidate> = {}): MediaCandidate => ({
  scoreplayAssetId: "sp-1",
  title: "Clip",
  kind: "video",
  durationSec: 40,
  foundBy: "SCOREPLAY_METADATA_FALLBACK",
  discoveredBy: "PLAYER_TAG",
  origin: "LIVE",
  ...over,
});

vi.mock("../server/media-lookup", () => ({
  lookupMedia: vi.fn(async () => ({
    status: "FOUND",
    searchedAt: new Date().toISOString(),
    intelligence: { status: "NOT_INDEXED", message: "m" },
    attempts: [{ service: "ScorePlay", query: "q", outcome: "OK" }],
    candidates: [candidate()],
  })),
}));

afterAll(() => rmSync(STATE, { recursive: true, force: true }));

const NOW = new Date("2026-10-17T22:00:00Z");
const detected = (): DetectedOpportunity[] =>
  detectOpportunities(fixtureSignals(), SPONSOR_BRIEFS, { now: NOW, replayClock: NOW }, NOW.toISOString());

function view(id: string, rights: RightsState | undefined, priority: number, ledger: Partial<LedgerEntry> = {}): OpportunityView {
  const base = detected()[0];
  const entry: LedgerEntry = {
    status: "SENT_TO_REROUTE",
    ...ledger,
    ...(rights && rights !== "NOT_CHECKED"
      ? {
          rights: {
            state: rights,
            checkedAt: NOW.toISOString(),
            scoreplayAssetId: "sp-1",
            policyId: "p",
            policyVersion: "1",
            policyFictional: true,
            reasons: [],
            missingFacts: [],
          },
        }
      : {}),
  };
  return buildView({ ...base, id, score: { ...base.score, priority } }, undefined, entry);
}

describe("board feature flag", () => {
  const original = process.env.PULSE_BOARD_ENABLED;
  afterEach(() => {
    process.env.PULSE_BOARD_ENABLED = original;
  });

  it("is enabled only by the exact string 'true'", () => {
    for (const v of [undefined, "", "false", "1", "TRUE", "yes"]) {
      if (v === undefined) delete process.env.PULSE_BOARD_ENABLED;
      else process.env.PULSE_BOARD_ENABLED = v;
      expect(isPulseBoardEnabled()).toBe(false);
    }
    process.env.PULSE_BOARD_ENABLED = "true";
    expect(isPulseBoardEnabled()).toBe(true);
  });

  it("every board route returns a bare 404 when disabled, without touching state; the Studio goal route is not gated", async () => {
    delete process.env.PULSE_BOARD_ENABLED;
    const routes = [opportunitiesRoute, refreshRoute, handoffRoute, businessRoute];
    const handlers = routes.flatMap((r) => Object.values(r) as ((req: Request) => Promise<Response>)[]);
    expect(handlers).toHaveLength(5);
    for (const handler of handlers) {
      const res = await handler(new Request("http://x/api/pulse/any", { method: "POST", body: "{}" }));
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    }
    expect(lookupMedia).not.toHaveBeenCalled();
    const goal = await goalRoute.POST(new Request("http://x/api/pulse/goal", { method: "POST", body: "{}" }));
    expect(goal.status).toBe(400);
  });
});

describe("rights gate and ranking", () => {
  it("never infers a rights state from fan or commercial score", () => {
    const v = buildView({ ...detected()[0], score: { ...detected()[0].score, priority: 100 } }, undefined, undefined);
    expect(v.rightsState).toBe("NOT_CHECKED");
    expect(v.gate).toBe("NEEDS_CLEARANCE");
  });

  it("ranks by rights verdict before priority; BLOCKED never rises above a clearable item; dismissed last", () => {
    const ranked = rankOpportunities([
      view("blocked-hot", "BLOCKED", 99),
      view("review-cold", "NEEDS_REVIEW", 5),
      view("allowed-cold", "ALLOWED", 1),
      view("unchecked-mid", "NOT_CHECKED", 50),
      view("dismissed-allowed", "ALLOWED", 100, { status: "DISMISSED" }),
    ]);
    expect(ranked.map((v) => v.id)).toEqual(["allowed-cold", "unchecked-mid", "review-cold", "blocked-hot", "dismissed-allowed"]);
  });

  it("calls a fulfillment candidate DELIVERABLE_READY when approved and FULFILLED only once published with evidence", () => {
    const fulfil = detected().find((d) => d.commercialState === "FULFILLMENT_CANDIDATE")!;
    const at = NOW.toISOString();
    expect(buildView(fulfil, undefined, { status: "APPROVED", approvedAt: at }).deliverableState).toBe("DELIVERABLE_READY");
    expect(buildView(fulfil, undefined, { status: "PUBLISHED", publishedAt: at }).deliverableState).toBe("OPEN");
    expect(
      buildView(fulfil, undefined, { status: "PUBLISHED", publishedAt: at, publishEvidenceUrl: "https://example.com/p" }).deliverableState,
    ).toBe("FULFILLED");
  });
});

describe("commercial matching", () => {
  const topic: Topic = {
    key: "t",
    club: "spurs",
    game: "g",
    focus: "f",
    headline: "h",
    angle: "a",
    interestSummary: "i",
    cohort: "c",
    desiredFormat: "vertical_short",
    scoreplay: { terms: [], filenameHints: [] },
    semanticQuery: "q",
    topicTags: ["bench"],
    contentTraits: [],
    hooks: {},
  };
  const brief = (over: Partial<SponsorBrief>): SponsorBrief => ({
    id: "b",
    club: "spurs",
    partnerLabel: "P",
    objective: "o",
    allowedFormats: ["vertical_short"],
    audienceSegments: [],
    topicTags: ["bench", "dunk"],
    publishIntent: { territory: "FR", platform: "instagram", usage: "SPONSORED" },
    dataStatus: "DEMO",
    ...over,
  });

  it("open contracted deliverables → FULFILLMENT_CANDIDATE; no contract → UPSELL_IDEA; nothing matching → EDITORIAL", () => {
    expect(matchBrief(topic, [brief({ contractedDeliverables: 4, publishedDeliverables: 3 })]).state).toBe("FULFILLMENT_CANDIDATE");
    expect(matchBrief(topic, [brief({ contractedDeliverables: 4, publishedDeliverables: 4 })]).state).toBe("UPSELL_IDEA");
    expect(matchBrief(topic, [brief({})]).state).toBe("UPSELL_IDEA");
    expect(matchBrief(topic, [brief({ club: "tottenham" })]).state).toBe("EDITORIAL");
    expect(matchBrief(topic, [brief({ allowedFormats: ["square_post"] })]).state).toBe("EDITORIAL");
    expect(matchBrief({ ...topic, topicTags: ["other"] }, [brief({})]).state).toBe("EDITORIAL");
  });

  it("prefers a brief with an open obligation over a better tag overlap without one", () => {
    const m = matchBrief(topic, [
      brief({ id: "prospect", topicTags: ["bench"] }),
      brief({ id: "contract", contractedDeliverables: 2, publishedDeliverables: 1 }),
    ]);
    expect(m.brief?.id).toBe("contract");
  });

  it("demo A: the bench-reaction signal is a fulfillment candidate for the fictional matchday brief", () => {
    const bench = detected().find((d) => d.id === "opp-spurs-bench-dunk")!;
    expect(bench).toMatchObject({ commercialState: "FULFILLMENT_CANDIDATE", sponsorBriefId: "brief-spurs-matchday", evidenceMode: "FIXTURE" });
    expect(SIGNAL_FIXTURE.label).toMatch(/SIMULATED/);
  });

  it("freshness decays linearly over 72 h and clamps at both ends", () => {
    expect(freshnessScore("2026-10-17T22:00:00Z", NOW)).toBe(100);
    expect(freshnessScore("2026-10-16T10:00:00Z", NOW)).toBe(50);
    expect(freshnessScore("2026-10-01T00:00:00Z", NOW)).toBe(0);
    expect(freshnessScore("2026-10-18T00:00:00Z", NOW)).toBe(100);
  });
});

describe("handoff to REROUTE", () => {
  const bench = () => buildView(detected().find((d) => d.id === "opp-spurs-bench-dunk")!, undefined, undefined);
  const brief = SPONSOR_BRIEFS.find((b) => b.id === "brief-spurs-matchday");

  it("uses search timecodes and the brief's publish intent; the deep link carries the same asset and cut", () => {
    const tl = candidate({ scoreplayAssetId: "sp-9", startSeconds: 3, endSeconds: 14, competition: "NBA" });
    const { edit, intent, rerouteUrl } = handoffToReroute(buildHandoff(bench(), tl), { brief, now: NOW });
    expect(edit.segments).toEqual([{ scoreplayMediaId: "sp-9", start: 3, end: 14, label: "PULSE cut" }]);
    expect(intent).toMatchObject({ territory: "FR", platform: "instagram", usage: "SPONSORED", competition: "NBA" });
    const url = new URL(rerouteUrl, "http://x");
    expect(url.pathname).toBe("/desk");
    const q = url.searchParams;
    expect([q.get("asset"), q.get("start"), q.get("end"), q.get("usage"), q.get("club")]).toEqual(["sp-9", "3", "14", "SPONSORED", "spurs"]);
  });

  it("without timecodes cuts at most 15 s (bounded by duration); without a brief publishes organically", () => {
    const short = handoffToReroute(buildHandoff(bench(), candidate({ durationSec: 9 })), { now: NOW });
    expect(short.edit.segments[0]).toMatchObject({ start: 0, end: 9 });
    expect(short.intent).toMatchObject({ usage: "ORGANIC", competition: "NBA", territory: "US" });
    const long = handoffToReroute(buildHandoff(bench(), candidate({ durationSec: 600 })), { now: NOW });
    expect(long.edit.segments[0]).toMatchObject({ start: 0, end: 15 });
  });
});

describe("business metrics", () => {
  const fulfil = () => detected().find((d) => d.commercialState === "FULFILLMENT_CANDIDATE")!;
  const at = NOW.toISOString();

  it("reports deliverable counts only — no money — when the brief has no package value", () => {
    const m = computeBusinessMetrics([buildView(fulfil(), undefined, undefined)], SPONSOR_BRIEFS);
    expect(m.fulfillment).toHaveLength(1);
    expect(m.fulfillment[0]).toMatchObject({ contracted: 4, publishedBaseline: 3, remaining: 1, openCommitmentAllocation: undefined });
    expect(m.upsell.label).toBe("PROPOSED / NOT SOLD");
  });

  it("an evidenced publication closes the open deliverable and is the only commercially attributed stage", () => {
    const published = buildView(fulfil(), undefined, {
      status: "PUBLISHED",
      approvedAt: at,
      publishedAt: at,
      publishEvidenceUrl: "https://example.com/p",
    });
    const m = computeBusinessMetrics([published], SPONSOR_BRIEFS);
    expect(m.fulfillment[0]).toMatchObject({ publishedViaPulse: 1, remaining: 0, coverage: 1 });
    expect(m.funnel.find((s) => s.key === "COMMERCIALLY_ATTRIBUTED")?.count).toBe(1);
  });

  it("allocates already-signed value over open deliverables only when a package value is entered", () => {
    const priced = SPONSOR_BRIEFS.map((b) => (b.id === "brief-spurs-matchday" ? { ...b, allocatedPackageValue: 10_000, currency: "USD" } : b));
    const m = computeBusinessMetrics([buildView(fulfil(), undefined, undefined)], priced);
    expect(m.fulfillment[0].openCommitmentAllocation).toEqual({ amount: 2_500, currency: "USD" });
  });
});

describe("producer actions re-ask REROUTE", () => {
  beforeEach(() => {
    process.env.PULSE_BOARD_ENABLED = "true";
    useMemoryRepositoriesForTests();
    rmSync(path.join(STATE, ".data"), { recursive: true, force: true });
  });

  it("one rule with the Studio: blocked cannot be approved, demo clearance can never be recorded as published", async () => {
    const { opportunities } = await svc.listOpportunities();
    const id = opportunities[0].id;

    verdict.current = "BLOCKED";
    const sent = await svc.handoff(id, "sp-1");
    expect(sent.opportunity).toMatchObject({ status: "SENT_TO_REROUTE", rightsState: "BLOCKED", gate: "BLOCKED" });
    await expect(svc.act({ id, action: "approve", reviewer: "ed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await svc.getOpportunity(id)).opportunity).toMatchObject({ status: "SENT_TO_REROUTE", rightsState: "BLOCKED" });

    verdict.current = "NEEDS_REVIEW";
    expect(await svc.act({ id, action: "approve", reviewer: "ed" })).toMatchObject({ status: "APPROVED", rightsState: "NEEDS_REVIEW" });

    verdict.current = "ALLOWED";
    await expect(svc.act({ id, action: "publish", evidenceUrl: "https://example.com/p" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("DEMO POLICY"),
    });
    expect((await svc.getOpportunity(id)).opportunity.status).toBe("APPROVED");
  });

  it("rejects a handoff for an asset that is not one of the opportunity's candidates", async () => {
    const { opportunities } = await svc.listOpportunities();
    await expect(svc.handoff(opportunities[0].id, "not-a-candidate")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("objective parser", () => {
  it("turns a plain-language objective into market, product, KPI and what is missing", () => {
    const o = parseObjective("I want to increase jersey sales in Mexico.", NOW);
    expect(o).toMatchObject({
      summary: "Sell jerseys in Mexico",
      market: { code: "MX" },
      product: { key: "jersey" },
      kpi: "Jersey sales in Mexico",
      missing: ["deadline"],
      scope: "MARKET",
      measurement: { status: "NOT_CONNECTED" },
    });
  });

  it("understands French/Spanish wording, accents and deadlines", () => {
    const fr = parseObjective("Augmenter les ventes de maillots au Mexique d'ici fin décembre", NOW);
    expect(fr).toMatchObject({ market: { code: "MX" }, product: { key: "jersey" }, missing: [] });
    expect(fr.deadline?.iso).toBe("2026-12-31T23:59:59.000Z");
    const rel = parseObjective("Grow followers in France within 3 weeks", NOW);
    expect(rel).toMatchObject({ market: { code: "FR" }, product: { key: "followers" } });
    expect(rel.deadline?.iso).toBe(new Date(NOW.getTime() + 21 * 86_400_000).toISOString());
    expect(parseObjective("Vender camisetas en México", NOW)).toMatchObject({ market: { code: "MX" }, product: { key: "jersey" } });
  });

  it("does not read the pronoun 'us' as the United States and reports unknown fields instead of guessing", () => {
    expect(parseObjective("help us sell tickets in Canada", NOW)).toMatchObject({ market: { code: "CA" }, product: { key: "tickets" } });
    const vague = parseObjective("help us do better", NOW);
    expect(vague.market).toBeUndefined();
    expect(vague.missing).toEqual(["market", "product", "deadline"]);
    expect(parseObjective("Tottenham shirts in the US", NOW)).toMatchObject({ club: "tottenham", market: { code: "US" } });
  });

  it("makes a sponsor objective explicit: the partner the goal names is the target sponsor, never a search term", () => {
    expect(parseObjective("Promote our partner AIA with Solanke's late goal for UK fans", NOW)).toMatchObject({
      summary: "Promote AIA in United Kingdom",
      product: { key: "sponsor", label: "Sponsor activation" },
      targetSponsor: "AIA",
      market: { code: "GB" },
    });
    // Named without the word "sponsor": still a sponsor activation (Kraken is a partner only in another package).
    expect(parseObjective("Promote Kraken with fans in the UK", NOW)).toMatchObject({ summary: "Promote Kraken in United Kingdom", product: { key: "sponsor" }, targetSponsor: "Kraken" });
    expect(parseObjective("Feature our partner Heineken for UK fans", NOW).targetSponsor).toBe("Heineken");
    // No partner named: an explicit activation without a target — the brand rules apply literally.
    expect(parseObjective("Activate our sponsor with Solanke's late goal for UK fans", NOW)).toMatchObject({ summary: "Run a sponsor activation in United Kingdom", targetSponsor: null });
    expect(parseObjective("Promote Tottenham merchandise to UK supporters", NOW)).toMatchObject({ product: { key: "merch" }, targetSponsor: null });
    expect(parseObjective("Promote Solanke's goal to UK fans", NOW).targetSponsor).toBeNull();
    expect(parseObjective("Build a Wembanyama-led Ledger sponsor campaign", NOW)).toMatchObject({ targetSponsor: "Ledger", product: { key: "sponsor" } });
    expect(parseObjective("Our sponsor campaign for UK fans", NOW).targetSponsor).toBeNull();
  });
});

describe("market signal analyzer", () => {
  it("flags a regional spike that is small globally as under the radar", () => {
    const a = analyzeMarket("spurs-harper-run", "MX")!;
    expect(a).toMatchObject({ momentum: "HIGH", globalInterest: "LOW", underTheRadar: true, confidence: "HIGH", mode: "FIXTURE" });
    expect(a.lift).toBeCloseTo(460 / 55, 2);
    expect(a.shareNow).toBeGreaterThan(2 * a.shareUsual);
  });

  it("does not call a globally big topic with a usual local level a hidden opportunity", () => {
    expect(analyzeMarket("spurs-bench-dunk", "MX")).toMatchObject({ globalInterest: "HIGH", momentum: "LOW", underTheRadar: false });
  });

  it("returns nothing (no estimate) when the source has no data for the market", () => {
    expect(analyzeMarket("spurs-harper-run", "DE")).toBeUndefined();
  });

  it("needs both lift and significance for momentum; small samples are low confidence", () => {
    expect(momentumLevel(3, 1.5)).toBe("NONE");
    expect(momentumLevel(2.5, 4)).toBe("HIGH");
    expect(momentumLevel(1.5, 2.5)).toBe("MEDIUM");
    expect(shiftConfidence(20, 10)).toBe("LOW");
  });
});

describe("objective ranker", () => {
  const objective = parseObjective("I want to increase jersey sales in Mexico.", NOW);
  const media = (durationSec: number): MediaLookup => ({
    status: "FOUND",
    searchedAt: NOW.toISOString(),
    intelligence: { status: "NOT_INDEXED", message: "m" },
    attempts: [],
    candidates: [candidate({ durationSec })],
  });
  const fitted = (id: string, durationSec: number, ledger?: LedgerEntry) => {
    const v = buildView(detected().find((d) => d.id === id)!, media(durationSec), ledger);
    return { ...v, market: marketFit(v, objective, analyzeMarket(v.signal.topic, "MX")) };
  };

  it("ranks the under-the-radar Mexico topic above the globally bigger, editorially stronger one", () => {
    const harper = fitted("opp-spurs-harper-run", 30);
    const bench = fitted("opp-spurs-bench-dunk", 14);
    expect(bench.score.priority).toBeGreaterThan(harper.score.priority);
    expect(harper.market.label).toBe("STRONG");
    expect(rankOpportunities([bench, harper]).map((v) => v.id)).toEqual(["opp-spurs-harper-run", "opp-spurs-bench-dunk"]);
    expect(harper.market.why).toMatch(/global totals hide/);
    expect(harper.market.nextAction).toMatch(/territory MX/);
  });

  it("never lets market fit lift a BLOCKED item above a clearable one", () => {
    const blocked = fitted("opp-spurs-harper-run", 30, {
      status: "SENT_TO_REROUTE",
      rights: {
        state: "BLOCKED",
        checkedAt: NOW.toISOString(),
        scoreplayAssetId: "sp-1",
        policyId: "p",
        policyVersion: "1",
        policyFictional: true,
        reasons: [],
        missingFacts: [],
      },
    });
    const weak = fitted("opp-spurs-team-win", 71);
    expect(rankOpportunities([blocked, weak]).map((v) => v.id)).toEqual(["opp-spurs-team-win", "opp-spurs-harper-run"]);
  });

  it("reports missing market data and other-club content honestly", () => {
    const v = buildView(detected().find((d) => d.id === "opp-spurs-harper-run")!, media(30), undefined);
    const de = marketFit(v, parseObjective("jersey sales in Germany", NOW), undefined);
    expect(de).toMatchObject({ label: "NO_MARKET_DATA", localInterest: 0 });
    const thfc = marketFit(v, parseObjective("Tottenham jersey sales in Mexico", NOW), analyzeMarket("spurs-harper-run", "MX"));
    expect(thfc.objectiveFit).toBe(0);
  });

  it("targets the objective's market as the REROUTE territory on handoff", () => {
    const v = fitted("opp-spurs-harper-run", 30);
    const { intent, rerouteUrl } = handoffToReroute(buildHandoff(v, v.media!.candidates[0]), { territory: "MX", now: NOW });
    expect(intent.territory).toBe("MX");
    expect(new URL(rerouteUrl, "http://x").searchParams.get("territory")).toBe("MX");
  });
});

describe("objective lifecycle", () => {
  beforeEach(() => {
    process.env.PULSE_BOARD_ENABLED = "true";
    useMemoryRepositoriesForTests();
    rmSync(path.join(STATE, ".data"), { recursive: true, force: true });
  });

  it("sets, applies to handoff, and clears the active objective; rejects an objective with no market or product", async () => {
    await svc.refresh({ objective: "I want to increase jersey sales in Mexico." });
    const { objective, opportunities } = await svc.listOpportunities();
    expect(objective?.summary).toBe("Sell jerseys in Mexico");
    expect(opportunities.every((o) => o.market)).toBe(true);

    const sent = await svc.handoff(opportunities[0].id, "sp-1");
    expect(sent.opportunity.ledger.handoff).toMatchObject({ intent: { territory: "MX" }, objective: "Sell jerseys in Mexico" });

    await expect(svc.refresh({ objective: "do better" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await svc.refresh({ objective: null });
    const cleared = await svc.listOpportunities();
    expect(cleared.objective).toBeUndefined();
    expect(cleared.opportunities.some((o) => o.market)).toBe(false);
  });
});

describe("campaign proposals through the service", () => {
  const HARPER = "opp-spurs-harper-run";
  beforeEach(() => {
    process.env.PULSE_BOARD_ENABLED = "true";
    useMemoryRepositoriesForTests();
    rmSync(path.join(STATE, ".data"), { recursive: true, force: true });
  });

  it("ranks presets differently, drafts for the active objective, and takes rights only from REROUTE", async () => {
    await svc.refresh({ objective: "I want to increase jersey sales in Mexico." });
    const { comparison } = await svc.listOpportunities();
    expect(comparison.map((c) => c.objective)).toEqual(["Sell jerseys in Mexico", "Maximize engagement globally"]);
    expect(comparison[0].ranked[0].id).toBe(HARPER);
    expect(comparison[1].ranked[0].id).toBe("opp-spurs-bench-dunk");

    const { campaign } = await svc.draftCampaign({ id: HARPER, action: "draftCampaign", scoreplayAssetId: "sp-1" });
    expect(campaign).toMatchObject({
      objective: { summary: "Sell jerseys in Mexico" },
      audience: { market: { code: "MX" }, language: "es" },
      cta: { status: "NOT_CONFIGURED" },
      rerouteIntent: { territory: "MX" },
      rights: { state: "NOT_CHECKED", source: "REROUTE" },
    });
    // Persisted through the repository and returned with the opportunity.
    expect((await svc.getOpportunity(HARPER)).campaign?.id).toBe(campaign.id);

    verdict.current = "NEEDS_REVIEW";
    await svc.handoff(HARPER, "sp-1");
    expect((await svc.getOpportunity(HARPER)).campaign?.rights).toMatchObject({ state: "NEEDS_REVIEW", matchesDraft: true });
    verdict.current = "BLOCKED";
    await svc.act({ id: HARPER, action: "recheck" });
    await expect(svc.act({ id: HARPER, action: "approve", reviewer: "smm" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    verdict.current = "ALLOWED";
    await svc.act({ id: HARPER, action: "recheck" });
    expect((await svc.getOpportunity(HARPER)).campaign?.rights.state).toBe("ALLOWED");
  });

  it("uses a producer-entered https store URL; rejects one for objectives without commerce and drafts without an objective", async () => {
    await expect(svc.draftCampaign({ id: HARPER, action: "draftCampaign", scoreplayAssetId: "sp-1" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await svc.refresh({ objective: "Sell jerseys in Mexico" });
    const { campaign } = await svc.draftCampaign({
      id: HARPER,
      action: "draftCampaign",
      scoreplayAssetId: "sp-1",
      commerceUrl: "https://store.example.com/mx",
    });
    expect(campaign.cta).toMatchObject({ status: "READY", destination: { source: "PRODUCER_ENTERED" } });

    await svc.refresh({ objective: "Maximize global engagement" });
    await expect(
      svc.draftCampaign({ id: HARPER, action: "draftCampaign", scoreplayAssetId: "sp-1", commerceUrl: "https://store.example.com" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await svc.getOpportunity(HARPER)).campaign?.stale).toBe(true);
  });

  it("is unreachable when the board is disabled", async () => {
    delete process.env.PULSE_BOARD_ENABLED;
    const res = await opportunitiesRoute.POST(
      new Request("http://x/api/pulse/opportunities", {
        method: "POST",
        body: JSON.stringify({ id: HARPER, action: "draftCampaign", scoreplayAssetId: "sp-1" }),
      }),
    );
    expect(res.status).toBe(404);
    process.env.PULSE_BOARD_ENABLED = "true";
    expect((await svc.getOpportunity(HARPER)).campaign).toBeUndefined();
  });
});
