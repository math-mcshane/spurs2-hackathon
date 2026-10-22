/**
 * REROUTE shared contracts (spec v1.1 §6). Single source of truth for every module.
 * Changing a shape here is a cross-team change: coordinate before editing.
 */
import { z } from "zod";

// ---------- Core spec types (§6) ----------

export const VerdictSchema = z.enum(["ALLOWED", "BLOCKED", "NEEDS_REVIEW"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const UsageSchema = z.enum(["ORGANIC", "SPONSORED"]);
export type Usage = z.infer<typeof UsageSchema>;

export const PublishIntentSchema = z.object({
  territory: z.string().min(2), // ISO-3166 alpha-2: FR / US / GB
  platform: z.string().min(1), // instagram / youtube / tiktok / x ...
  usage: UsageSchema,
  competition: z.string().min(1), // NBA / Premier League ...
  publishAt: z.iso.datetime({ offset: true }),
});
export type PublishIntent = z.infer<typeof PublishIntentSchema>;

export const EvidenceSourceSchema = z.enum(["TWELVELABS", "SCOREPLAY", "HUMAN"]);

/** Provenance of data shown to the user. Never present CACHED or HUMAN data as LIVE. */
export const DataOriginSchema = z.enum(["LIVE", "CACHED", "HUMAN"]);
export type DataOrigin = z.infer<typeof DataOriginSchema>;

export const EvidenceSchema = z.object({
  scoreplayMediaId: z.string(),
  start: z.number().nonnegative().optional(), // seconds
  end: z.number().nonnegative().optional(), // seconds
  observation: z.string(),
  source: EvidenceSourceSchema,
  /** Optional machine-readable tag the policy engine can match (e.g. "brand:acme-energy"). */
  label: z.string().optional(),
  /** Confidence in the OBSERVATION (never a legal confidence). 0..1 */
  confidence: z.number().min(0).max(1).optional(),
  /** LIVE/CACHED for TwelveLabs/ScorePlay results, HUMAN for producer-entered observations. Unset = unknown origin. */
  origin: DataOriginSchema.optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** Rights dimensions the engine MUST check (§1). */
export const DimensionSchema = z.enum([
  "territory",
  "platform",
  "usage",
  "competition",
  "people",
  "sponsor",
  "expiry",
]);
export type Dimension = z.infer<typeof DimensionSchema>;
export const MANDATORY_DIMENSIONS: readonly Dimension[] = DimensionSchema.options;

export const ReasonSchema = z.object({
  ruleId: z.string(),
  dimension: z.string(),
  explanation: z.string(),
  /** DENY = verified prohibition, PERMIT = affirmative permission, MISSING = unknown/uncertain. */
  outcome: z.enum(["DENY", "PERMIT", "MISSING"]),
  scoreplayMediaId: z.string().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
});
export type Reason = z.infer<typeof ReasonSchema>;

export const DecisionSchema = z.object({
  verdict: VerdictSchema,
  reasons: z.array(ReasonSchema),
  missingFacts: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
  policyVersion: z.string(),
  /** Policy id + whether it is fictional demo data (must be shown in UI + receipt). */
  policyId: z.string(),
  policyFictional: z.boolean(),
  evaluatedAt: z.iso.datetime({ offset: true }),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const HumanReviewStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type HumanReviewStatus = z.infer<typeof HumanReviewStatusSchema>;

// ---------- Media model ----------

/** Rights facts read from ScorePlay metadata. `undefined` = unknown (→ NEEDS_REVIEW, never ALLOWED). */
export const RightsFactsSchema = z.object({
  competition: z.string().optional(),
  team: z.string().optional(),
  people: z.array(z.string()).optional(),
  sponsors: z.array(z.string()).optional(),
  recordedAt: z.string().optional(),
});
export type RightsFacts = z.infer<typeof RightsFactsSchema>;

export const AssetSchema = z.object({
  id: z.string(), // ScorePlay asset/media id — the canonical id everywhere (also TwelveLabs custom_id)
  title: z.string(),
  kind: z.enum(["video", "image", "other"]),
  thumbnailUrl: z.string().optional(),
  previewUrl: z.string().optional(), // authorized ScorePlay preview/stream URL only
  durationSec: z.number().optional(),
  tags: z.array(z.string()),
  facts: RightsFactsSchema,
  /** Raw ScorePlay metadata subset for display/debug. */
  metadata: z.record(z.string(), z.unknown()),
  origin: DataOriginSchema,
});
export type Asset = z.infer<typeof AssetSchema>;

/** A time range of one ScorePlay asset. */
export const SegmentSchema = z.object({
  scoreplayMediaId: z.string(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  label: z.string().optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;

/** An output edit = ordered segments. Every constituent segment is checked independently. */
export const EditPlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  segments: z.array(SegmentSchema).min(1),
  /** True when REROUTE produced this plan (derivative ⇒ distinct asset needing its own decision). */
  derived: z.boolean(),
  derivedFrom: z.string().optional(),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

export const SegmentDecisionSchema = z.object({
  segment: SegmentSchema,
  decision: DecisionSchema,
});
export type SegmentDecision = z.infer<typeof SegmentDecisionSchema>;

/** Decision over a whole edit: aggregate + per-segment breakdown (for the timeline). */
export const EditDecisionSchema = z.object({
  edit: EditPlanSchema,
  decision: DecisionSchema,
  segments: z.array(SegmentDecisionSchema),
});
export type EditDecision = z.infer<typeof EditDecisionSchema>;

// ---------- TwelveLabs ----------

export const SearchHitSchema = z.object({
  scoreplayMediaId: z.string(), // from TwelveLabs custom_id
  twelvelabsVideoId: z.string(),
  start: z.number(),
  end: z.number(),
  rank: z.number().int().positive(),
  score: z.number().optional(),
  thumbnailUrl: z.string().optional(),
  origin: DataOriginSchema,
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const CandidateSchema = z.object({
  hit: SearchHitSchema,
  /** The replacement edit that would result from swapping this hit in. */
  proposedEdit: EditPlanSchema,
  /** Independent decision for the candidate segment alone. */
  segmentDecision: DecisionSchema,
  /** Decision for the full proposed edit (all segments re-checked). */
  editDecision: EditDecisionSchema,
  eligible: z.boolean(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

// ---------- Receipt ----------

export const RightsReceiptSchema = z.object({
  id: z.string(),
  sourceAssetIds: z.array(z.string()),
  derivativeAssetId: z.string().optional(),
  intent: PublishIntentSchema,
  decision: DecisionSchema,
  edit: EditPlanSchema,
  humanReviewStatus: HumanReviewStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  writeback: z
    .object({
      scoreplayMediaId: z.string(),
      status: z.enum(["WRITTEN", "VERIFIED", "FAILED"]),
      at: z.string(),
      detail: z.string().optional(),
    })
    .array()
    .default([]),
});
export type RightsReceipt = z.infer<typeof RightsReceiptSchema>;

// ---------- API contracts (§7) ----------

/** GET /api/assets?q=&limit= */
export const AssetsResponseSchema = z.object({ assets: z.array(AssetSchema) });

/** POST /api/decide */
export const DecideRequestSchema = z.object({ edit: EditPlanSchema, intent: PublishIntentSchema });
export const DecideResponseSchema = EditDecisionSchema;

/** POST /api/resolve — replace one blocked segment of `edit` by searching comparable footage. */
export const ResolveRequestSchema = z.object({
  edit: EditPlanSchema,
  intent: PublishIntentSchema,
  segmentIndex: z.number().int().nonnegative(),
  /** Natural-language description of the shot to find (defaults to segment label/observations). */
  query: z.string().optional(),
  limit: z.number().int().min(1).max(10).default(3),
});
export const ResolveResponseSchema = z.object({
  query: z.string(),
  candidates: z.array(CandidateSchema), // ranked; eligible first
  best: CandidateSchema.optional(), // only if eligible (editDecision ALLOWED)
});

/** POST /api/access — server-side gate. Re-evaluates; never trusts a client-sent verdict. */
export const AccessActionSchema = z.enum(["PREVIEW", "EXPORT", "RENDER", "DELIVER"]);
export const AccessRequestSchema = z.object({
  edit: EditPlanSchema,
  intent: PublishIntentSchema,
  action: AccessActionSchema,
});
export const AccessResponseSchema = z.object({
  granted: z.boolean(),
  uiAction: z.enum(["USE", "BLOCKED", "REQUEST_REVIEW"]),
  decision: DecisionSchema,
  receiptId: z.string().optional(), // set when NEEDS_REVIEW created a review request
});

/** POST /api/writeback */
export const WritebackRequestSchema = z.object({
  receiptId: z.string(),
});
export const WritebackResponseSchema = z.object({
  receipt: RightsReceiptSchema,
  /** What ScorePlay returned when re-read after writing (proves persistence). */
  readBack: z.record(z.string(), z.unknown()),
});

/** POST /api/render — optional, gated by MEDIA_PROCESSING_APPROVED + access gate. */
export const RenderRequestSchema = z.object({ edit: EditPlanSchema, intent: PublishIntentSchema });
export const RenderResponseSchema = z.object({
  receipt: RightsReceiptSchema, // derivative = new asset, fresh decision, review PENDING
  outputUrl: z.string().optional(),
});

/** POST /api/receipts — create; GET /api/receipts/[id]; POST /api/receipts/[id]/review */
export const CreateReceiptRequestSchema = z.object({ edit: EditPlanSchema, intent: PublishIntentSchema });
export const ReviewRequestSchema = z.object({ status: z.enum(["APPROVED", "REJECTED"]), reviewer: z.string() });

/** Uniform error body for every route. */
export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.enum(["BAD_REQUEST", "NOT_CONFIGURED", "UPSTREAM", "FORBIDDEN", "NOT_FOUND", "INTERNAL"]),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------- Module seams (implemented by owners; consumed by API routes) ----------

export interface ScorePlayClient {
  searchAssets(query: string, limit?: number): Promise<Asset[]>;
  getAsset(id: string): Promise<Asset>;
  /** Writes verdict/reasons/tags/timecoded actions per agreed taxonomy; returns the raw re-read. */
  writeDecision(receipt: RightsReceipt): Promise<Record<string, unknown>>;
  /** Optional: upload a derivative as its own asset. Throws NOT_CONFIGURED if not permitted. */
  uploadDerivative?(file: { path: string; title: string }, receipt: RightsReceipt): Promise<{ id: string }>;
}

export interface VideoIntelligence {
  /** Marengo search on the pre-indexed footage; maps custom_id → scoreplayMediaId. */
  search(query: string, opts?: { limit?: number; excludeMediaIds?: string[] }): Promise<SearchHit[]>;
  /** Timecoded observations for one asset (Pegasus or recorded/cached). */
  observations(scoreplayMediaId: string): Promise<Evidence[]>;
}
