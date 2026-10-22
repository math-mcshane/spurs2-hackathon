import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { Decision, EditPlan, MediaRef, PublishIntent, RightsReceipt } from "@/lib/contracts";
import type { GoalRun } from "@/features/pulse/types";
import { memoryRepositories } from "./memory";
import { supabaseRepositories } from "./supabase";
import type { Repositories } from "./types";

/**
 * One contract suite, two backends: the test-only memory adapter (always) and the Supabase adapter against
 * the LOCAL docker database (only when SUPABASE_URL points at 127.0.0.1/localhost — never a shared project).
 */

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SECRET_KEY ?? "";
const LOCAL_SUPABASE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url) && key.length > 0;

const freshClient = (): SupabaseClient => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const intent: PublishIntent = {
  territory: "GB",
  platform: "instagram",
  usage: "ORGANIC",
  competition: "Premier League",
  publishAt: "2026-10-25T12:00:00.000Z",
  club: "tottenham",
};

const decision = (over: Partial<Decision> = {}): Decision => ({
  verdict: "NEEDS_REVIEW",
  reasons: [{ ruleId: "people", dimension: "PEOPLE", outcome: "MISSING", explanation: "No player consent on file", basis: "LEGAL_ENTITLEMENT" }],
  missingFacts: ["people"],
  evidence: [],
  policyVersion: "demo-1",
  policyId: "demo-tottenham",
  policyFictional: true,
  clearance: "NONE",
  evaluatedAt: "2026-10-22T20:00:00.000Z",
  ...over,
});

const mediaRef = (scoreplayMediaId: string): MediaRef => ({
  scoreplayMediaId,
  twelvelabsIndexId: "idx",
  twelvelabsVideoId: `tl-${scoreplayMediaId}`,
  method: "FILENAME_DURATION",
  candidates: [],
  checkedAt: "2026-10-22T20:00:00.000Z",
});

const edit = (id = `edit-${randomUUID()}`): EditPlan => ({
  id,
  title: "Spurs at Old Trafford",
  segments: [{ scoreplayMediaId: "101", start: 3, end: 9 }],
  derived: false,
});

const goalRun = (id = `goal-${randomUUID()}`) =>
  ({ id, schemaVersion: 2, club: "tottenham", objective: { raw: "Promote Tottenham merchandise to UK fans" } }) as unknown as GoalRun;

const receipt = (over: Partial<RightsReceipt> = {}): RightsReceipt => ({
  id: randomUUID(),
  sourceAssetIds: ["101"],
  intent,
  decision: decision(),
  edit: edit(),
  media: [mediaRef("101")],
  humanReviewStatus: "PENDING",
  createdAt: new Date().toISOString(),
  writeback: [],
  ...over,
});

function contract(name: string, make: () => Repositories, restart: () => Repositories) {
  describe(name, () => {
    it("goal runs: create, read back, optimistic versioned update", async () => {
      const repos = make();
      const run = goalRun();
      await repos.goalRuns.create(run);
      expect(await repos.goalRuns.get(run.id)).toMatchObject({ id: run.id, club: "tottenham" });
      expect((await repos.goalRuns.getVersioned(run.id)).version).toBe(1);

      const updated = await repos.goalRuns.update(run.id, (r) => {
        r.selectedKey = "101@3-9";
      });
      expect(updated.selectedKey).toBe("101@3-9");
      expect(await repos.goalRuns.getVersioned(run.id)).toMatchObject({ version: 2, run: { selectedKey: "101@3-9" } });

      // A stale client (expected v1) must not overwrite v2.
      await expect(repos.goalRuns.update(run.id, (r) => void (r.selectedKey = "stale"), 1)).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await restart().goalRuns.get(run.id)).selectedKey).toBe("101@3-9");
      await expect(repos.goalRuns.update(run.id, (r) => void (r.selectedKey = "202@0-4"), 2)).resolves.toMatchObject({ selectedKey: "202@0-4" });

      await expect(repos.goalRuns.get(`goal-${randomUUID()}`)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(repos.goalRuns.update(run.id, (r) => ({ ...r, id: "other" }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("goal runs: concurrent updates are merged, not lost", async () => {
      const repos = make();
      const run = goalRun();
      await repos.goalRuns.create(run);
      await Promise.all([
        repos.goalRuns.update(run.id, (r) => void (r.match = "Manchester United v Tottenham")),
        repos.goalRuns.update(run.id, (r) => void (r.selectedKey = "101@3-9")),
      ]);
      expect(await restart().goalRuns.get(run.id)).toMatchObject({ match: "Manchester United v Tottenham", selectedKey: "101@3-9" });
    });

    it("goal runs: latest() returns the newest run", async () => {
      const repos = make();
      const first = goalRun();
      const second = goalRun();
      await repos.goalRuns.create(first);
      await repos.goalRuns.create(second);
      expect((await repos.goalRuns.latest())?.id).toBe(second.id);
    });

    it("campaigns: stable id, every edit appends a version, history survives restart", async () => {
      const repos = make();
      const run = goalRun();
      await repos.goalRuns.create(run);
      const campaignId = randomUUID();
      expect(await repos.campaigns.saveVersion(campaignId, { hook: "v1" }, "pulse", { goalRunId: run.id })).toBe(1);
      expect(await repos.campaigns.saveVersion(campaignId, { hook: "v2" }, "ed")).toBe(2);
      const versions = await Promise.all([3, 4].map((n) => repos.campaigns.saveVersion(campaignId, { hook: `v${n}` }, "ed")));
      expect(versions.sort()).toEqual([3, 4]);

      const after = restart();
      const record = await after.campaigns.get(campaignId);
      expect(record).toMatchObject({ id: campaignId, goalRunId: run.id, currentVersion: 4, status: "DRAFT" });
      expect((await after.campaigns.listVersions(campaignId)).map((v) => [v.version, v.actor])).toEqual([
        [1, "pulse"],
        [2, "ed"],
        [3, "ed"],
        [4, "ed"],
      ]);
      expect((await after.campaigns.listVersions(campaignId))[0].draft).toEqual({ hook: "v1" });
      expect((await after.campaigns.findByGoalRun(run.id)).map((c) => c.id)).toEqual([campaignId]);
      await expect(repos.campaigns.saveVersion("not-a-uuid", {}, "x")).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(repos.campaigns.get(randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("campaigns: board proposals are found by opportunity", async () => {
      const repos = make();
      const opportunityId = `opp-${randomUUID()}`;
      expect(await repos.campaigns.findByOpportunity(opportunityId)).toBeNull();
      const id = randomUUID();
      await repos.campaigns.saveVersion(id, { n: 1 }, "pulse-board", { opportunityId });
      expect(await repos.campaigns.findByOpportunity(opportunityId)).toMatchObject({ id, draft: { n: 1 } });
    });

    it("campaigns: a new version clears status, review and receipt; receipts pin their campaign version", async () => {
      const repos = make();
      const campaignId = randomUUID();
      await repos.campaigns.saveVersion(campaignId, { hook: "v1" }, "pulse");
      // A campaign receipt must name the campaign version it covers, and that version must exist.
      await expect(repos.receipts.insert(receipt({ campaignId }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(repos.receipts.insert(receipt({ campaignId }), 7)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const r = receipt({ campaignId, intents: [intent, { ...intent, platform: "tiktok" }] });
      await repos.receipts.insert(r, 1);
      await repos.campaigns.setState(campaignId, { receiptId: r.id, reviewStatus: "APPROVED", status: "APPROVED" });

      expect(await repos.campaigns.saveVersion(campaignId, { hook: "v2" }, "ed")).toBe(2);
      const after = restart();
      const record = await after.campaigns.get(campaignId);
      expect(record).toMatchObject({ currentVersion: 2, status: "DRAFT" });
      expect(record.reviewStatus).toBeUndefined();
      expect(record.receiptId).toBeUndefined();
      const row = await after.receipts.load(r.id);
      expect(row).toMatchObject({ campaignVersion: 1, receipt: { intents: [{ platform: "instagram" }, { platform: "tiktok" }] } });
    });

    it("receipts link to campaigns; evaluations, alternatives, writeback attempts record the trail", async () => {
      const repos = make();
      const campaignId = randomUUID();
      await repos.campaigns.saveVersion(campaignId, { hook: "v1" }, "pulse");
      const r = receipt({ campaignId });
      await repos.receipts.insert(r, 1);
      await repos.campaigns.setState(campaignId, { receiptId: r.id, reviewStatus: "PENDING", status: "SUBMITTED" });

      const original = await repos.evaluations.record({
        campaignId,
        campaignVersion: 1,
        receiptId: r.id,
        kind: "ORIGINAL",
        media: [mediaRef("101")],
        intent,
        decision: decision({ verdict: "BLOCKED" }),
      });
      expect(original).toMatchObject({ kind: "ORIGINAL", scoreplayMediaIds: ["101"], policyKind: "DEMO" });
      const alternative = await repos.evaluations.record({
        campaignId,
        campaignVersion: 1,
        kind: "ALTERNATIVE",
        media: [mediaRef("202")],
        intent,
        decision: decision({ verdict: "ALLOWED", clearance: "DEMO" }),
      });
      const alt = await repos.alternatives.record({
        evaluationId: original.id,
        blocker: { scope: "CLIP", dimensions: ["PEOPLE"], ruleIds: ["people"], explanation: "Player restricted" },
        candidates: [{ evaluationId: alternative.id }],
      });
      const wb = await repos.writebackAttempts.record({ receiptId: r.id, mode: "DRY_RUN", status: "DRY_RUN", planned: [{ method: "POST", path: "/video/logs" }], actor: "ed" });

      const after = restart();
      expect(await after.campaigns.get(campaignId)).toMatchObject({ receiptId: r.id, reviewStatus: "PENDING", status: "SUBMITTED" });
      expect(await after.receipts.latestForCampaign(campaignId)).toMatchObject({
        campaignVersion: 1,
        receipt: { id: r.id, campaignId, media: [{ scoreplayMediaId: "101" }] },
      });
      expect((await after.receipts.findForEdit(r.edit.id, "demo-1")).map((x) => x.receipt.id)).toEqual([r.id]);
      expect(await after.receipts.findForEdit(r.edit.id, "other-version")).toEqual([]);
      expect((await after.evaluations.listForCampaign(campaignId)).map((e) => e.kind)).toEqual(["ORIGINAL", "ALTERNATIVE"]);
      expect(await after.alternatives.listForEvaluation(original.id)).toEqual([alt]);
      expect(await after.writebackAttempts.listForReceipt(r.id)).toEqual([wb]);

      // Product rule enforced by the store too: VERIFIED clearance needs ALLOWED under a verified policy.
      await expect(
        repos.evaluations.record({ kind: "ORIGINAL", media: [], intent, decision: decision({ verdict: "ALLOWED", clearance: "VERIFIED", policyFictional: true }) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      // An evaluation can only reference a campaign version that exists.
      await expect(
        repos.evaluations.record({ campaignId, campaignVersion: 9, kind: "ORIGINAL", media: [], intent, decision: decision() }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("receipts: compare-and-set rejects a stale version", async () => {
      const repos = make();
      const r = receipt();
      await repos.receipts.insert(r);
      const { version } = await repos.receipts.load(r.id);
      expect(await repos.receipts.compareAndSet(r.id, version, { ...r, humanReviewStatus: "APPROVED" })).toBe(true);
      expect(await repos.receipts.compareAndSet(r.id, version, { ...r, humanReviewStatus: "REJECTED" })).toBe(false);
      expect((await restart().receipts.load(r.id)).receipt.humanReviewStatus).toBe("APPROVED");
      await repos.receipts.addReview(r.id, { status: "APPROVED", reviewer: "ed", at: "2026-10-22T20:00:00.000Z" });
      expect(await restart().receipts.listReviews(r.id)).toEqual([{ status: "APPROVED", reviewer: "ed", at: "2026-10-22T20:00:00.000Z" }]);
    });

    it("events: hash-chained, ordered, verifiable", async () => {
      const repos = make();
      const subjectId = randomUUID();
      const a = await repos.events.append({ subjectType: "receipt", subjectId, type: "RECEIPT_CREATED", actor: "system", payload: { v: 1 } });
      const b = await repos.events.append({ subjectType: "receipt", subjectId, type: "REVIEW_RECORDED", actor: "ed", payload: { status: "APPROVED" } });
      expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(b.prevHash).toBe(a.hash);
      expect(b.id).toBeGreaterThan(a.id);
      expect((await restart().events.list("receipt", subjectId)).map((e) => e.type)).toEqual(["RECEIPT_CREATED", "REVIEW_RECORDED"]);
      expect(await repos.events.verifyChain()).toBeNull();
    });

    it("observation cache: upsert, latest wins, survives restart", async () => {
      const repos = make();
      const videoId = `tl-${randomUUID()}`;
      expect(await repos.observationCache.get(videoId, "pegasus-1.2")).toBeUndefined();
      await repos.observationCache.put(videoId, "pegasus-1.2", { data: "first" });
      await repos.observationCache.put(videoId, "pegasus-1.2", { data: "second" });
      expect(await restart().observationCache.get(videoId, "pegasus-1.2")).toEqual({ data: "second" });
    });

    it("human observations persist", async () => {
      const repos = make();
      const mediaId = `m-${randomUUID()}`;
      await repos.humanObservations.add({ scoreplayMediaId: mediaId, observation: "Sponsor board at 0:12", source: "HUMAN", origin: "HUMAN", start: 12, end: 14 });
      expect(await restart().humanObservations.list(mediaId)).toMatchObject([{ observation: "Sponsor board at 0:12" }]);
    });
  });
}

// Memory: "restart" keeps the same instance (it is a stand-in for one process); persistence is Supabase's job.
let memory: Repositories;
contract(
  "memory repositories (test adapter)",
  () => (memory = memoryRepositories()),
  () => memory,
);

describe.skipIf(!LOCAL_SUPABASE)("supabase repositories (local docker)", () => {
  // Each `make()` and each `restart()` gets a brand-new client: reads after restart go through a new connection.
  contract(
    "contract",
    () => supabaseRepositories(() => freshClient()),
    () => supabaseRepositories(freshClient),
  );

  let db: SupabaseClient;
  let repos: Repositories;
  beforeAll(() => {
    db = freshClient();
    repos = supabaseRepositories(() => db);
  });

  it("append-only tables reject UPDATE and DELETE at the database", async () => {
    const event = await repos.events.append({ subjectType: "test", subjectId: randomUUID(), type: "T", actor: "t", payload: {} });
    const upd = await db.from("reroute_events").update({ actor: "tampered" }).eq("id", event.id);
    expect(upd.error?.message).toMatch(/append-only/);
    const del = await db.from("reroute_events").delete().eq("id", event.id);
    expect(del.error?.message).toMatch(/append-only/);

    const campaignId = randomUUID();
    await repos.campaigns.saveVersion(campaignId, { v: 1 }, "t");
    const rewrite = await db.from("reroute_campaign_versions").update({ draft: { v: "rewritten" } }).eq("campaign_id", campaignId);
    expect(rewrite.error?.message).toMatch(/append-only/);
    expect((await repos.campaigns.listVersions(campaignId))[0].draft).toEqual({ v: 1 });

    const evaluation = await repos.evaluations.record({ kind: "ORIGINAL", media: [], intent, decision: decision() });
    const evalDel = await db.from("reroute_evaluations").delete().eq("id", evaluation.id);
    expect(evalDel.error?.message).toMatch(/append-only/);
    expect(await repos.events.verifyChain()).toBeNull();
  });
});
