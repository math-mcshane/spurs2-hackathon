import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CLEARANCE_LABEL, WritebackResponseSchema, type RightsReceipt } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import type * as WritebackModule from "@/lib/scoreplay/writeback";
import { POST } from "./route";

const NOW = "2026-10-22T20:00:00.000Z";

const h = vi.hoisted(() => ({
  requireReviewer: vi.fn(),
  record: vi.fn(),
  getReceipt: vi.fn(),
  updateReceipt: vi.fn(),
  applyWriteback: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({ requireReviewer: h.requireReviewer }));
vi.mock("@/lib/server/repositories", () => ({ writebackAttempts: { record: h.record } }));
vi.mock("@/lib/server/store", () => ({ getReceipt: h.getReceipt, updateReceipt: h.updateReceipt }));
vi.mock("@/lib/scoreplay/writeback", async (orig) => ({
  ...(await orig<typeof WritebackModule>()),
  applyWriteback: h.applyWriteback,
}));

function receipt(over: { fictional?: boolean; review?: RightsReceipt["humanReviewStatus"] } = {}): RightsReceipt {
  return {
    id: "rcpt-1",
    sourceAssetIds: ["101"],
    intent: { territory: "GB", platform: "instagram", usage: "ORGANIC", competition: "Premier League", publishAt: NOW },
    edit: { id: "e", title: "t", derived: false, segments: [{ scoreplayMediaId: "101", start: 0, end: 5 }] },
    decision: {
      verdict: "ALLOWED",
      reasons: [{ ruleId: "ok", dimension: "territory", explanation: "licensed", outcome: "PERMIT" }],
      missingFacts: [],
      evidence: [],
      policyId: over.fictional ? "demo" : "verified",
      policyVersion: "1",
      policyFictional: over.fictional ?? false,
      clearance: over.fictional ? "DEMO" : "VERIFIED",
      evaluatedAt: NOW,
    },
    humanReviewStatus: over.review ?? "APPROVED",
    createdAt: NOW,
    writeback: [],
    media: [],
  };
}

function load(r: RightsReceipt) {
  h.getReceipt.mockResolvedValue({ ...r, reviews: r.humanReviewStatus === "PENDING" ? [] : [{ status: r.humanReviewStatus, reviewer: "Alex", at: NOW }] });
  h.updateReceipt.mockImplementation(async (_id: string, mutate: (x: RightsReceipt) => RightsReceipt) => ({ ...mutate(r), reviews: [] }));
}

const call = () =>
  POST(new Request("http://localhost/api/writeback", { method: "POST", body: JSON.stringify({ receiptId: "rcpt-1" }) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.requireReviewer.mockResolvedValue({ reviewer: "Sam" });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/writeback", () => {
  it("requires a reviewer session", async () => {
    h.requireReviewer.mockRejectedValue(new AppError("FORBIDDEN", "Reviewer session required"));
    const res = await call();
    expect(res.status).toBe(403);
    expect(h.getReceipt).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it("is DRY_RUN by default, records the attempt and appends DRY_RUN entries", async () => {
    vi.stubEnv("SCOREPLAY_WRITEBACK_MODE", "");
    load(receipt());
    const res = await call();
    expect(res.status).toBe(200);
    const body = WritebackResponseSchema.parse(await res.json());
    expect(body.mode).toBe("DRY_RUN");
    expect(body.refusedReason).toBeUndefined();
    expect(body.planned.map((a) => `${a.method} ${a.path}`)).toContain("POST /video/logs");
    expect(body.receipt.writeback).toEqual([{ scoreplayMediaId: "101", status: "DRY_RUN", at: expect.any(String), detail: expect.stringMatching(/Dry-run/) }]);
    expect(h.applyWriteback).not.toHaveBeenCalled();
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ receiptId: "rcpt-1", mode: "DRY_RUN", status: "DRY_RUN", actor: "Sam", planned: body.planned }));
  });

  it("refuses a demo receipt in live mode (no ScorePlay call, no verdict tags planned)", async () => {
    vi.stubEnv("SCOREPLAY_WRITEBACK_MODE", "live");
    load(receipt({ fictional: true }));
    const body = WritebackResponseSchema.parse(await (await call()).json());
    expect(body.mode).toBe("DRY_RUN");
    expect(body.refusedReason).toContain(DEMO_CLEARANCE_LABEL);
    expect(JSON.stringify(body.planned)).not.toMatch(/reroute:verified:|\/tags/);
    expect(body.receipt.writeback[0].status).toBe("REFUSED");
    expect(h.applyWriteback).not.toHaveBeenCalled();
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ mode: "DRY_RUN", status: "REFUSED" }));
  });

  it("refuses an unreviewed receipt in live mode", async () => {
    vi.stubEnv("SCOREPLAY_WRITEBACK_MODE", "live");
    load(receipt({ review: "PENDING" }));
    const body = WritebackResponseSchema.parse(await (await call()).json());
    expect(body.mode).toBe("DRY_RUN");
    expect(body.refusedReason).toMatch(/not been reviewed/);
    expect(h.applyWriteback).not.toHaveBeenCalled();
  });

  it("writes live for a reviewed verified receipt and records VERIFIED", async () => {
    vi.stubEnv("SCOREPLAY_WRITEBACK_MODE", "live");
    load(receipt());
    h.applyWriteback.mockResolvedValue({ "101": { status: "VERIFIED", at: NOW, tags: ["reroute:verified:allowed"], logs: [] } });
    const body = WritebackResponseSchema.parse(await (await call()).json());
    expect(body.mode).toBe("LIVE");
    expect(body.readBack).toBeDefined();
    expect(body.receipt.writeback[0]).toMatchObject({ scoreplayMediaId: "101", status: "VERIFIED" });
    expect(h.applyWriteback).toHaveBeenCalledOnce();
    const [, plan] = h.applyWriteback.mock.calls[0];
    expect(plan.find((a: { op: { kind: string } }) => a.op.kind === "ADD_VIDEO_LOGS").op.logs[0].comment).toContain("review=APPROVED by Alex");
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ mode: "LIVE", status: "VERIFIED" }));
  });

  it("records FAILED when the live write throws", async () => {
    vi.stubEnv("SCOREPLAY_WRITEBACK_MODE", "live");
    load(receipt());
    h.applyWriteback.mockRejectedValue(new AppError("FORBIDDEN", "key lacks can_do_media_edit"));
    const body = WritebackResponseSchema.parse(await (await call()).json());
    expect(body.receipt.writeback[0]).toMatchObject({ status: "FAILED", detail: "key lacks can_do_media_edit" });
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ mode: "LIVE", status: "FAILED" }));
  });
});
