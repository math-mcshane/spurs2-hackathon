import { describe, expect, it, vi } from "vitest";
import type { Asset } from "@/lib/contracts";
import { BUNDLED_POLICIES } from "@/lib/rights";
import { goalIntents, goalPlan } from "../goal-intents";
import { buildGoalView } from "../goal-view";
import { parseObjective } from "../objective-parser";
import { ScorePlayDiscoveryError } from "../server/scoreplay-discovery";
import {
  photoCandidate,
  photoRights,
  photoSummary,
  rankPhotos,
  suggestPhotos,
  type MomentContext,
  type PhotoCandidate,
  type PhotoDeps,
  type PhotoSummary,
} from "../server/photo-suggestions";
import { GoalRunSchema, GoalViewSchema, PhotoSuggestionSchema, type Recommendation } from "../types";

const NOW = new Date("2026-10-22T12:00:00Z");
const MERCH = parseObjective("Promote Tottenham merchandise to UK supporters", NOW);
const INTENTS = goalIntents(MERCH, "football");
const PLAN = goalPlan(MERCH, "tottenham");
const MATCH = "Manchester United vs Tottenham Hotspur - Week 6";

const candidate = (id: string, over: Partial<PhotoCandidate>): PhotoCandidate => ({
  id,
  filename: `PC1_${id}.JPG`,
  playerIds: [],
  people: [],
  orientation: "LANDSCAPE",
  event: { label: `${MATCH} · Match`, match: MATCH },
  ...over,
});

const SOLANKE = "Dominic Ayodele Solanke-Mitchell";
const MOMENTS: MomentContext[] = [
  { index: 1, people: [SOLANKE], playerIds: [736001], match: MATCH },
  { index: 2, people: [], playerIds: [], match: MATCH },
];

describe("photo ranking (ScorePlay metadata only)", () => {
  const photos = [
    candidate("1", { caption: "Antonín Kinský of Tottenham Hotspur during the pre-match warm up", people: ["Antonín Kinský"] }),
    candidate("2", { caption: "The match shirt of Micky van de Ven of Tottenham Hotspur in the away dressing room", people: ["Micky van de Ven"] }),
    candidate("3", { caption: "Tottenham Hotspur fans celebrate the full-time result" }),
    candidate("4", { caption: "Tottenham Hotspur fans celebrate the full-time result" }), // sequence shot: same caption
    candidate("5", {
      caption: "Dominic Solanke of Tottenham Hotspur celebrates scoring a goal for their side to make it 1-1",
      people: [SOLANKE],
      playerIds: [736001],
      orientation: "PORTRAIT",
    }),
    candidate("6", { caption: "Sandro Tonali of Tottenham Hotspur battles in the air", people: ["Sandro Tonali"] }),
  ];

  it("orders by goal fit, one per caption, a different leading intent per pick, with plain-language reasons", () => {
    const ranked = rankPhotos(photos, INTENTS, MOMENTS);
    expect(ranked.map((r) => r.photo.id)).toEqual(["5", "3", "2"]);
    expect(ranked.map((r) => r.matchReason)).toEqual([
      `Caption mentions a celebration; tagged ${SOLANKE}, who also appears in moment 01; same match as moment 01; portrait, suits a vertical social post.`,
      "Caption mentions supporters and a celebration; same match as moment 01.",
      "Caption mentions a match shirt; same match as moment 01; tagged Micky van de Ven.",
    ]);
  });

  it("never suggests a photo without a caption cue or a person shared with a moment", () => {
    const ranked = rankPhotos([photos[0], photos[5]], INTENTS, MOMENTS);
    expect(ranked).toEqual([]);
  });
});

// ---------- End to end on fake ScorePlay reads, real engine ----------

const photoAsset = (id: string, caption: string, opts: { people?: string[]; playerIds?: number[]; portrait?: boolean } = {}): Asset => ({
  id,
  title: `CK1_${id}.JPG`,
  kind: "image",
  thumbnailUrl: `https://cdn.example/${id}/thumb.jpg`,
  previewUrl: `https://cdn.example/${id}/compressed.jpg`,
  // As on the real Tottenham photos: the demo policy's provenance tag is present.
  tags: ["Tottenham Hotspur", "Premier League", "partner content", opts.portrait ? "Portrait" : "Landscape", opts.portrait ? "3762x5643" : "6000x4000"],
  facts: {
    competition: "Premier League",
    team: "Tottenham Hotspur",
    teams: ["Tottenham Hotspur"],
    people: opts.people ?? [],
    peopleTeams: Object.fromEntries((opts.people ?? []).map((p) => [p, ["Tottenham Hotspur"]])),
  },
  metadata: {
    scoreplayId: Number(id),
    description: caption,
    event: { id: 1536114, name: "Match", fullPath: `/1536121:Premier League/1536112:${MATCH}` },
    playerIds: opts.playerIds ?? [],
  },
  origin: "LIVE",
});

const VIDEO: Asset = {
  id: "901",
  title: "Solanke goal.mp4",
  kind: "video",
  tags: ["Tottenham Hotspur"],
  facts: { people: [SOLANKE] },
  metadata: { playerIds: [736001], event: { id: 1536118, name: "Match", fullPath: `/1536121:Premier League/1536112:${MATCH}` } },
  origin: "LIVE",
};

const ASSETS: Record<string, Asset> = {
  "901": VIDEO,
  "11": photoAsset("11", "Dominic Solanke of Tottenham Hotspur celebrates scoring a goal for their side to make it 1-1", { people: [SOLANKE], playerIds: [736001], portrait: true }),
  "12": photoAsset("12", "Tottenham Hotspur fans celebrate the full-time result"),
  "13": photoAsset("13", "The match shirt of Sandro Tonali of Tottenham Hotspur in the away dressing room", { people: ["Sandro Tonali"], playerIds: [736002] }),
  "14": photoAsset("14", "Sandro Tonali of Tottenham Hotspur battles in the air", { people: ["Sandro Tonali"], playerIds: [736002] }),
};

const summaryOf = (a: Asset): PhotoSummary =>
  photoSummary({ ID: Number(a.id), name: a.title, type: "photo", description: a.metadata.description as string, player_ids: a.metadata.playerIds as number[], event_id: 1536114 });

function fakeDeps(over: Partial<PhotoDeps> = {}): PhotoDeps {
  return {
    listPhotos: vi.fn(async () => ["11", "12", "13", "14"].map((id) => summaryOf(ASSETS[id]))),
    getAsset: vi.fn(async (id: string) => {
      if (!ASSETS[id]) throw new Error(`no asset ${id}`);
      return ASSETS[id];
    }),
    humanObservations: vi.fn(async () => []),
    now: () => NOW,
    ...over,
  };
}

const input = () => ({
  club: "tottenham" as const,
  objective: MERCH,
  plan: PLAN,
  moments: Promise.resolve([{ candidate: { scoreplayAssetId: "901" } } as Recommendation]),
  policies: Promise.resolve(BUNDLED_POLICIES),
});

describe("suggestPhotos", () => {
  it("returns ≤3 real photos with metadata, reasons and REROUTE verdicts — only the thumbnail URL, never the full image", async () => {
    const deps = fakeDeps();
    const result = await suggestPhotos(input(), deps);
    expect(result.photos.map((p) => p.scoreplayMediaId)).toEqual(["11", "12", "13"]);
    expect(result.note).toBeUndefined();
    expect(result.attempt).toMatchObject({ service: "ScorePlay", outcome: "OK", detail: "4 photo(s) listed · 3 read in full · 3 suggested" });
    for (const p of result.photos) expect(PhotoSuggestionSchema.safeParse(p).success).toBe(true);
    expect(result.photos[0]).toMatchObject({
      filename: "CK1_11.JPG",
      people: [SOLANKE],
      event: `${MATCH} · Match`,
      orientation: "PORTRAIT",
      matchReason: expect.stringContaining(`tagged ${SOLANKE}, who also appears in moment 01`),
    });
    // Only the ScorePlay thumbnail travels (the API boundary strips it unless the caller may see media).
    expect(result.photos.map((p) => p.thumbnailUrl)).toEqual(["11", "12", "13"].map((id) => `https://cdn.example/${id}/thumb.jpg`));
    expect(JSON.stringify(result)).not.toMatch(/previewUrl|compressed/i);
    // The non-matching photo (no caption cue, nobody from the moments) is never read in full.
    expect(deps.getAsset).not.toHaveBeenCalledWith("14");
  });

  it("the engine says NEEDS_REVIEW for every COMMERCIAL use, because the photo was not analysed", async () => {
    const { photos } = await suggestPhotos(input(), fakeDeps());
    for (const p of photos) {
      expect(p.rights).toMatchObject({ verdict: "NEEDS_REVIEW", clearance: "NONE", allowedUses: 0, totalUses: 3 });
      expect(p.rights.reason).toMatch(/not analysed/);
    }
    const direct = photoRights(ASSETS["12"], [], PLAN, BUNDLED_POLICIES, NOW);
    expect(PLAN.usage).toBe("COMMERCIAL");
    expect(direct.verdict).toBe("NEEDS_REVIEW");
    expect(direct.reason).toContain("photos are not analysed by video intelligence");
  });

  it("degrades to no photos with a note when the library cannot be read, and never rejects", async () => {
    const down = fakeDeps({ listPhotos: vi.fn(async () => Promise.reject(new ScorePlayDiscoveryError("UPSTREAM_UNAVAILABLE", "ScorePlay POST /media/search: network error"))) });
    const result = await suggestPhotos(input(), down);
    expect(result.photos).toEqual([]);
    expect(result.note).toMatch(/could not be read from ScorePlay/);
    expect(result.attempt).toMatchObject({ outcome: "ERROR", code: "UPSTREAM_UNAVAILABLE" });

    const noMoments = await suggestPhotos({ ...input(), moments: Promise.reject(new Error("search failed")) }, fakeDeps());
    expect(noMoments.photos.length).toBeGreaterThan(0);
  });

  it("orientation and event come from ScorePlay tags and the event folder", () => {
    const c = photoCandidate(summaryOf(ASSETS["11"]), ASSETS["11"]);
    expect(c).toMatchObject({ orientation: "PORTRAIT", event: { label: `${MATCH} · Match`, match: MATCH }, people: [SOLANKE] });
  });

  it("the goal view carries the photos and still satisfies GoalViewSchema", async () => {
    const { photos } = await suggestPhotos(input(), fakeDeps());
    const run = GoalRunSchema.parse({
      id: "goal-photos",
      schemaVersion: 2,
      club: "tottenham",
      submittedAt: NOW.toISOString(),
      resultsAt: NOW.toISOString(),
      objective: MERCH,
      plan: PLAN,
      intents: INTENTS,
      library: { videos: 0, indexed: 0 },
      search: { status: "NO_MATCHING_MOMENT", message: "none" },
      attempts: [],
      pool: [],
      photos,
    });
    const view = buildGoalView(run, { version: 1 });
    expect(view.photos).toHaveLength(3);
    expect(GoalViewSchema.safeParse(JSON.parse(JSON.stringify(view))).success).toBe(true);
    expect(buildGoalView({ ...run, photos: undefined }, { version: 1 }).photos).toEqual([]);
  });
});
