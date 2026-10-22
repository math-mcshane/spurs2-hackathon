/**
 * Live, read-only smoke test against the real ScorePlay workspace and TwelveLabs index.
 * Skipped unless LIVE_SMOKE=1 (needs reroute/.env.local loaded, e.g. `LIVE_SMOKE=1 pnpm exec vitest run src/lib/media/live.test.ts`
 * with the env exported). Never writes anything.
 */
import { describe, expect, it } from "vitest";
import { defaultScorePlayHttp, searchMediaPages } from "@/features/pulse/server/scoreplay-discovery";
import { TwelveLabsVideoIntelligence } from "@/lib/twelvelabs/client";
import { getMediaResolver } from "./index";

describe.skipIf(process.env.LIVE_SMOKE !== "1")("live media identity (LIVE_SMOKE=1)", () => {
  it("maps the 58 Tottenham index videos FILENAME_DURATION and a Marengo search returns real ScorePlay ids", { timeout: 120_000 }, async () => {
    const resolver = getMediaResolver("tottenham");
    const catalog = await resolver.refresh();
    expect(catalog.twelvelabsVideos).toBe(58);
    expect(catalog.refs).toHaveLength(58);
    expect(catalog.refs.every((r) => r.method === "FILENAME_DURATION")).toBe(true);
    expect(catalog.ambiguous).toEqual([]);
    expect((await resolver.forScoreplay("130851361")).twelvelabsVideoId).toBe("6ad911e9500e82756f2eb4eb");

    const hits = await new TwelveLabsVideoIntelligence({ club: "tottenham", resolver }).search("Tottenham goal celebration", { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    const { media } = await searchMediaPages(defaultScorePlayHttp(), { media_type: "video" }, { maxItems: Number.POSITIVE_INFINITY });
    const workspace = new Set(media.map((m) => String(m.ID)));
    expect(hits.every((h) => workspace.has(h.scoreplayMediaId) && h.mapping === "FILENAME_DURATION")).toBe(true);
  });
});
