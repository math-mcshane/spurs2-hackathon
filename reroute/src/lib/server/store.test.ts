import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Decision, EditPlan, PublishIntent } from "@/lib/contracts";
import { resetRepositoriesForTests, useMemoryRepositoriesForTests } from "./repositories/testing";
import type { Repositories } from "./repositories/types";
import { createReceipt, findReceiptForCampaign, getReceipt, recordReview } from "./store";

/** Receipt workflow rules on the (test-only) in-memory repositories. */

const intent: PublishIntent = { territory: "GB", platform: "instagram", usage: "ORGANIC", competition: "Premier League", publishAt: "2026-10-25T12:00:00.000Z" };
const edit: EditPlan = { id: "edit-1", title: "Spurs", segments: [{ scoreplayMediaId: "101", start: 0, end: 5 }], derived: false };
const decision: Decision = {
  verdict: "NEEDS_REVIEW",
  reasons: [],
  missingFacts: [],
  evidence: [],
  policyVersion: "1",
  policyId: "demo",
  policyFictional: true,
  clearance: "NONE",
  evaluatedAt: "2026-10-22T20:00:00.000Z",
};
const noGuard = () => {};

let repos: Repositories;
beforeEach(() => {
  repos = useMemoryRepositoriesForTests();
});
afterEach(() => resetRepositoriesForTests());

describe("recordReview", () => {
  it("is final: a second review (either way) is a CONFLICT and changes nothing", async () => {
    const { id } = await createReceipt({ edit, intent, decision });
    await recordReview(id, { status: "APPROVED", reviewer: "Ed" }, noGuard);
    await expect(recordReview(id, { status: "REJECTED", reviewer: "Mallory" }, noGuard)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(recordReview(id, { status: "APPROVED", reviewer: "Ed" }, noGuard)).rejects.toMatchObject({ code: "CONFLICT" });
    const receipt = await getReceipt(id);
    expect(receipt.humanReviewStatus).toBe("APPROVED");
    expect(receipt.reviews).toMatchObject([{ status: "APPROVED", reviewer: "Ed" }]);
  });

  it("concurrent reviews: exactly one lands and the log agrees with the receipt", async () => {
    const { id } = await createReceipt({ edit, intent, decision });
    const results = await Promise.allSettled([
      recordReview(id, { status: "APPROVED", reviewer: "Ed" }, noGuard),
      recordReview(id, { status: "REJECTED", reviewer: "Jo" }, noGuard),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const receipt = await getReceipt(id);
    expect(receipt.reviews).toHaveLength(1);
    expect(receipt.reviews[0].status).toBe(receipt.humanReviewStatus);
  });
});

describe("campaign receipts", () => {
  it("cover the current campaign version and every use; the campaign mirrors their review", async () => {
    const campaignId = randomUUID();
    await repos.campaigns.saveVersion(campaignId, { hook: "v1" }, "pulse");
    const intents = [intent, { ...intent, platform: "tiktok" }];
    const created = await createReceipt({ edit, intent, intents, decision, campaignId, campaignVersion: 1 });
    expect(created).toMatchObject({ campaignId, campaignVersion: 1, intents });
    expect(await repos.campaigns.get(campaignId)).toMatchObject({ receiptId: created.id, reviewStatus: "PENDING" });

    await recordReview(created.id, { status: "APPROVED", reviewer: "Ed" }, noGuard);
    expect(await repos.campaigns.get(campaignId)).toMatchObject({ reviewStatus: "APPROVED" });
    expect(await findReceiptForCampaign(campaignId)).toMatchObject({ id: created.id, campaignVersion: 1, intents, humanReviewStatus: "APPROVED" });
  });

  it("refuse a stale campaign version, and an old receipt's review no longer touches the newer campaign", async () => {
    const campaignId = randomUUID();
    await repos.campaigns.saveVersion(campaignId, { hook: "v1" }, "pulse");
    const v1 = await createReceipt({ edit, intent, decision, campaignId, campaignVersion: 1 });
    await repos.campaigns.saveVersion(campaignId, { hook: "v2" }, "ed");

    await expect(createReceipt({ edit, intent, decision, campaignId, campaignVersion: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    await recordReview(v1.id, { status: "APPROVED", reviewer: "Ed" }, noGuard);
    const campaign = await repos.campaigns.get(campaignId);
    expect(campaign.reviewStatus).toBeUndefined();
    expect(campaign.receiptId).toBeUndefined();
  });
});
