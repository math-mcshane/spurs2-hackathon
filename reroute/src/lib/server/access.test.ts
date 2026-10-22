import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, EditPlan, PublishIntent, VideoIntelligence } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { checkAccess } from "./access";
import type { ContextDeps } from "./context";

const store = vi.hoisted(() => ({ findReceiptFor: vi.fn(), createReceipt: vi.fn() }));
vi.mock("./store", () => ({ ...store, listHumanObservations: async () => [] }));

const now = new Date("2026-10-22T12:00:00Z");
const fans: Asset = {
  id: "fans",
  title: "Away end singing",
  kind: "video",
  durationSec: 10,
  tags: ["partner content", "Premier League", "Tottenham Hotspur"],
  facts: { competition: "Premier League", teams: ["Tottenham Hotspur"] },
  metadata: {},
  origin: "LIVE",
};
const edit: EditPlan = { id: "e1", title: "t", derived: false, segments: [{ scoreplayMediaId: "fans", start: 0, end: 5 }] };
const editorial: PublishIntent = { territory: "GB", platform: "instagram", usage: "EDITORIAL", competition: "Premier League", club: "tottenham", publishAt: "2026-11-01T18:00:00Z" };
const video: VideoIntelligence = { search: async () => [], observations: async () => [] };
const deps: ContextDeps = {
  getAsset: async () => fans,
  video: () => video,
  mediaRef: async (id) => ({ scoreplayMediaId: id, twelvelabsVideoId: "tl", method: "FILENAME_DURATION", candidates: [], checkedAt: now.toISOString() }),
  humanObservations: async () => [],
};
const opts = { deps, now };
const receipt = (status: string) => ({ id: "r1", edit, humanReviewStatus: status });

beforeEach(() => {
  store.findReceiptFor.mockReset().mockResolvedValue(null);
  store.createReceipt.mockReset().mockResolvedValue({ id: "new" });
});

describe("checkAccess", () => {
  it("demo ALLOWED: PREVIEW granted, DELIVER never granted (canPublish false)", async () => {
    expect(await checkAccess(edit, editorial, "PREVIEW", opts)).toMatchObject({ granted: true, uiAction: "USE" });
    store.findReceiptFor.mockResolvedValue(receipt("APPROVED"));
    const deliver = await checkAccess(edit, editorial, "DELIVER", opts);
    expect(deliver).toMatchObject({ granted: false, uiAction: "BLOCKED", receiptId: "r1", decision: { clearance: "DEMO" } });
    expect(store.createReceipt).not.toHaveBeenCalled();
  });

  it("NEEDS_REVIEW: reuses the matching PENDING receipt instead of creating a duplicate", async () => {
    const commercial = { ...editorial, usage: "COMMERCIAL" as const }; // no analysis evidence of "no players"
    store.findReceiptFor.mockResolvedValue(receipt("PENDING"));
    expect(await checkAccess(edit, commercial, "PREVIEW", opts)).toMatchObject({ granted: false, uiAction: "REQUEST_REVIEW", receiptId: "r1" });
    expect(store.createReceipt).not.toHaveBeenCalled();
    expect(store.findReceiptFor).toHaveBeenCalledWith(expect.objectContaining({ editId: "e1", intent: commercial }));
  });

  it("NEEDS_REVIEW with an APPROVED receipt: PREVIEW recognized, EXPORT still refused", async () => {
    const commercial = { ...editorial, usage: "COMMERCIAL" as const };
    store.findReceiptFor.mockResolvedValue(receipt("APPROVED"));
    expect(await checkAccess(edit, commercial, "PREVIEW", opts)).toMatchObject({ granted: true, uiAction: "USE" });
    expect(await checkAccess(edit, commercial, "EXPORT", opts)).toMatchObject({ granted: false, uiAction: "BLOCKED" });
  });

  it("no receipt yet: creates exactly one PENDING receipt with the MediaRefs; store unconfigured ⇒ none", async () => {
    const commercial = { ...editorial, usage: "COMMERCIAL" as const };
    expect(await checkAccess(edit, commercial, "PREVIEW", opts)).toMatchObject({ uiAction: "REQUEST_REVIEW", receiptId: "new" });
    expect(store.createReceipt).toHaveBeenCalledWith(expect.objectContaining({ media: [expect.objectContaining({ scoreplayMediaId: "fans" })] }));

    store.findReceiptFor.mockRejectedValue(new AppError("NOT_CONFIGURED", "no supabase"));
    store.createReceipt.mockRejectedValue(new AppError("NOT_CONFIGURED", "no supabase"));
    const res = await checkAccess(edit, commercial, "PREVIEW", opts);
    expect(res).toMatchObject({ granted: false, uiAction: "REQUEST_REVIEW" });
    expect(res.receiptId).toBeUndefined();
  });
});
