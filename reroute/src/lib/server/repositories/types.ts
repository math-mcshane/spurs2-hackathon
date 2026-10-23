import type {
  Blocker,
  Decision,
  Evidence,
  HumanReviewStatus,
  MediaRef,
  PublishIntent,
  RightsReceipt,
} from "@/lib/contracts";
import type { GoalRun } from "@/features/pulse/types";

/**
 * Persistence ports. Production: Supabase (`supabase.ts`). Tests only: in-memory (`memory.ts`, selected
 * explicitly via `testing.ts`). PULSE documents (goal runs, campaign drafts) are stored as opaque JSON and
 * validated by the feature that owns their schema.
 */

export type Versioned<T> = { value: T; version: number };

export interface GoalRunRepository {
  create(run: GoalRun): Promise<GoalRun>;
  /** Throws NOT_FOUND. */
  get(id: string): Promise<GoalRun>;
  getVersioned(id: string): Promise<{ run: GoalRun; version: number }>;
  /** Most recently created run, or null before the first goal. */
  latest(): Promise<GoalRun | null>;
  /**
   * Read-modify-write. Without `expectedVersion`, a concurrent write causes a re-read + retry; with it,
   * a mismatch is rejected (BAD_REQUEST) so a stale client never overwrites newer work.
   */
  update(id: string, mutate: (run: GoalRun) => void | GoalRun, expectedVersion?: number): Promise<GoalRun>;
}

export type CampaignRecord = {
  id: string;
  goalRunId?: string;
  opportunityId?: string;
  currentVersion: number;
  status: string;
  reviewStatus?: HumanReviewStatus;
  receiptId?: string;
  /** Draft of `currentVersion`. */
  draft: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CampaignVersion = { version: number; draft: unknown; actor: string; createdAt: string };

export interface CampaignRepository {
  /**
   * First call creates the campaign at version 1 (`campaignId` must be a uuid); later calls append the next
   * version atomically. Earlier versions are never modified.
   */
  saveVersion(
    campaignId: string,
    draft: unknown,
    actor: string,
    link?: { goalRunId?: string; opportunityId?: string },
  ): Promise<number>;
  /** Throws NOT_FOUND. */
  get(campaignId: string): Promise<CampaignRecord>;
  findByGoalRun(goalRunId: string): Promise<CampaignRecord[]>;
  findByOpportunity(opportunityId: string): Promise<CampaignRecord | null>;
  /** Oldest first. */
  listVersions(campaignId: string): Promise<CampaignVersion[]>;
  setState(campaignId: string, state: { status?: string; reviewStatus?: HumanReviewStatus; receiptId?: string }): Promise<void>;
}

export type EvaluationKind = "ORIGINAL" | "ALTERNATIVE";

export type EvaluationInput = {
  campaignId?: string;
  campaignVersion?: number;
  receiptId?: string;
  kind: EvaluationKind;
  media: MediaRef[];
  /** Defaults to the ScorePlay ids of `media`. */
  scoreplayMediaIds?: string[];
  intent: PublishIntent;
  decision: Decision;
};

export type EvaluationRecord = Omit<EvaluationInput, "scoreplayMediaIds"> & {
  id: string;
  scoreplayMediaIds: string[];
  policyKind?: "VERIFIED" | "DEMO";
  createdAt: string;
};

export interface EvaluationRepository {
  record(input: EvaluationInput): Promise<EvaluationRecord>;
  /** Oldest first. */
  listForCampaign(campaignId: string): Promise<EvaluationRecord[]>;
}

export type AlternativeRecord = { id: string; evaluationId: string; blocker: Blocker; candidates: unknown[]; createdAt: string };

export interface AlternativeRepository {
  record(input: { evaluationId: string; blocker: Blocker; candidates: unknown[] }): Promise<AlternativeRecord>;
  listForEvaluation(evaluationId: string): Promise<AlternativeRecord[]>;
}

export type AuditEventInput = { subjectType: string; subjectId: string; type: string; actor: string; payload: unknown };

export type AuditEvent = AuditEventInput & { id: number; prevHash: string | null; hash: string; at: string };

export interface EventRepository {
  /** Append-only; the store links each event to the previous one by sha256. */
  append(input: AuditEventInput): Promise<AuditEvent>;
  /** Chain order. */
  list(subjectType: string, subjectId: string): Promise<AuditEvent[]>;
  /** Id of the first event whose link or hash does not verify; null when the whole chain is intact. */
  verifyChain(): Promise<number | null>;
}

export type WritebackMode = "DRY_RUN" | "LIVE";
export type WritebackAttemptStatus = "DRY_RUN" | "REFUSED" | "WRITTEN" | "VERIFIED" | "FAILED";

export type WritebackAttemptInput = {
  receiptId: string;
  mode: WritebackMode;
  status: WritebackAttemptStatus;
  planned: unknown[];
  detail?: string;
  actor: string;
};

export type WritebackAttempt = WritebackAttemptInput & { id: string; createdAt: string };

export interface WritebackAttemptRepository {
  record(input: WritebackAttemptInput): Promise<WritebackAttempt>;
  /** Oldest first. */
  listForReceipt(receiptId: string): Promise<WritebackAttempt[]>;
}

export interface ObservationCacheRepository {
  get(twelvelabsVideoId: string, modelKey: string): Promise<unknown | undefined>;
  /** Upsert: the latest value wins. */
  put(twelvelabsVideoId: string, modelKey: string, value: unknown): Promise<void>;
}

export type ReviewRecord = { status: "APPROVED" | "REJECTED"; reviewer: string; at: string };

/** A stored receipt plus the campaign version it covers (a column, not part of the frozen receipt contract). */
export type ReceiptRow = { receipt: RightsReceipt; campaignVersion?: number };

/** Storage primitives behind `lib/server/store.ts` (which owns the receipt workflow rules). */
export interface ReceiptRepository {
  /** `campaignVersion` is required when `receipt.campaignId` is set. */
  insert(receipt: RightsReceipt, campaignVersion?: number): Promise<void>;
  /** Throws NOT_FOUND. */
  load(id: string): Promise<ReceiptRow & { version: number }>;
  /** Writes `next` only if the stored version is still `version`; false when someone else won. */
  compareAndSet(id: string, version: number, next: RightsReceipt): Promise<boolean>;
  latestForCampaign(campaignId: string): Promise<ReceiptRow | null>;
  /** Receipts for one edit id evaluated under `policyVersion`, newest first. */
  findForEdit(editId: string, policyVersion: string): Promise<ReceiptRow[]>;
  addReview(receiptId: string, review: ReviewRecord): Promise<void>;
  /** Oldest first. */
  listReviews(receiptId: string): Promise<ReviewRecord[]>;
}

export interface HumanObservationRepository {
  add(evidence: Evidence): Promise<void>;
  /** Oldest first. */
  list(scoreplayMediaId: string): Promise<Evidence[]>;
}

/** How an uploaded package reached the library (bundled presets are not stored). */
export type UploadedPolicySourceType = "UPLOADED_JSON" | "UPLOADED_CSV" | "SAMPLE_DOCUMENT_MAPPING";

/** An uploaded rule package. `kind` is always DEMO: an upload can never be verified clearance. */
export type StoredPolicyPackage = {
  id: string;
  version: string;
  club: string;
  title: string;
  kind: "DEMO";
  sourceType: UploadedPolicySourceType;
  /** The Policy document (PolicySchema-validated by `lib/rights/packages.ts`, kind forced to DEMO). */
  document: unknown;
  fileName?: string;
  sha256: string;
  uploadedBy: string;
  createdAt: string;
};

export type PolicySelectionRecord = { club: string; packageId: string; packageVersion: string; selectedBy: string; selectedAt: string };

export interface PolicyPackageRepository {
  /** Append-only; a duplicate (id, version) is rejected (CONFLICT). */
  insert(pkg: Omit<StoredPolicyPackage, "createdAt">): Promise<StoredPolicyPackage>;
  /** Every stored version, newest first. */
  list(): Promise<StoredPolicyPackage[]>;
  /** One version, or the newest version of `id` when `version` is omitted; null when absent. */
  get(id: string, version?: string): Promise<StoredPolicyPackage | null>;
  getSelection(club: string): Promise<PolicySelectionRecord | null>;
  /** Upsert: the latest choice for a club wins. */
  setSelection(selection: Omit<PolicySelectionRecord, "selectedAt">): Promise<PolicySelectionRecord>;
}

export interface Repositories {
  goalRuns: GoalRunRepository;
  campaigns: CampaignRepository;
  evaluations: EvaluationRepository;
  alternatives: AlternativeRepository;
  events: EventRepository;
  writebackAttempts: WritebackAttemptRepository;
  observationCache: ObservationCacheRepository;
  receipts: ReceiptRepository;
  humanObservations: HumanObservationRepository;
  policyPackages: PolicyPackageRepository;
}
