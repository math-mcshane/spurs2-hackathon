import { describe, expect, it } from "vitest";
import { buildCampaignDraft, campaignView, X_CHAR_LIMIT, type DraftInput } from "../campaign-builder";
import { configuredDestination } from "../commerce";
import { detectOpportunities } from "../detect-opportunities";
import { analyzeMarket } from "../market-signals";
import { parseObjective } from "../objective-parser";
import { marketFit } from "../objective-ranker";
import { buildView, rankOpportunities } from "../rank-opportunities";
import { SPONSOR_BRIEFS, fixtureSignals } from "../signal-adapter";
import type { LedgerEntry, MediaCandidate, MediaLookup, OpportunityView, ParsedObjective } from "../types";

const NOW = new Date("2026-10-17T22:00:00Z");
const MX_JERSEYS = parseObjective("Sell jerseys in Mexico", NOW);
const GLOBAL_ENGAGEMENT = parseObjective("Maximize global engagement", NOW);

const clip = (id: string, durationSec: number, over: Partial<MediaCandidate> = {}): MediaCandidate => ({
  scoreplayAssetId: id,
  title: `${id}.mp4`,
  kind: "video",
  durationSec,
  foundBy: "SCOREPLAY_METADATA_FALLBACK",
  discoveredBy: "PLAYER_TAG",
  origin: "LIVE",
  ...over,
});
const lookup = (...candidates: MediaCandidate[]): MediaLookup => ({
  status: "FOUND",
  searchedAt: NOW.toISOString(),
  intelligence: { status: candidates.some((c) => c.foundBy === "TWELVELABS") ? "MOMENTS_FOUND" : "NOT_INDEXED", message: "m" },
  attempts: [],
  candidates,
});

/** Fixture opportunities with real-shaped media, scored for `objective` like the service does. */
function views(objective: ParsedObjective, ledger: Record<string, LedgerEntry> = {}): OpportunityView[] {
  const media: Record<string, MediaLookup> = {
    "opp-spurs-harper-run": lookup(clip("130907177", 30), clip("130907287", 28)),
    "opp-spurs-bench-dunk": lookup(clip("130907679", 14)),
    "opp-spurs-drops-sabonis": lookup(clip("130907646", 9)),
    "opp-spurs-team-win": lookup(clip("130907170", 71)),
    "opp-tottenham-defensive-wall": lookup(
      clip("130851361", 6334, { foundBy: "TWELVELABS", discoveredBy: "TEAM_TAG", startSeconds: 903.8, endSeconds: 912.6, rank: 1, query: "defender block" }),
    ),
    "opp-tottenham-rdz-fernandes": lookup(clip("130851383", 48)),
  };
  const detected = detectOpportunities(fixtureSignals(), SPONSOR_BRIEFS, { now: NOW, replayClock: NOW }, NOW.toISOString());
  return rankOpportunities(
    detected.map((o) => {
      const v = buildView(o, media[o.id], ledger[o.id]);
      const scope = objective.market?.code ?? (objective.scope === "GLOBAL" ? "GLOBAL" : undefined);
      return { ...v, market: marketFit(v, objective, scope && analyzeMarket(o.signal.topic, scope)) };
    }),
  );
}
const find = (vs: OpportunityView[], id: string) => vs.find((v) => v.id === id)!;
const draftFor = (objective: ParsedObjective, id: string, over: Partial<DraftInput> = {}) => {
  const view = find(views(objective), id);
  const brief = SPONSOR_BRIEFS.find((b) => b.id === view.sponsorBriefId);
  return buildCampaignDraft({ view, objective, candidate: view.media!.candidates[0], brief, now: NOW, ...over });
};

/** Claims a draft must never make: stock/availability, urgency, sales, nationality of a player. */
const FORBIDDEN =
  /\b(in stock|available now|limited|sold out|last chance|hurry|disponible|agotad[oa]|últimas|derniers?|guaranteed|mexican[oa]?s?|mexicain[e]?s?)\b/i;

describe("objective-dependent ranking", () => {
  it("parses a global engagement objective as GLOBAL scope with platform-native measurement", () => {
    expect(GLOBAL_ENGAGEMENT).toMatchObject({
      scope: "GLOBAL",
      product: { key: "engagement" },
      measurement: { status: "PLATFORM_NATIVE" },
      missing: ["deadline"],
    });
    expect(MX_JERSEYS.measurement.status).toBe("NOT_CONNECTED");
  });

  it("ranks the same footage differently for 'Sell jerseys in Mexico' and 'Maximize global engagement'", () => {
    const mx = views(MX_JERSEYS).map((v) => v.id);
    const global = views(GLOBAL_ENGAGEMENT).map((v) => v.id);
    expect(mx[0]).toBe("opp-spurs-harper-run");
    expect(global[0]).toBe("opp-spurs-bench-dunk");
    expect(global.indexOf("opp-spurs-harper-run")).toBeGreaterThan(global.indexOf("opp-spurs-bench-dunk"));
  });

  it("explains global scores by volume and momentum, not by a market", () => {
    const bench = find(views(GLOBAL_ENGAGEMENT), "opp-spurs-bench-dunk").market!;
    expect(bench.analysis?.market.code).toBe("GLOBAL");
    expect(bench.why).toMatch(/Worldwide conversation/);
    expect(bench.notes.localInterest).toMatch(/top-topic volume/);
  });

  it("scores a TwelveLabs moment above ScorePlay metadata-only footage", () => {
    const vs = views(GLOBAL_ENGAGEMENT);
    const moment = find(vs, "opp-tottenham-defensive-wall").market!;
    expect(moment.mediaAvailability).toBe(100);
    expect(moment.notes.mediaAvailability).toMatch(/TwelveLabs found a matching moment/);
    expect(find(vs, "opp-spurs-bench-dunk").market!.mediaAvailability).toBe(80); // 14 s clip, metadata only
    expect(find(vs, "opp-spurs-team-win").market!.mediaAvailability).toBe(60); // 71 s clip, metadata only
  });
});

describe("campaign proposal builder", () => {
  it("drafts a localized Mexico jersey proposal on real footage, targeting REROUTE territory MX", () => {
    const d = draftFor(MX_JERSEYS, "opp-spurs-harper-run");
    expect(d.objective).toMatchObject({ summary: "Sell jerseys in Mexico", measurement: { status: "NOT_CONNECTED" } });
    expect(d.audience).toMatchObject({ scope: "MARKET", market: { code: "MX" }, language: "es" });
    expect(d.audience.basis).toMatch(/never inferred from language|nobody's location is inferred from language/);
    expect(d.media).toMatchObject({ scoreplayAssetId: "130907177", startSeconds: 0, endSeconds: 15 });
    expect(d.rerouteIntent.territory).toBe("MX");
    expect(d.channels.map((c) => c.channel)).toEqual(["instagram", "facebook", "x"]);
    expect(d.channels[0].copy).toContain("La racha de 14 puntos de Harper");
    expect(d.evidenceLabels.join(" ")).toMatch(/SIMULATED/);
  });

  it("withholds the commerce CTA and says so when no store URL is configured", () => {
    const d = draftFor(MX_JERSEYS, "opp-spurs-harper-run");
    expect(d.cta).toMatchObject({ status: "NOT_CONFIGURED", note: expect.stringMatching(/No club-configured store link .*https link on the club's own domain/) });
    for (const c of d.channels) {
      expect(c.copy).not.toContain(d.cta.text);
      expect(c.copy).not.toMatch(/https?:\/\//);
    }
  });

  it("links only to the configured/entered destination; Instagram uses link in bio; X counts links as 23", () => {
    const url = `https://store.example.com/mx/jerseys/${"x".repeat(80)}`;
    const d = draftFor(MX_JERSEYS, "opp-spurs-harper-run", { destination: { kind: "store", url, source: "PRODUCER_ENTERED" } });
    const [ig, fb, x] = d.channels;
    expect(d.cta.status).toBe("READY");
    expect(ig.copy).not.toContain(url);
    expect(ig.copy).toMatch(/link in bio/);
    expect(fb.copy).toContain(url);
    expect(x.characterCount).toBe(x.copy.length - url.length + 23);
    expect(x.characterCount).toBeLessThanOrEqual(X_CHAR_LIMIT);
  });

  it("never claims stock, urgency or a player's nationality in any copy", () => {
    for (const objective of [MX_JERSEYS, GLOBAL_ENGAGEMENT, parseObjective("Vendre des maillots en France", NOW)]) {
      for (const v of views(objective)) {
        const d = buildCampaignDraft({
          view: v,
          objective,
          candidate: v.media!.candidates[0],
          destination: { kind: "store", url: "https://store.example.com", source: "CONFIGURED" },
          now: NOW,
        });
        for (const c of d.channels) expect(c.copy).not.toMatch(FORBIDDEN);
      }
    }
  });

  it("global engagement: English copy, no commerce link, platform-native KPI, default territory", () => {
    const d = draftFor(GLOBAL_ENGAGEMENT, "opp-spurs-bench-dunk");
    expect(d.audience).toMatchObject({ scope: "GLOBAL", language: "en" });
    expect(d.cta.status).toBe("NOT_APPLICABLE");
    expect(d.objective.measurement.note).toMatch(/not evidence of purchase intent/);
    expect(d.rerouteIntent.territory).toBe("FR"); // the matchday brief's territory; a global post has no single territory
  });

  it("flags copy that could not be localized instead of pretending", () => {
    const d = draftFor(parseObjective("Sell jerseys in Germany", NOW), "opp-spurs-harper-run");
    expect(d.audience.language).toBe("de");
    expect(d.creative.hookLanguage).toBe("en");
    expect(d.evidenceLabels).toContain("Copy not localized for German — translate before use");
  });

  it("keeps TwelveLabs timecodes as the proposed cut", () => {
    const d = draftFor(GLOBAL_ENGAGEMENT, "opp-tottenham-defensive-wall");
    expect(d.media).toMatchObject({ startSeconds: 903.8, endSeconds: 912.6, foundBy: "TWELVELABS" });
    expect(d.rationale.join(" ")).toMatch(/TwelveLabs moment #1 for “defender block”/);
  });
});

describe("campaign rights come only from REROUTE", () => {
  const d = draftFor(MX_JERSEYS, "opp-spurs-harper-run");
  const verdict = (state: "ALLOWED" | "NEEDS_REVIEW") => ({
    state,
    checkedAt: NOW.toISOString(),
    scoreplayAssetId: d.media.scoreplayAssetId,
    policyId: "p",
    policyVersion: "1",
    policyFictional: true,
    reasons: [],
    missingFacts: [],
  });
  const sent = (territory: string, start = d.media.startSeconds): LedgerEntry => ({
    status: "SENT_TO_REROUTE",
    handoff: {
      at: NOW.toISOString(),
      scoreplayAssetId: d.media.scoreplayAssetId,
      edit: { id: "e", title: "t", derived: false, segments: [{ scoreplayMediaId: d.media.scoreplayAssetId, start, end: d.media.endSeconds }] },
      intent: { ...d.rerouteIntent, territory },
      rerouteUrl: "/",
    },
    rights: verdict("ALLOWED"),
  });

  it("is NOT_CHECKED until REROUTE has checked this exact asset, cut and territory", () => {
    expect(campaignView(d, { status: "DETECTED" }, MX_JERSEYS).rights).toMatchObject({ state: "NOT_CHECKED", source: "REROUTE" });
    expect(campaignView(d, sent("FR"), MX_JERSEYS).rights).toMatchObject({ state: "NOT_CHECKED", matchesDraft: false });
    expect(campaignView(d, sent("MX", 3), MX_JERSEYS).rights.state).toBe("NOT_CHECKED");
    expect(campaignView(d, sent("MX"), MX_JERSEYS).rights).toMatchObject({ state: "ALLOWED", matchesDraft: true, source: "REROUTE" });
  });

  it("marks a draft stale when the active objective changes", () => {
    expect(campaignView(d, { status: "DETECTED" }, MX_JERSEYS).stale).toBe(false);
    expect(campaignView(d, { status: "DETECTED" }, GLOBAL_ENGAGEMENT).stale).toBe(true);
  });
});

describe("commerce destinations", () => {
  const raw = "spurs:jersey:*=https://store.example.com/all;spurs:jersey:MX=https://store.example.com/mx;spurs:tickets:MX=http://insecure.example";
  it("prefers the exact market, falls back to *, and ignores non-https entries", () => {
    expect(configuredDestination("spurs", "jersey", "store", "MX", raw)?.url).toBe("https://store.example.com/mx");
    expect(configuredDestination("spurs", "jersey", "store", "FR", raw)?.url).toBe("https://store.example.com/all");
    expect(configuredDestination("spurs", "tickets", "ticketing", "MX", raw)).toBeUndefined();
    expect(configuredDestination("tottenham", "jersey", "store", "MX", raw)).toBeUndefined();
  });
});
