import { describe, expect, it, vi } from "vitest";
import type { Asset, MediaRef } from "@/lib/contracts";
import { goalTerms, rankMoments, type LinkedVideo } from "../moment-ranking";
import { parseObjective } from "../objective-parser";
import { filterByPlayer } from "../server/goal-search";
import type { DiscoveredVideo, ScorePlayHttp } from "../server/scoreplay-discovery";
import type { GoalIntent } from "../types";

const asset = (id: string, title: string): Asset => ({ id, title, kind: "video", durationSec: 30, tags: [], facts: {}, metadata: {}, origin: "LIVE" });
const ref = (id: string): MediaRef => ({ scoreplayMediaId: id, twelvelabsVideoId: `tl-${id}`, method: "FILENAME_DURATION", candidates: [], checkedAt: "2026-10-23T00:00:00Z" });
const link = (id: string, title: string): LinkedVideo => ({ asset: asset(id, title), discoveredBy: "TEAM_TAG", media: ref(id) });
const intent: GoalIntent = { key: "celebration", label: "Celebration", query: "players celebrating a goal together", weight: 1, why: "why" };

describe("goalTerms", () => {
  it("keeps the goal's distinctive words, drops club, market, product and filler words", () => {
    expect(goalTerms("Activate our sponsor with Solanke's late goal for UK fans", ["Tottenham Hotspur", "uk", "sponsor"])).toEqual(["solanke", "late", "goal"]);
    expect(goalTerms("Promote Tottenham merchandise to UK supporters", ["Tottenham Hotspur", "uk", "merchandise"])).toEqual([]);
  });
});

describe("rankMoments — the club's own title naming the goal", () => {
  const links = new Map([
    ["tl-slomo", link("slomo", "Goal Slo Mo Man United 9x16 (A) v1.mp4")],
    ["tl-late", link("late", "solanke late goal.mp4")],
    ["tl-slide", link("slide", "Slide 1 - Goal.mov")],
  ]);
  const results = [
    {
      intent,
      moments: [
        { videoId: "tl-slomo", start: 14.8, end: 20.2, rank: 1 },
        { videoId: "tl-slide", start: 0, end: 10, rank: 3 },
        { videoId: "tl-late", start: 9.1, end: 19.7, rank: 8 },
      ],
    },
  ];
  const objective = parseObjective("Activate our sponsor with Solanke's late goal for UK fans", new Date("2026-10-23T00:00:00Z"));

  it("boosts a title that names ≥ 2 of the goal's words and says why; one shared word ('goal') is no evidence", () => {
    const pool = rankMoments(results, links, { objective, goalTerms: ["solanke", "late", "goal"] });
    const late = pool.find((r) => r.candidate.scoreplayAssetId === "late")!;
    const slide = pool.find((r) => r.candidate.scoreplayAssetId === "slide")!;
    expect(late.breakdown.contextFactor).toBe(2);
    expect(late.breakdown.notes.context).toMatch(/title names what the goal asks for \(solanke, late, goal\) \(×2\)/);
    expect(slide.breakdown.contextFactor).toBe(1);
    // The moment itself is still TwelveLabs' (rank and exact boundaries unchanged).
    expect(late.candidate).toMatchObject({ startSeconds: 9.1, endSeconds: 19.7, rank: 8 });
  });

  it("without goal words the ranking is search relevance only", () => {
    const pool = rankMoments(results, links, { objective });
    expect(pool.every((r) => r.breakdown.contextFactor === 1)).toBe(true);
    expect(pool.at(-1)!.candidate.scoreplayAssetId).toBe("late");
  });
});

describe("filterByPlayer — ScorePlay player tag", () => {
  const videos: DiscoveredVideo[] = ["101", "102", "103"].map((id) => ({ asset: asset(id, `clip ${id}.mp4`), discoveredBy: "TEAM_TAG" }));
  const http = (players: { ID: number; full_name: string }[], taggedIds: number[]): ScorePlayHttp => ({
    apiKey: "test",
    fetch: vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      const body = path.endsWith("/tag/search") ? { players, tags: [] } : { media: taggedIds.map((ID) => ({ ID, type: "video", name: `clip ${ID}.mp4` })), count: taggedIds.length, total_pages: 1 };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch,
  });

  it("restricts the library to the videos ScorePlay tags with the one player the goal names", async () => {
    const r = await filterByPlayer(http([{ ID: 7, full_name: "Dominic Ayodele Solanke-Mitchell" }], [101, 103]), videos, "Activate our sponsor with Solanke's late goal", ["Tottenham Hotspur"]);
    expect(r.videos.map((v) => v.asset.id)).toEqual(["101", "103"]);
    expect(r.filter).toEqual({ requested: "Dominic Ayodele Solanke-Mitchell", status: "APPLIED", videos: 2 });
  });

  it("an ambiguous or unknown name leaves the library unfiltered", async () => {
    const two = http([{ ID: 7, full_name: "Dominic Solanke" }, { ID: 8, full_name: "Ben Solanke" }], [101]);
    expect((await filterByPlayer(two, videos, "Activate our sponsor with Solanke's goal", [])).filter).toBeUndefined();
    expect((await filterByPlayer(http([], []), videos, "Promote merchandise to UK supporters", [])).videos).toHaveLength(3);
  });
});
