/**
 * REROUTE shared contracts (spec v1.1 §6). Single source of truth for every module.
 * Changing a shape here is a cross-team change: coordinate before editing.
 */
import { z } from "zod";

// ---------- Core spec types (§6) ----------

export const VerdictSchema = z.enum(["ALLOWED", "BLOCKED", "NEEDS_REVIEW"]);
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * EDITORIAL = news/match coverage; ORGANIC = unpaid club social; SPONSORED = paid boost / partner post;
 * COMMERCIAL = promotes a product or sale (merchandise, tickets) — strictest people/sponsor rules.
 */
export const UsageSchema = z.enum(["EDITORIAL", "ORGANIC", "SPONSORED", "COMMERCIAL"]);
export type Usage = z.infer<typeof UsageSchema>;

export const ClubCodeSchema = z.enum(["SAS", "TOT"]);
export type ClubCode = z.infer<typeof ClubCodeSchema>;

export const PublishIntentSchema = z.object({
  territory: z.string().min(2).max(8), // ISO-3166 alpha-2: FR / US / GB
  platform: z.string().min(1).max(40), // instagram / facebook / x / tiktok / youtube
  usage: UsageSchema,
  competition: z.string().min(1).max(80), // NBA / Premier League ...
  publishAt: z.iso.datetime({ offset: true }),
  /** Publishing club (CLUBS key, e.g. "tottenham", "spurs"). Drives policy selection; never inferred from footage. */
  club: z.string().max(40).optional(),
  /**
   * The partner a SPONSORED/COMMERCIAL post promotes, as the user named it (e.g. "AIA"). Absent = not named: the
   * policy's brand rules apply literally. Only the policy decides whether it is a partner — naming it grants nothing.
   */
  targetSponsor: z.string().trim().min(1).max(80).optional(),
  /** DEMO partner id from Supabase partners.id (e.g. partner-nike). */
  partnerId: z.string().min(1).optional(),
  /** Club context for partner discover / policy selection. */
  clubCode: ClubCodeSchema.optional(),
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
  /**
   * Which machine analysis run produced it (e.g. "pegasus:product", "pegasus:audit-2026-10-23"). Several runs of the
   * same video are all kept: where they disagree, the engine sees every observation (the conservative reading).
   */
  analysisRun: z.string().optional(),
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

/**
 * What a reason is about. A missing TECHNICAL_OBSERVATION (video analysis unavailable) is NOT a missing
 * LEGAL_ENTITLEMENT (no licence/rule covers the use). MEDIA_IDENTITY = ScorePlay↔TwelveLabs link unproven.
 * POLICY_SELECTION = no applicable policy for club/competition/provenance.
 */
export const ReasonBasisSchema = z.enum(["LEGAL_ENTITLEMENT", "TECHNICAL_OBSERVATION", "MEDIA_IDENTITY", "POLICY_SELECTION"]);
export type ReasonBasis = z.infer<typeof ReasonBasisSchema>;

export const ReasonSchema = z.object({
  ruleId: z.string(),
  dimension: z.string(),
  explanation: z.string(),
  /** DENY = verified prohibition, PERMIT = affirmative permission, MISSING = unknown/uncertain. */
  outcome: z.enum(["DENY", "PERMIT", "MISSING"]),
  /** Set by the engine on every reason it emits. */
  basis: ReasonBasisSchema.optional(),
  scoreplayMediaId: z.string().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
});
export type Reason = z.infer<typeof ReasonSchema>;

/**
 * VERIFIED = ALLOWED under a non-fictional, verified policy (the only clearance that can authorize publication).
 * DEMO = ALLOWED under a fictional demo policy — "DEMO POLICY — NOT VERIFIED LEGAL CLEARANCE".
 * NONE = not ALLOWED.
 */
export const ClearanceSchema = z.enum(["VERIFIED", "DEMO", "NONE"]);
export type Clearance = z.infer<typeof ClearanceSchema>;
export const DEMO_CLEARANCE_LABEL = "DEMO POLICY — NOT VERIFIED LEGAL CLEARANCE";

/** Why a policy was (not) chosen for this asset + intent. Selection never falls back to an unrelated club's policy. */
export const PolicySelectionSchema = z.object({
  /** null = no applicable policy → verdict NEEDS_REVIEW with a POLICY_SELECTION reason. */
  policyId: z.string().nullable(),
  kind: z.enum(["VERIFIED", "DEMO"]).nullable(),
  considered: z.array(z.object({ policyId: z.string(), applicable: z.boolean(), reason: z.string() })),
});
export type PolicySelection = z.infer<typeof PolicySelectionSchema>;

/**
 * Which brands a decision saw and how the policy treats each (sponsor dimension), for display. TARGET = the brand
 * the campaign promotes; OTHER_PARTNER = covered by an explicit partner rule; COMPETING_RESTRICTED = a restriction
 * rule names it; INCIDENTAL = only a rule covering every brand allows it; UNKNOWN = no rule describes it.
 */
export const SponsorshipSchema = z.object({
  /** null = the campaign names no target sponsor (or the use is not a paid/partner post). */
  target: z
    .object({ name: z.string(), label: z.string(), relationship: z.enum(["PARTNER", "UNKNOWN"]), ruleId: z.string().optional() })
    .nullable(),
  brands: z.array(
    z.object({
      name: z.string(),
      label: z.string(),
      role: z.enum(["TARGET", "OTHER_PARTNER", "COMPETING_RESTRICTED", "INCIDENTAL", "UNKNOWN"]),
      ruleId: z.string().optional(),
      certainty: z.enum(["SCOREPLAY_TAG", "AI_OBSERVATION", "REVIEWER"]),
      /** Seconds on the source asset where it was observed ("15–17 s"); empty for an untimed ScorePlay tag. */
      spans: z.array(z.string()),
    }),
  ),
});
export type Sponsorship = z.infer<typeof SponsorshipSchema>;

export const DecisionSchema = z.object({
  verdict: VerdictSchema,
  reasons: z.array(ReasonSchema),
  missingFacts: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
  policyVersion: z.string(),
  /** Policy id + whether it is fictional demo data (must be shown in UI + receipt). */
  policyId: z.string(),
  policyFictional: z.boolean(),
  /** Derived: VERIFIED only when verdict ALLOWED and policy is verified (not fictional). */
  clearance: ClearanceSchema,
  policySelection: PolicySelectionSchema.optional(),
  /** Brands on screen and the campaign's target sponsor, as the sponsor rules treat them (display only). */
  sponsorship: SponsorshipSchema.optional(),
  evaluatedAt: z.iso.datetime({ offset: true }),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const HumanReviewStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type HumanReviewStatus = z.infer<typeof HumanReviewStatusSchema>;

// ---------- Media model ----------

/** Rights facts read from ScorePlay metadata. `undefined` = unknown (→ NEEDS_REVIEW, never ALLOWED). */
export const RightsFactsSchema = z.object({
  competition: z.string().optional(),
  /** Set only when exactly one club is tagged (see `teams`). */
  team: z.string().optional(),
  /** Every club tagged on the asset (a match tags both sides). */
  teams: z.array(z.string()).optional(),
  /** Person → club names, ONLY when ScorePlay registers the player in that club's squad. Absent person = club unknown. */
  peopleTeams: z.record(z.string(), z.array(z.string())).optional(),
  people: z.array(z.string()).optional(),
  sponsors: z.array(z.string()).optional(),
  recordedAt: z.string().optional(),
});
export type RightsFacts = z.infer<typeof RightsFactsSchema>;

export const AssetSchema = z.object({
  id: z.string(), // ScorePlay asset/media id — the canonical id everywhere. Map to TwelveLabs ONLY via MediaResolver.
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

// ---------- Media identity (ScorePlay ↔ TwelveLabs) ----------

/**
 * AUTHORITATIVE_ID = a stored id that resolves in THIS ScorePlay workspace; FILENAME_DURATION = exact
 * (normalized) filename + |Δduration| ≤ 0.5 s, unique in BOTH directions; AMBIGUOUS = >1 candidate either way;
 * UNMAPPED = no candidate. Only the first two may attach TwelveLabs evidence to a ScorePlay asset.
 */
export const MediaMappingMethodSchema = z.enum(["AUTHORITATIVE_ID", "FILENAME_DURATION", "AMBIGUOUS", "UNMAPPED"]);
export type MediaMappingMethod = z.infer<typeof MediaMappingMethodSchema>;

export const MediaRefSchema = z.object({
  /** null only when resolving from a TwelveLabs video that has no unique ScorePlay counterpart. */
  scoreplayMediaId: z.string().nullable(),
  twelvelabsIndexId: z.string().optional(),
  /** Set only for AUTHORITATIVE_ID | FILENAME_DURATION. Never client-supplied; always resolved server-side. */
  twelvelabsVideoId: z.string().optional(),
  method: MediaMappingMethodSchema,
  match: z
    .object({
      scoreplayFilename: z.string().optional(),
      twelvelabsFilename: z.string().optional(),
      scoreplayDurationSec: z.number().optional(),
      twelvelabsDurationSec: z.number().optional(),
      durationDeltaSec: z.number().optional(),
    })
    .optional(),
  /** Competing candidates when AMBIGUOUS (exposed to the user/diagnostics). */
  candidates: z
    .array(z.object({ scoreplayMediaId: z.string().optional(), twelvelabsVideoId: z.string().optional(), filename: z.string().optional(), durationSec: z.number().optional() }))
    .default([]),
  checkedAt: z.iso.datetime({ offset: true }),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;
export const isEvidenceLinkable = (ref: MediaRef): boolean =>
  (ref.method === "AUTHORITATIVE_ID" || ref.method === "FILENAME_DURATION") && !!ref.twelvelabsVideoId && !!ref.scoreplayMediaId;

// ---------- Partner discover + Rights Passport (Supabase CDM mirror) ----------

export const PartnerFitSchema = z.enum(["partner_safe", "conflict", "needs_review"]);
export type PartnerFit = z.infer<typeof PartnerFitSchema>;

/** Rights Passport (irl.group 7 uses × 3 regions). */
export const PassportUseSchema = z.enum([
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "club_app",
  "venue_screen",
  "sponsor_use",
]);
export const PassportRegionSchema = z.enum(["US", "UK", "ROW"]);
export const PassportCellVerdictSchema = z.enum(["allow", "allow_limited", "review", "block"]);

export const PassportCellSchema = z.object({
  verdict: PassportCellVerdictSchema,
  reasons: z.array(
    z.object({
      rule_id: z.string(),
      verdict: PassportCellVerdictSchema,
      text: z.string(),
    }),
  ),
  usable_until: z.string().nullable().optional(),
  max_duration_sec: z.number().nullable().optional(),
});

export const PassportResponseSchema = z.object({
  mediaId: z.string(),
  verdict: VerdictSchema,
  policyPackId: z.string().optional(),
  policyVersion: z.string().optional(),
  usableUntil: z.string().nullable().optional(),
  rulesFired: z.array(z.string()),
  cells: z.record(z.string(), z.record(z.string(), PassportCellSchema)),
  demoDisclaimer: z.string(),
  decidedAt: z.string().optional(),
  source: z.enum(["supabase", "missing"]),
});
export type PassportResponse = z.infer<typeof PassportResponseSchema>;

export const DiscoveryIntentSchema = z.object({
  raw: z.string(),
  clubCode: ClubCodeSchema.optional(),
  partnerSlug: z.string().optional(),
  eventLabel: z.string().optional(),
  mediaKind: z.enum(["photo", "video", "any"]).default("any"),
  /** Prefer assets with game_date near "last night". */
  lastNight: z.boolean().default(false),
  /** Publish window hint — weekend → check agreement window includes upcoming Sat/Sun. */
  weekendPublish: z.boolean().default(false),
  /** Passport clearance filter (e.g. “TikTok in the UK”). */
  passportUse: PassportUseSchema.optional(),
  passportRegion: PassportRegionSchema.optional(),
});
export type DiscoveryIntent = z.infer<typeof DiscoveryIntentSchema>;

export const DiscoverHitSchema = z.object({
  asset: AssetSchema,
  fit: PartnerFitSchema,
  reasons: z.array(z.string()),
  brandsSeen: z.array(z.string()).default([]),
  eventLabel: z.string().optional(),
  gameDate: z.string().optional(),
  agreementId: z.string().optional(),
});
export type DiscoverHit = z.infer<typeof DiscoverHitSchema>;

export const DiscoverResponseSchema = z.object({
  intent: DiscoveryIntentSchema,
  hits: z.array(DiscoverHitSchema),
  source: z.enum(["supabase", "scoreplay_fallback"]),
  demoDisclaimer: z.string(),
});
export type DiscoverResponse = z.infer<typeof DiscoverResponseSchema>;

/** A time range of one ScorePlay asset. */
export const SegmentSchema = z.object({
  scoreplayMediaId: z.string(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  label: z.string().max(500).optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;

/** An output edit = ordered segments. Every constituent segment is checked independently. */
export const EditPlanSchema = z.object({
  id: z.string().max(300),
  title: z.string().max(300),
  segments: z.array(SegmentSchema).min(1).max(20),
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
  scoreplayMediaId: z.string(), // resolved via MediaResolver — NEVER from TwelveLabs user_metadata directly
  twelvelabsVideoId: z.string(),
  start: z.number(),
  end: z.number(),
  rank: z.number().int().positive(),
  score: z.number().optional(),
  thumbnailUrl: z.string().optional(),
  origin: DataOriginSchema,
  /** How scoreplayMediaId was linked (only linkable methods appear in hits; others are dropped + reported). */
  mapping: MediaMappingMethodSchema,
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

export const WritebackStatusSchema = z.enum(["WRITTEN", "VERIFIED", "FAILED", "DRY_RUN", "REFUSED"]);

export const RightsReceiptSchema = z.object({
  id: z.string(),
  /** Campaign this receipt belongs to (null for receipts created from the advanced rights desk). */
  campaignId: z.string().optional(),
  sourceAssetIds: z.array(z.string()),
  derivativeAssetId: z.string().optional(),
  /** The use the decision is keyed on (worst use for campaigns). */
  intent: PublishIntentSchema,
  /** Every use (channel × territory) covered by `decision` — a campaign receipt approves all of them. */
  intents: z.array(PublishIntentSchema).optional(),
  decision: DecisionSchema,
  edit: EditPlanSchema,
  /** MediaRefs used for evidence at decision time (audit of which video the evidence came from). */
  media: z.array(MediaRefSchema).default([]),
  humanReviewStatus: HumanReviewStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  writeback: z
    .object({
      scoreplayMediaId: z.string(),
      status: WritebackStatusSchema,
      at: z.string(),
      detail: z.string().optional(),
    })
    .array()
    .default([]),
});
export type RightsReceipt = z.infer<typeof RightsReceiptSchema>;

/**
 * The single publication gate. Publication requires verified clearance AND human approval.
 * Demo clearance can be reviewed/approved for the demo but NEVER authorizes publication.
 */
export function canPublish(r: { decision: Pick<Decision, "verdict" | "clearance" | "policyFictional">; humanReviewStatus: HumanReviewStatus }): boolean {
  return (
    r.decision.verdict === "ALLOWED" &&
    r.decision.clearance === "VERIFIED" &&
    !r.decision.policyFictional &&
    r.humanReviewStatus === "APPROVED"
  );
}

// ---------- API contracts (§7) ----------

/** GET /api/assets?q=&limit= */
export const AssetsResponseSchema = z.object({ assets: z.array(AssetSchema) });

/** POST /api/decide */
export const DecideRequestSchema = z.object({ edit: EditPlanSchema, intent: PublishIntentSchema });
/** Secondary lake badge — app verdict stays primary; lake may lag. */
export const LakeDecideBadgeSchema = z.object({
  status: z.enum(["pending", "synced", "unavailable"]),
  mediaIds: z.array(z.string()),
  requestIds: z.array(z.string()).default([]),
  passports: z
    .array(
      z.object({
        mediaId: z.string(),
        verdict: VerdictSchema.optional(),
      }),
    )
    .default([]),
});
export type LakeDecideBadge = z.infer<typeof LakeDecideBadgeSchema>;
export const DecideResponseSchema = EditDecisionSchema.extend({
  lake: LakeDecideBadgeSchema.optional(),
});

/**
 * POST /api/recover — "Find a way to use it" for one moment (exactly one segment of one asset) and every use it
 * must work for. The first use's club selects the rule package (`packageId`, else the club's default).
 */
export const RecoverRequestSchema = z.object({
  edit: EditPlanSchema.extend({ segments: z.array(SegmentSchema).length(1) }),
  intents: z.array(PublishIntentSchema).min(1).max(21),
  packageId: z.string().min(1).max(200).optional(),
});

/**
 * CLIP = the restriction is tied to this footage (people/sponsor/asset rule) → replacing the clip can help.
 * CAMPAIGN = the restriction is tied to the intent (territory/platform/usage/date) → every clip fails the same
 * way; do NOT offer repeated replacements, suggest changing the intent instead. NONE = nothing to resolve.
 */
export const BlockerSchema = z.object({
  scope: z.enum(["CLIP", "CAMPAIGN", "NONE"]),
  dimensions: z.array(z.string()),
  ruleIds: z.array(z.string()),
  explanation: z.string(),
  /** Concrete next step, e.g. "Use ORGANIC instead of COMMERCIAL" or "Licensed territories: GB, IE". */
  suggestion: z.string().optional(),
});
export type Blocker = z.infer<typeof BlockerSchema>;

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

/** One documented ScorePlay mutation (see lib/scoreplay/API_NOTES.md). */
export const ScorePlayActionSchema = z.object({
  method: z.enum(["POST", "PUT", "DELETE"]),
  path: z.string(),
  body: z.unknown().optional(),
  purpose: z.string(),
});
export type ScorePlayAction = z.infer<typeof ScorePlayActionSchema>;

export const WritebackResponseSchema = z.object({
  mode: z.enum(["DRY_RUN", "LIVE"]),
  receipt: RightsReceiptSchema,
  /** Exactly what would be / was sent to ScorePlay. */
  planned: z.array(ScorePlayActionSchema),
  /** Set when live writing was refused (e.g. demo policy, not reviewed, not authorized). */
  refusedReason: z.string().optional(),
  /** What ScorePlay returned when re-read after writing (LIVE only; proves persistence). */
  readBack: z.record(z.string(), z.unknown()).optional(),
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
  code: z.enum(["BAD_REQUEST", "NOT_CONFIGURED", "UPSTREAM", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "INTERNAL"]),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------- Module seams (implemented by owners; consumed by API routes) ----------

export interface ScorePlayClient {
  searchAssets(query: string, limit?: number): Promise<Asset[]>;
  getAsset(id: string): Promise<Asset>;
  // Writes go through lib/scoreplay/writeback.ts (planWriteback → applyWriteback), never through this seam.
  /** Optional: upload a derivative as its own asset. Throws NOT_CONFIGURED if not permitted. */
  uploadDerivative?(file: { path: string; title: string }, receipt: RightsReceipt): Promise<{ id: string }>;
}

export interface VideoIntelligence {
  /** Marengo search on the pre-indexed footage. Hits are mapped TwelveLabs → ScorePlay via MediaResolver; unlinkable hits are dropped. */
  search(query: string, opts?: { limit?: number; excludeMediaIds?: string[] }): Promise<SearchHit[]>;
  /** Timecoded observations for one asset. Requires a linkable MediaRef; otherwise throws NOT_FOUND. */
  observations(ref: MediaRef): Promise<Evidence[]>;
}

/** Canonical ScorePlay ↔ TwelveLabs identity resolution (lib/media). */
export interface MediaResolver {
  forScoreplay(scoreplayMediaId: string): Promise<MediaRef>;
  forTwelveLabs(twelvelabsVideoId: string): Promise<MediaRef>;
}
