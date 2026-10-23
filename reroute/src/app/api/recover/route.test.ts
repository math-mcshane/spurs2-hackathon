import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, EditPlan, Evidence, MediaRef, PublishIntent, VideoIntelligence } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import type * as Packages from "@/lib/rights/packages";
import type * as Context from "@/lib/server/context";
import { resetRateLimitsForTests } from "@/lib/server/rate-limit";
import { memoryRepositories } from "@/lib/server/repositories/memory";
import { resetRepositoriesForTests, useRepositoriesForTests } from "@/lib/server/repositories/testing";
import type { Repositories } from "@/lib/server/repositories/types";
import { proxy } from "@/proxy";
import { RecoverResponseSchema } from "@/lib/api-client";
import { POST } from "./route";

/** POST /api/recover: real planner + view mapping over mocked ScorePlay / TwelveLabs, in-memory repositories. */

const h = vi.hoisted(() => ({
  assets: {} as Record<string, Asset>,
  observations: {} as Record<string, Evidence[]>,
  searches: [] as string[],
  policiesForEvaluation: vi.fn(),
}));

vi.mock("@/lib/scoreplay", () => ({
  getScorePlayClient: () => ({
    getAsset: async (id: string) => {
      if (!h.assets[id]) throw new AppError("NOT_FOUND", `no asset ${id}`);
      return h.assets[id];
    },
  }),
}));

vi.mock("@/lib/rights/packages", async (orig) => {
  const real = await orig<typeof Packages>();
  h.policiesForEvaluation.mockImplementation(real.policiesForEvaluation);
  return { ...real, policiesForEvaluation: h.policiesForEvaluation };
});

vi.mock("@/lib/server/context", async (orig) => {
  const real = await orig<typeof Context>();
  const video: VideoIntelligence = {
    async search(query) {
      h.searches.push(query);
      return [];
    },
    async observations(ref) {
      return h.observations[ref.scoreplayMediaId!] ?? [];
    },
  };
  const ref = (id: string): MediaRef => ({ scoreplayMediaId: id, twelvelabsVideoId: `tl-${id}`, method: "FILENAME_DURATION", candidates: [], checkedAt: "2026-10-22T12:00:00.000Z" });
  const deps: Context.ContextDeps = {
    getAsset: async (id) => h.assets[id],
    video: () => video,
    mediaRef: async (id) => ref(id),
    humanObservations: async () => [],
  };
  return {
    ...real,
    loadDecisionContext: async (edit: EditPlan) => {
      const ctx = new real.DecisionContext(deps);
      await ctx.ensure(edit.segments.map((s) => s.scoreplayMediaId));
      return ctx;
    },
  };
});

const ORIGIN = "http://localhost:3000";
const asset: Asset = {
  id: "130851444",
  title: "solanke late goal.mp4",
  kind: "video",
  durationSec: 30,
  tags: ["partner content", "Premier League", "Tottenham Hotspur", "Manchester United"],
  facts: {
    competition: "Premier League",
    teams: ["Tottenham Hotspur", "Manchester United"],
    people: ["Dominic Solanke-Mitchell"],
    peopleTeams: { "Dominic Solanke-Mitchell": ["Tottenham Hotspur FC"] },
  },
  metadata: {},
  origin: "LIVE",
};
const dhl: Evidence = { scoreplayMediaId: asset.id, start: 15, end: 17, observation: "dhl: LED board", source: "TWELVELABS", label: "brand:dhl", confidence: 0.9, origin: "CACHED" };

const intent: PublishIntent = { territory: "GB", platform: "instagram", usage: "SPONSORED", competition: "Premier League", club: "tottenham", publishAt: "2026-11-01T18:00:00Z" };
const edit: EditPlan = { id: "edit-130851444", title: "Solanke", segments: [{ scoreplayMediaId: asset.id, start: 10, end: 19 }], derived: false };

const post = (body: unknown) => POST(new Request(`${ORIGIN}/api/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

/** Every repository call, by "repo.method" (the route must only ever read). */
let calls: string[];
function recording(repos: Repositories): Repositories {
  return Object.fromEntries(
    Object.entries(repos).map(([name, repo]) => [
      name,
      new Proxy(repo as object, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          return typeof value === "function" ? (...args: unknown[]) => (calls.push(`${name}.${String(key)}`), value.apply(target, args)) : value;
        },
      }),
    ]),
  ) as unknown as Repositories;
}

beforeEach(() => {
  calls = [];
  h.searches.length = 0;
  h.assets = { [asset.id]: asset };
  h.observations = { [asset.id]: [dhl] };
  h.policiesForEvaluation.mockClear();
  useRepositoriesForTests(recording(memoryRepositories()));
});
afterEach(() => {
  resetRepositoriesForTests();
  resetRateLimitsForTests();
});

describe("POST /api/recover", () => {
  it("plans the recovery for one moment: TRIM around the partner board, re-checked, as the Compliance Editor view", async () => {
    const res = await post({ edit, intents: [intent] });
    expect(res.status).toBe(200);
    const body = RecoverResponseSchema.parse(await res.json());
    expect(body.recovery).toMatchObject({ scope: "CLIP", forEvaluationId: edit.id });
    expect(body.recovery.problem.items.length).toBeGreaterThan(0);
    const trim = body.recovery.options.find((o) => o.kind === "TRIM");
    expect(trim).toMatchObject({ outcome: "RESOLVES_DEMO", applicable: true, recheck: { verdict: "ALLOWED", clearance: "DEMO", allowedUses: 1, totalUses: 1 } });
    expect(trim!.timeline).toMatchObject({ sourceAssetId: asset.id, original: { start: 10, end: 19 }, executionLabel: "Edit plan — not rendered" });
    expect(trim!.timeline!.retained).toHaveLength(2);
    expect(trim!.timeline!.removed.every((r) => r.start <= 15 && r.end >= 17)).toBe(true);
    expect(body.policy).toMatchObject({ club: "tottenham", verified: false });
    expect(body.media.map((m) => m.scoreplayMediaId)).toContain(asset.id);
    // The replacement query is the ScorePlay title (no segment label).
    expect(h.searches).toEqual([asset.title]);
  });

  it("is read-only: nothing is recorded (no evaluation, alternatives, event or receipt)", async () => {
    expect((await post({ edit, intents: [intent] })).status).toBe(200);
    const writes = calls.filter((c) => /\.(record|append|create|update|insert|put|add|setSelection)$/.test(c));
    expect(writes).toEqual([]);
  });

  it("evaluates under the rule package of the first use's club (and the requested package)", async () => {
    await post({ edit, intents: [intent], packageId: "demo-tottenham-pl" });
    expect(h.policiesForEvaluation).toHaveBeenCalledWith({ club: "tottenham", packageId: "demo-tottenham-pl" });

    // The engine evaluates exactly the policies selected: none → no policy covers the use, nothing resolves.
    h.policiesForEvaluation.mockResolvedValueOnce({ policies: [], package: null });
    const body = RecoverResponseSchema.parse(await (await post({ edit, intents: [intent] })).json());
    expect(body.policy).toBeNull();
    expect(body.recovery.options.some((o) => o.outcome === "RESOLVES_DEMO")).toBe(false);
  });

  it.each([
    ["no body fields", {}],
    ["two segments", { edit: { ...edit, segments: [...edit.segments, { scoreplayMediaId: asset.id, start: 20, end: 25 }] }, intents: [intent] }],
    ["no uses", { edit, intents: [] }],
    ["22 uses", { edit, intents: Array.from({ length: 22 }, () => intent) }],
    ["invalid use", { edit, intents: [{ ...intent, publishAt: "tomorrow" }] }],
    ["empty package id", { edit, intents: [intent], packageId: "" }],
  ])("rejects %s with BAD_REQUEST", async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
    expect(h.policiesForEvaluation).not.toHaveBeenCalled();
  });

  it("unknown asset → NOT_FOUND", async () => {
    const res = await post({ edit: { ...edit, segments: [{ scoreplayMediaId: "missing", start: 0, end: 5 }] }, intents: [intent] });
    expect(res.status).toBe(404);
  });
});

describe("proxy: /api/recover", () => {
  const request = (init: { origin?: string; ip?: string } = {}) =>
    new NextRequest(`${ORIGIN}/api/recover`, {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", origin: init.origin ?? ORIGIN, "x-real-ip": init.ip ?? "203.0.113.40" },
      body: "{}",
    });
  const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

  it("requires same-origin", async () => {
    expect((await proxy(request({ origin: "https://evil.example" }))).status).toBe(403);
  });

  it("is rate-limited as the most expensive route: 10/min per IP", async () => {
    for (let i = 0; i < 10; i++) expect(passed(await proxy(request()))).toBe(true);
    const limited = await proxy(request());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(passed(await proxy(request({ ip: "198.51.100.40" })))).toBe(true);
  });
});
