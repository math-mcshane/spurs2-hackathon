import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { BlockerSchema, EvidenceSchema, RightsReceiptSchema, type Evidence, type RightsReceipt } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import type { GoalRun } from "@/features/pulse/types";
import { assertGoalRunId, assertUuid, casUpdate, goalRunColumns, parseEvaluation } from "./shared";
import type {
  AlternativeRecord,
  AuditEvent,
  CampaignRecord,
  CampaignVersion,
  EvaluationRecord,
  Repositories,
  ReviewRecord,
  WritebackAttempt,
} from "./types";

/**
 * TEST-ONLY in-memory repositories with the same semantics as the Supabase adapter (versioning,
 * append-only records, sha256 event chain). Production code never selects this; tests opt in through
 * `repositories/testing.ts`.
 */
export function memoryRepositories(): Repositories {
  const now = () => new Date().toISOString();
  const clone = <T>(v: T): T => structuredClone(v);

  const goalRuns = new Map<string, { run: GoalRun; version: number; createdAt: number }>();
  let goalSeq = 0;
  type Campaign = Omit<CampaignRecord, "draft"> & { versions: CampaignVersion[] };
  const campaigns = new Map<string, Campaign>();
  const evaluations: EvaluationRecord[] = [];
  const alternatives: AlternativeRecord[] = [];
  const events: AuditEvent[] = [];
  const writebacks: WritebackAttempt[] = [];
  const observationCache = new Map<string, unknown>();
  const receipts = new Map<string, { receipt: RightsReceipt; version: number; createdAt: number }>();
  let receiptSeq = 0;
  const reviews: (ReviewRecord & { receiptId: string })[] = [];
  const observations: Evidence[] = [];

  function campaignOf(id: string): Campaign {
    const c = campaigns.get(id);
    if (!c) throw new AppError("NOT_FOUND", `Campaign ${id} not found`);
    return c;
  }
  function campaignRecord(c: Campaign): CampaignRecord {
    const { versions, ...rest } = c;
    return clone({ ...rest, draft: versions.at(-1)!.draft });
  }
  function receiptExists(id: string | undefined): void {
    if (id !== undefined && !receipts.has(id)) throw new AppError("BAD_REQUEST", `Receipt ${id} does not exist`);
  }
  function eventHash(e: Omit<AuditEvent, "hash">): string {
    return createHash("sha256")
      .update(JSON.stringify([e.prevHash, e.id, e.subjectType, e.subjectId, e.type, e.actor, e.payload, e.at]))
      .digest("hex");
  }

  return {
    goalRuns: {
      async create(run) {
        const id = assertGoalRunId(run);
        goalRunColumns(run);
        if (goalRuns.has(id)) throw new AppError("BAD_REQUEST", `Goal ${id} already exists`);
        goalRuns.set(id, { run: clone(run), version: 1, createdAt: goalSeq++ });
        return run;
      },
      async get(id) {
        const stored = goalRuns.get(id);
        if (!stored) throw new AppError("NOT_FOUND", `Goal ${id} not found`);
        return clone(stored.run);
      },
      async getVersioned(id) {
        const stored = goalRuns.get(id);
        if (!stored) throw new AppError("NOT_FOUND", `Goal ${id} not found`);
        return { run: clone(stored.run), version: stored.version };
      },
      async latest() {
        const newest = [...goalRuns.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
        return newest ? clone(newest.run) : null;
      },
      async update(id, mutate, expectedVersion) {
        const { value } = await casUpdate(
          `Goal ${id}`,
          async () => {
            const stored = goalRuns.get(id);
            if (!stored) throw new AppError("NOT_FOUND", `Goal ${id} not found`);
            return { value: clone(stored.run), version: stored.version };
          },
          async (next, version) => {
            const stored = goalRuns.get(id)!;
            if (assertGoalRunId(next) !== id) throw new AppError("BAD_REQUEST", "A goal run's id cannot change");
            goalRunColumns(next);
            if (stored.version !== version) return false;
            goalRuns.set(id, { ...stored, run: clone(next), version: version + 1 });
            return true;
          },
          mutate,
          expectedVersion,
        );
        return value;
      },
    },

    campaigns: {
      async saveVersion(campaignId, draft, actor, link) {
        assertUuid(campaignId, "campaignId");
        const at = now();
        let c = campaigns.get(campaignId);
        if (!c) {
          if (link?.goalRunId && !goalRuns.has(link.goalRunId)) throw new AppError("BAD_REQUEST", `Goal ${link.goalRunId} does not exist`);
          if (link?.opportunityId && [...campaigns.values()].some((x) => x.opportunityId === link.opportunityId)) {
            throw new AppError("BAD_REQUEST", `Opportunity ${link.opportunityId} already has a campaign`);
          }
          c = { id: campaignId, goalRunId: link?.goalRunId, opportunityId: link?.opportunityId, currentVersion: 0, status: "DRAFT", createdAt: at, updatedAt: at, versions: [] };
          campaigns.set(campaignId, c);
        }
        c.currentVersion += 1;
        c.updatedAt = at;
        c.versions.push({ version: c.currentVersion, draft: clone(draft), actor, createdAt: at });
        return c.currentVersion;
      },
      async get(campaignId) {
        assertUuid(campaignId, "campaignId");
        return campaignRecord(campaignOf(campaignId));
      },
      async findByGoalRun(goalRunId) {
        return [...campaigns.values()].filter((c) => c.goalRunId === goalRunId).map(campaignRecord);
      },
      async findByOpportunity(opportunityId) {
        const c = [...campaigns.values()].find((x) => x.opportunityId === opportunityId);
        return c ? campaignRecord(c) : null;
      },
      async listVersions(campaignId) {
        assertUuid(campaignId, "campaignId");
        return clone(campaigns.get(campaignId)?.versions ?? []);
      },
      async setState(campaignId, state) {
        assertUuid(campaignId, "campaignId");
        const c = campaignOf(campaignId);
        receiptExists(state.receiptId);
        if (state.status !== undefined) c.status = state.status;
        if (state.reviewStatus !== undefined) c.reviewStatus = state.reviewStatus;
        if (state.receiptId !== undefined) c.receiptId = state.receiptId;
        c.updatedAt = now();
      },
    },

    evaluations: {
      async record(raw) {
        const { input, policyKind } = parseEvaluation(raw);
        if (input.campaignId !== undefined && !campaignOf(input.campaignId).versions.some((v) => v.version === input.campaignVersion)) {
          throw new AppError("BAD_REQUEST", `Campaign ${input.campaignId} has no version ${input.campaignVersion}`);
        }
        receiptExists(input.receiptId);
        const { clearance, verdict } = input.decision;
        if (clearance === "VERIFIED" && !(verdict === "ALLOWED" && policyKind === "VERIFIED")) {
          throw new AppError("BAD_REQUEST", "VERIFIED clearance requires ALLOWED under a verified policy");
        }
        if (clearance !== "NONE" && verdict !== "ALLOWED") throw new AppError("BAD_REQUEST", "Clearance requires an ALLOWED verdict");
        const record: EvaluationRecord = { ...input, id: randomUUID(), policyKind, createdAt: now() };
        evaluations.push(clone(record));
        return record;
      },
      async listForCampaign(campaignId) {
        return clone(evaluations.filter((e) => e.campaignId === campaignId));
      },
    },

    alternatives: {
      async record(input) {
        assertUuid(input.evaluationId, "evaluationId");
        if (!evaluations.some((e) => e.id === input.evaluationId)) throw new AppError("BAD_REQUEST", `Evaluation ${input.evaluationId} does not exist`);
        const record: AlternativeRecord = {
          id: randomUUID(),
          evaluationId: input.evaluationId,
          blocker: BlockerSchema.parse(input.blocker),
          candidates: clone(input.candidates),
          createdAt: now(),
        };
        alternatives.push(clone(record));
        return record;
      },
      async listForEvaluation(evaluationId) {
        return clone(alternatives.filter((a) => a.evaluationId === evaluationId));
      },
    },

    events: {
      async append(input) {
        const prev = events.at(-1);
        const base = { ...clone(input), payload: clone(input.payload ?? {}), id: (prev?.id ?? 0) + 1, prevHash: prev?.hash ?? null, at: now() };
        const event: AuditEvent = { ...base, hash: eventHash(base) };
        events.push(event);
        return clone(event);
      },
      async list(subjectType, subjectId) {
        return clone(events.filter((e) => e.subjectType === subjectType && e.subjectId === subjectId));
      },
      async verifyChain() {
        let prevHash: string | null = null;
        for (const e of events) {
          const { hash, ...rest } = e;
          if (e.prevHash !== prevHash || hash !== eventHash(rest)) return e.id;
          prevHash = hash;
        }
        return null;
      },
    },

    writebackAttempts: {
      async record(input) {
        receiptExists(input.receiptId);
        const record: WritebackAttempt = { ...clone(input), id: randomUUID(), createdAt: now() };
        writebacks.push(clone(record));
        return record;
      },
      async listForReceipt(receiptId) {
        return clone(writebacks.filter((w) => w.receiptId === receiptId));
      },
    },

    observationCache: {
      async get(videoId, modelKey) {
        return clone(observationCache.get(`${videoId}\u0000${modelKey}`));
      },
      async put(videoId, modelKey, value) {
        observationCache.set(`${videoId}\u0000${modelKey}`, clone(value));
      },
    },

    receipts: {
      async insert(receipt) {
        if (receipts.has(receipt.id)) throw new AppError("BAD_REQUEST", `Receipt ${receipt.id} already exists`);
        if (receipt.campaignId !== undefined) campaignOf(receipt.campaignId);
        receipts.set(receipt.id, { receipt: RightsReceiptSchema.parse(clone(receipt)), version: 1, createdAt: receiptSeq++ });
      },
      async load(id) {
        const stored = receipts.get(id);
        if (!stored) throw new AppError("NOT_FOUND", `Receipt ${id} not found`);
        return { receipt: clone(stored.receipt), version: stored.version };
      },
      async compareAndSet(id, version, next) {
        const stored = receipts.get(id);
        if (!stored || stored.version !== version) return false;
        receipts.set(id, { ...stored, receipt: clone(next), version: version + 1 });
        return true;
      },
      async latestForCampaign(campaignId) {
        const newest = [...receipts.values()]
          .filter((r) => r.receipt.campaignId === campaignId)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        return newest ? clone(newest.receipt) : null;
      },
      async findForEdit(editId, policyVersion) {
        return [...receipts.values()]
          .filter((r) => r.receipt.edit.id === editId && r.receipt.decision.policyVersion === policyVersion)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((r) => clone(r.receipt));
      },
      async addReview(receiptId, review) {
        receiptExists(receiptId);
        reviews.push({ ...review, receiptId });
      },
      async listReviews(receiptId) {
        return reviews.filter((r) => r.receiptId === receiptId).map(({ receiptId: _, ...r }) => r);
      },
    },

    humanObservations: {
      async add(evidence) {
        observations.push(EvidenceSchema.parse(clone(evidence)));
      },
      async list(scoreplayMediaId) {
        return z.array(EvidenceSchema).parse(clone(observations.filter((e) => e.scoreplayMediaId === scoreplayMediaId)));
      },
    },
  };
}
