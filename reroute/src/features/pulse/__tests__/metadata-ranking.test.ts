import { describe, expect, it } from "vitest";
import type { Asset, MediaRef } from "@/lib/contracts";
import { rankByMetadata, type MetadataVideo } from "../moment-ranking";
import { parseObjective } from "../objective-parser";

const NOW = new Date("2026-10-23T12:00:00Z");
const WEMBY = "Victor Wembanyama";

const video = (id: string, title: string, sec: number, facts: Asset["facts"]): MetadataVideo => ({
  asset: { id, title, kind: "video", durationSec: sec, tags: [], facts: { competition: "NBA", ...facts }, metadata: {}, origin: "LIVE" },
  discoveredBy: "TEAM_TAG",
  media: { scoreplayMediaId: id, twelvelabsIndexId: "idx", method: "UNMAPPED", candidates: [], checkedAt: NOW.toISOString() } satisfies MediaRef,
});

const rank = (videos: MetadataVideo[]) =>
  rankByMetadata(videos, { objective: parseObjective("Build a Wembanyama-led Ledger sponsor campaign", NOW), player: WEMBY, sponsorTerms: ["wembanyama", "ledger", "build"] });

describe("rankByMetadata (club footage in no video index)", () => {
  it("ranks whole clips on the goal's player + sponsor tags, never claims a moment or a visual observation", () => {
    const [top, second] = rank([
      video("1", "Vic one hand jam!!_9x16.mp4", 7.3, { people: [WEMBY] }),
      video("2", "VicDunkCompQ1_9x16.mp4", 14.31, { people: [WEMBY], sponsors: ["Ledger"] }),
    ]);
    expect(top.candidate).toMatchObject({ scoreplayAssetId: "2", foundBy: "SCOREPLAY_METADATA_FALLBACK", startSeconds: 0, endSeconds: 14.31 });
    expect(top.candidate.twelveLabsVideoId).toBeUndefined();
    expect(top.media.method).toBe("UNMAPPED");
    expect(top.matches.map((m) => m.label)).toEqual([`Tagged ${WEMBY}`, "Tagged Ledger"]);
    expect(top.why.media).toMatch(/Not visually analysed/);
    // No sponsor tag ranks lower — it is unknown, not "brand-free".
    expect(second.candidate.scoreplayAssetId).toBe("1");
    expect(second.score).toBeLessThan(top.score);
  });

  it("folds aspect-ratio versions of one edit but keeps different clips of similar length", () => {
    const recs = rank([
      video("a", "Vic FB Backboard Oop_9x16.mp4", 14.6, { people: [WEMBY], sponsors: ["Ledger"] }),
      video("b", "Vic FB Backboard Oop_4x5.mp4", 14.85, { people: [WEMBY], sponsors: ["Ledger"] }),
      video("c", "VicDunkCompQ1_9x16.mp4", 14.31, { people: [WEMBY], sponsors: ["Ledger"] }),
    ]);
    expect(recs.map((r) => r.candidate.scoreplayAssetId).sort()).toEqual(["a", "c"]);
    expect(recs.find((r) => r.candidate.scoreplayAssetId === "a")?.duplicates).toEqual(["b@0-14.85"]);
  });

  it("proposes nothing without a ScorePlay signal the goal asks for", () => {
    expect(rank([video("x", "Team warmup.mp4", 20, { people: ["Stephon Castle"], sponsors: ["Frost Bank"] })])).toEqual([]);
  });
});
