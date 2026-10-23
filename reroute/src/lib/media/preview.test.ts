import { NextRequest } from "next/server";
import type * as NextServer from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, EditPlan, PublishIntent } from "@/lib/contracts";
import type * as Auth from "@/lib/server/auth";
import { GET as getAssets } from "@/app/api/assets/route";
import { GET as getAsset } from "@/app/api/assets/[id]/route";
import { GET as getGoalRoute } from "@/app/api/pulse/goal/route";
import { POST as postRecover } from "@/app/api/recover/route";
import { mediaAccess, previewFor, withoutMediaUrls } from "./preview";

/**
 * MEDIA_PREVIEW_ENABLED lockdown at the API boundary: with the flag off (default) or an anonymous caller,
 * no response carries a URL to footage (streams, proxies, thumbnails). Upstreams are fully mocked.
 */

const MEDIA_URL = /https?:\/\/[^"\s]*(scoreplay|amazonaws|cloudfront|twelvelabs)/i;

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  searchAssets: vi.fn(),
  recover: vi.fn(),
  getGoal: vi.fn(),
}));

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof NextServer>()), connection: async () => {} }));
vi.mock("@/lib/server/auth", async (orig) => ({ ...(await orig<typeof Auth>()), getSession: h.getSession }));
vi.mock("@/lib/scoreplay", () => ({ getScorePlayClient: () => ({ searchAssets: h.searchAssets, getAsset: async (id: string) => ({ ...asset, id }) }) }));
vi.mock("@/lib/server/recovery", () => ({ recover: h.recover }));
vi.mock("@/lib/rights/packages", () => ({ policiesForEvaluation: async () => ({ policies: [], package: null }), toPolicyContext: () => null }));
vi.mock("@/features/pulse/server/goal-service", () => ({
  getGoal: h.getGoal,
  goalDeps: (media: string) => ({ media }),
}));

const asset: Asset = {
  id: "46000204",
  title: "MNU_TOT_901.mp4",
  kind: "video",
  thumbnailUrl: "https://cdn.scoreplay.io/scoreplay-mam-media-transformed/123/456/media_46000204_thumbnail.jpg",
  previewUrl: "https://scoreplay-proxies.s3.eu-west-1.amazonaws.com/46000204/proxy_medium.mp4",
  durationSec: 30,
  tags: ["Tottenham Hotspur"],
  facts: { competition: "Premier League" },
  metadata: {},
  origin: "LIVE",
};

vi.mock("@/lib/server/context", () => ({
  defaultDeps: () => ({}),
  DecisionContext: class {
    assets: Record<string, Asset> = {};
    analysis: Record<string, { status: "AVAILABLE" }> = {};
    observations: Record<string, unknown[]> = {};
    media: Record<string, unknown> = {};
    notes: string[] = [];
    async ensure(ids: string[]) {
      for (const id of ids) {
        this.assets[id] = { ...asset, id };
        this.analysis[id] = { status: "AVAILABLE" };
        this.observations[id] = [{ id: "o1", thumbnailUrl: "https://d1abc.cloudfront.net/frames/1.jpg" }];
      }
    }
  },
}));

const intent: PublishIntent = { territory: "GB", platform: "instagram", usage: "ORGANIC", competition: "Premier League", club: "tottenham", publishAt: "2026-10-25T12:00:00.000Z" };
const edit: EditPlan = { id: "edit-1", title: "Spurs", segments: [{ scoreplayMediaId: "46000204", start: 7, end: 15 }], derived: false };

const get = (path: string) => new NextRequest(`http://localhost:3000${path}`);
const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Every boundary response, serialized. */
async function responses(): Promise<Record<string, string>> {
  const [search, detail, recovered, goal] = await Promise.all([
    getAssets(get("/api/assets?q=spurs")),
    getAsset(get("/api/assets/46000204"), { params: Promise.resolve({ id: "46000204" }) }),
    postRecover(post("/api/recover", { edit, intents: [intent] })),
    getGoalRoute(get("/api/pulse/goal?id=g1")),
  ]);
  for (const r of [search, detail, recovered, goal]) expect(r.status).toBe(200);
  return { assets: await search.text(), asset: await detail.text(), recover: await recovered.text(), goal: await goal.text() };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.searchAssets.mockResolvedValue([asset]);
  h.recover.mockResolvedValue({
    plan: { scope: "CLIP", headline: "x", problems: [], options: [] },
    media: [{ scoreplayMediaId: "46000204", method: "FILENAME_DURATION", candidates: [], checkedAt: "2026-10-22T20:00:00.000Z", thumbnailUrl: "https://thumbs.twelvelabs.io/tl-907/3.jpg" }],
    notes: [],
  });
  // The goal service strips per `deps.media` (covered in goal.test.ts); here: the route derives it from the request.
  h.getGoal.mockImplementation(async (_id: string, deps: { media: string }) =>
    deps.media === "ALLOWED" ? { media: deps.media, thumbnailUrl: asset.thumbnailUrl } : { media: deps.media },
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("MEDIA_PREVIEW_ENABLED", () => {
  it("is off unless exactly \"true\": no footage URL in assets, asset detail, recovery plan or goal view — anonymous or reviewer", async () => {
    for (const value of [undefined, "", "1", "TRUE", "on", "yes", "false"]) {
      if (value === undefined) vi.unstubAllEnvs();
      else vi.stubEnv("MEDIA_PREVIEW_ENABLED", value);
      for (const session of [null, { reviewer: "Sam" }]) {
        h.getSession.mockResolvedValue(session);
        const body = await responses();
        for (const [name, text] of Object.entries(body)) expect(text, `${name} (flag=${value}, session=${!!session})`).not.toMatch(MEDIA_URL);
        expect(JSON.parse(body.goal).goal.media).toBe("DISABLED");
        expect(JSON.parse(body.assets).assets[0]).toMatchObject({ id: asset.id, title: asset.title, durationSec: 30 });
      }
    }
  });

  it("enabled + anonymous: still no footage URL anywhere", async () => {
    vi.stubEnv("MEDIA_PREVIEW_ENABLED", "true");
    h.getSession.mockResolvedValue(null);
    const body = await responses();
    for (const [name, text] of Object.entries(body)) expect(text, name).not.toMatch(MEDIA_URL);
    expect(JSON.parse(body.goal).goal.media).toBe("REVIEWER_ONLY");
  });

  it("enabled + reviewer session: preview and thumbnail URLs are present", async () => {
    vi.stubEnv("MEDIA_PREVIEW_ENABLED", "true");
    h.getSession.mockResolvedValue({ reviewer: "Sam" });
    const { recover, ...withUrls } = await responses();
    for (const [name, text] of Object.entries(withUrls)) expect(text, name).toMatch(MEDIA_URL);
    expect(JSON.parse(withUrls.assets).assets[0]).toMatchObject({ previewUrl: asset.previewUrl, thumbnailUrl: asset.thumbnailUrl });
    expect(JSON.parse(withUrls.asset).asset.previewUrl).toBe(asset.previewUrl);
    // A recovery plan never needs footage: no URL even for a reviewer.
    expect(recover).not.toMatch(MEDIA_URL);
    expect(JSON.parse(recover).media[0]).toMatchObject({ scoreplayMediaId: "46000204" });
  });

  it("previewFor never resolves a stream while disabled (no upstream call)", async () => {
    const scoreplay = { get: vi.fn(), post: vi.fn() };
    const twelvelabs = vi.fn();
    const ref = { scoreplayMediaId: "46000204", twelvelabsIndexId: "idx", twelvelabsVideoId: "tl-1", method: "FILENAME_DURATION", candidates: [], checkedAt: "2026-10-22T12:00:00.000Z" } as never;
    await expect(previewFor(ref, { deps: { scoreplay: scoreplay as never, twelvelabs } })).resolves.toBeUndefined();
    expect(scoreplay.get).not.toHaveBeenCalled();
    expect(twelvelabs).not.toHaveBeenCalled();
  });

  it("mediaAccess and withoutMediaUrls", async () => {
    h.getSession.mockResolvedValue({ reviewer: "Sam" });
    expect(await mediaAccess(get("/"))).toBe("DISABLED");
    vi.stubEnv("MEDIA_PREVIEW_ENABLED", "true");
    expect(await mediaAccess(get("/"))).toBe("ALLOWED");
    h.getSession.mockResolvedValue(null);
    expect(await mediaAccess(get("/"))).toBe("REVIEWER_ONLY");
    expect(
      withoutMediaUrls({ a: [{ thumbnailUrl: "x", keep: 1, preview: { url: "y" } }], previewUrl: "z", previewNote: "kept", n: null }),
    ).toEqual({ a: [{ keep: 1 }], previewNote: "kept", n: null });
  });
});
