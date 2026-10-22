import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_CLEARANCE_LABEL, type Decision, type RightsReceipt } from "@/lib/contracts";
import { ScorePlayHttpClient } from "./client";
import { SCOREPLAY_TAXONOMY as T } from "./taxonomy";
import { applyWriteback, liveRefusal, mediaVerdict, planWriteback, toScorePlayActions, writebackMode } from "./writeback";

const NOW = "2026-10-22T20:00:00.000Z";

function receipt(over: { decision?: Partial<Decision>; review?: RightsReceipt["humanReviewStatus"] } = {}): RightsReceipt {
  return {
    id: "rcpt-1",
    sourceAssetIds: ["101", "202"],
    intent: { territory: "GB", platform: "instagram", usage: "SPONSORED", competition: "Premier League", publishAt: NOW },
    edit: {
      id: "edit-1",
      title: "Spurs at Old Trafford",
      derived: false,
      segments: [
        { scoreplayMediaId: "101", start: 0, end: 8 },
        { scoreplayMediaId: "202", start: 30, end: 36 },
      ],
    },
    decision: {
      verdict: "BLOCKED",
      reasons: [
        { ruleId: "territory-gb", dimension: "territory", explanation: "GB licensed", outcome: "PERMIT" },
        { ruleId: "sponsor-x", dimension: "sponsor", explanation: "Rival sponsor visible", outcome: "DENY", scoreplayMediaId: "202", start: 31, end: 34 },
      ],
      missingFacts: [],
      evidence: [],
      policyId: "pl-verified",
      policyVersion: "3",
      policyFictional: false,
      clearance: "NONE",
      evaluatedAt: NOW,
      ...over.decision,
    },
    humanReviewStatus: over.review ?? "APPROVED",
    createdAt: NOW,
    writeback: [],
    media: [],
  };
}

const demo = () =>
  receipt({ decision: { policyId: "demo-spurs", policyFictional: true, policySelection: { policyId: "demo-spurs", kind: "DEMO", considered: [] } } });
const REVIEW = { reviewer: "Alex Reviewer", reviewedAt: NOW };

describe("planWriteback (pure)", () => {
  it("computes the verdict per media, not the whole-edit verdict", () => {
    expect(mediaVerdict(receipt(), "101")).toBe("ALLOWED");
    expect(mediaVerdict(receipt(), "202")).toBe("BLOCKED");
  });

  it("verified policy: ensure tags, then per media add tags + segment logs, then superseded cleanup", () => {
    const plan = planWriteback(receipt(), REVIEW);
    expect(plan.map((a) => `${a.method} ${a.path}`)).toEqual([
      "POST /tag/options",
      "POST /tag/options",
      "POST /tag/options",
      "POST /media/101/tags",
      "POST /video/logs",
      "DELETE /media/101/tags",
      "DELETE /media/101/logs",
      "POST /media/202/tags",
      "POST /video/logs",
      "DELETE /media/202/tags",
      "DELETE /media/202/logs",
    ]);
    const tags101 = plan.find((a) => a.op.kind === "ADD_MEDIA_TAGS" && a.op.mediaId === "101")!.op;
    expect(tags101).toMatchObject({ tagNames: ["reroute:verified:allowed", "reroute:review:approved"] });
    const logs202 = plan.find((a) => a.op.kind === "ADD_VIDEO_LOGS" && a.op.mediaId === "202")!.op;
    if (logs202.kind !== "ADD_VIDEO_LOGS") throw new Error("unreachable");
    expect(logs202.logs).toHaveLength(1);
    const { comment, start, end } = logs202.logs[0];
    expect([start, end]).toEqual([30, 36]);
    for (const part of [
      "REROUTE receipt rcpt-1",
      "status=BLOCKED",
      "clearance=NONE",
      "policy=pl-verified@3 (VERIFIED)",
      "segment=30.00-36.00s",
      `review=APPROVED by Alex Reviewer at ${NOW}`,
      "[DENY sponsor] sponsor-x: Rival sponsor visible",
    ]) {
      expect(comment).toContain(part);
    }
    // Contract shape strips the internal op.
    expect(toScorePlayActions(plan)[0]).toEqual({
      method: "POST",
      path: "/tag/options",
      body: { name: "reroute:verified:allowed", label: "reroute:verified:allowed", type: "free" },
      purpose: expect.any(String),
    });
  });

  it("demo policy: never a verdict tag — only informational demo-simulation logs", () => {
    const plan = planWriteback(demo(), REVIEW);
    expect(plan.every((a) => a.method === "POST" && a.path === "/video/logs")).toBe(true);
    const json = JSON.stringify(toScorePlayActions(plan));
    for (const tag of [...Object.values(T.verifiedVerdictTags), ...Object.values(T.reviewTags)]) expect(json).not.toContain(tag);
    for (const a of plan) {
      if (a.op.kind !== "ADD_VIDEO_LOGS") throw new Error("unexpected op");
      for (const l of a.op.logs) {
        expect(l.rawTags).toContain("reroute:demo-simulation");
        expect(l.comment).toContain(DEMO_CLEARANCE_LABEL);
        expect(l.comment).toContain("simulated-status=");
      }
    }
  });

  it("rejects non-ScorePlay ids", () => {
    const r = receipt();
    r.sourceAssetIds = ["tl-abc"];
    expect(() => planWriteback(r)).toThrow(/Invalid ScorePlay media id/);
  });
});

describe("writebackMode", () => {
  it("defaults to DRY_RUN", () => {
    expect(writebackMode(receipt(), undefined)).toEqual({ mode: "DRY_RUN", status: "DRY_RUN" });
    expect(writebackMode(receipt(), "dry-run")).toEqual({ mode: "DRY_RUN", status: "DRY_RUN" });
  });
  it("LIVE only for a reviewed verified receipt with env live", () => {
    expect(writebackMode(receipt(), "live")).toEqual({ mode: "LIVE" });
    expect(writebackMode(receipt({ review: "REJECTED" }), "live")).toEqual({ mode: "LIVE" });
  });
  it("refuses demo receipts and unreviewed receipts in live mode", () => {
    expect(writebackMode(demo(), "live")).toMatchObject({ mode: "DRY_RUN", status: "REFUSED", refusedReason: expect.stringContaining(DEMO_CLEARANCE_LABEL) });
    expect(writebackMode(receipt({ review: "PENDING" }), "live")).toMatchObject({ mode: "DRY_RUN", status: "REFUSED", refusedReason: expect.stringMatching(/not been reviewed/) });
    expect(writebackMode(demo(), undefined)).toMatchObject({ mode: "DRY_RUN", status: "DRY_RUN", refusedReason: expect.any(String) });
  });
});

// ---------- LIVE path against a mocked HTTP layer ----------

type Call = { method: string; path: string; body?: unknown };

function mockScorePlay() {
  const calls: Call[] = [];
  const tags = new Map<string, Set<number>>([["101", new Set([77])], ["202", new Set()]]); // 77 = stale verified:blocked
  const options = new Map<string, number>([["reroute:verified:blocked", 77]]);
  const names = () => new Map([...options].map(([n, id]) => [id, n]));
  let logId = 500;
  const logs = new Map<string, { id: number; comment: string; start_timestamp: number; end_timestamp: number }[]>([
    ["101", [{ id: 1, comment: "REROUTE receipt rcpt-1 | old", start_timestamp: 0, end_timestamp: 8000 }]],
    ["202", []],
  ]);
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

  vi.stubEnv("SCOREPLAY_API_KEY", "test-key");
  vi.stubEnv("SCOREPLAY_API_BASE_URL", "https://sp.test/v1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace(/^\/v1/, "");
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, ...(body ? { body } : {}) });
      const media = /^\/media\/(\d+)(\/tags|\/logs)?$/.exec(path);
      if (method === "GET" && path === "/whoami") return json({ user_id: 1, rights: ["can_view_media", "can_do_media_edit"] });
      if (method === "GET" && path === "/tag/options") {
        const q = url.searchParams.get("query")!;
        return json(options.has(q) ? [{ ID: options.get(q), name: q }] : []);
      }
      if (method === "POST" && path === "/tag/options") {
        const id = 900 + options.size;
        options.set(body.name, id);
        return json({ ID: id, name: body.name }, 201);
      }
      if (media && !media[2] && method === "GET") {
        const n = names();
        return json({
          ID: Number(media[1]),
          company_id: 42,
          type: "video",
          tags: [...tags.get(media[1])!].map((id) => ({ tag_option_id: id, tag_option: { ID: id, name: n.get(id) } })),
        });
      }
      if (media?.[2] === "/tags" && method === "POST") {
        for (const id of body.tag_option_ids) tags.get(media[1])!.add(id);
        return new Response(null, { status: 204 });
      }
      if (media?.[2] === "/tags" && method === "DELETE") {
        for (const id of body.tag_option_ids) tags.get(media[1])!.delete(id);
        return new Response(null, { status: 204 });
      }
      if (method === "POST" && path === "/video/logs") {
        for (const v of body.video_logs) {
          logs.get(String(v.media_id))!.push({
            id: logId++,
            comment: v.log.comment,
            start_timestamp: v.log.start_offset * 1000,
            end_timestamp: v.log.end_offset * 1000,
          });
        }
        return json(true);
      }
      if (media?.[2] === "/logs" && method === "GET") return json({ items: logs.get(media[1]), total: logs.get(media[1])!.length });
      if (media?.[2] === "/logs" && method === "DELETE") {
        logs.set(media[1], logs.get(media[1])!.filter((l) => !body.log_ids.includes(l.id)));
        return json({ deleted_ids: body.log_ids });
      }
      return json({ error: "unexpected" }, 500);
    }),
  );
  return { calls, tags, logs };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("applyWriteback (LIVE, mocked HTTP)", () => {
  it("calls exactly the documented endpoints in order: add, verify, then remove superseded", async () => {
    const sp = mockScorePlay();
    const r = receipt();
    const out = await applyWriteback(r, planWriteback(r, REVIEW), new ScorePlayHttpClient());

    expect(sp.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /whoami",
      "GET /tag/options",
      "POST /tag/options", // reroute:verified:allowed
      "GET /tag/options",
      "POST /tag/options", // reroute:review:approved
      "GET /tag/options", // reroute:verified:blocked exists
      // media 101
      "GET /media/101",
      "GET /media/101/logs",
      "POST /media/101/tags",
      "POST /video/logs",
      "GET /media/101",
      "GET /media/101/logs",
      "DELETE /media/101/tags", // stale verified:blocked, only after verify
      "DELETE /media/101/logs", // this receipt's earlier log, only after verify
      "GET /media/101",
      "GET /media/101/logs",
      // media 202
      "GET /media/202",
      "GET /media/202/logs",
      "POST /media/202/tags",
      "POST /video/logs",
      "GET /media/202",
      "GET /media/202/logs",
    ]);
    expect(sp.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(sp.calls.find((c) => c.method === "DELETE" && c.path === "/media/101/tags")!.body).toEqual({ tag_option_ids: [77] });
    expect(sp.calls.find((c) => c.method === "DELETE" && c.path === "/media/101/logs")!.body).toEqual({ log_ids: [1] });
    expect(sp.calls.find((c) => c.path === "/video/logs")!.body).toMatchObject({
      company_id: 42,
      video_logs: [{ media_id: 101, log: { start_offset: 0, end_offset: 8 } }],
    });

    expect(out["101"]).toMatchObject({ status: "VERIFIED", tags: expect.arrayContaining(["reroute:verified:allowed", "reroute:review:approved"]) });
    expect(out["101"].tags).not.toContain("reroute:verified:blocked");
    expect(out["202"]).toMatchObject({ status: "VERIFIED", tags: expect.arrayContaining(["reroute:verified:blocked"]) });
    expect(sp.logs.get("101")!.map((l) => l.id)).not.toContain(1);
  });

  it("does not delete anything when the add cannot be verified", async () => {
    const sp = mockScorePlay();
    const real = globalThis.fetch;
    // Simulate ScorePlay accepting POST /video/logs without persisting it.
    vi.stubGlobal("fetch", (input: URL | string, init: RequestInit) =>
      init.method === "POST" && String(input).endsWith("/video/logs") ? Promise.resolve(new Response("true")) : real(input, init),
    );
    const r = receipt();
    const out = await applyWriteback(r, planWriteback(r, REVIEW), new ScorePlayHttpClient());
    expect(out["101"].status).toBe("WRITTEN");
    expect(out["101"].detail).toMatch(/not visible on re-read/);
    expect(sp.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("refuses demo and unreviewed receipts before any HTTP call", async () => {
    const sp = mockScorePlay();
    await expect(applyWriteback(demo(), planWriteback(demo()), new ScorePlayHttpClient())).rejects.toThrow(DEMO_CLEARANCE_LABEL);
    const pending = receipt({ review: "PENDING" });
    await expect(applyWriteback(pending, planWriteback(pending), new ScorePlayHttpClient())).rejects.toThrow(/not been reviewed/);
    expect(sp.calls).toEqual([]);
    expect(liveRefusal(receipt())).toBeUndefined();
  });
});
