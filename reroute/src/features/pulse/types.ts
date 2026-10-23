/**
 * PULSE data model (spec §8). PULSE is a derived recommendation layer: ScorePlay is the source of
 * truth for media, REROUTE for rights verdicts, sponsor briefs for obligations.
 */
import { z } from "zod";
import {
  ClearanceSchema,
  DataOriginSchema,
  DecisionSchema,
  EditPlanSchema,
  MediaRefSchema,
  PolicySelectionSchema,
  PublishIntentSchema,
  ReasonSchema,
  SegmentSchema,
  UsageSchema,
  VerdictSchema,
} from "@/lib/contracts";
import { EdlSchema } from "@/lib/rights/recovery/edl";

export const ClubSchema = z.enum(["spurs", "tottenham"]);
export type Club = z.infer<typeof ClubSchema>;

export const SourceModeSchema = z.enum(["FIXTURE", "PUBLIC_API", "MANUAL"]);
export type SourceMode = z.infer<typeof SourceModeSchema>;

/** Only ever written from a REROUTE decision; NOT_CHECKED until REROUTE has evaluated a candidate. */
export const RightsStateSchema = z.enum(["NOT_CHECKED", "ALLOWED", "BLOCKED", "NEEDS_REVIEW"]);
export type RightsState = z.infer<typeof RightsStateSchema>;

export const CommercialStateSchema = z.enum(["EDITORIAL", "FULFILLMENT_CANDIDATE", "UPSELL_IDEA"]);
export type CommercialState = z.infer<typeof CommercialStateSchema>;

export const OpportunityStatusSchema = z.enum([
  "DETECTED",
  "SENT_TO_REROUTE",
  "APPROVED",
  "PUBLISHED",
  "DISMISSED",
]);
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;

export const DesiredFormatSchema = z.enum(["vertical_short", "square_post", "video_short"]);
export type DesiredFormat = z.infer<typeof DesiredFormatSchema>;

export const ConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const LanguageSchema = z.enum(["en", "es", "fr", "de", "it"]);
export type Language = z.infer<typeof LanguageSchema>;

// ---------- Signals ----------

export const SignalSampleSchema = z.object({
  id: z.string(),
  text: z.string(),
  postedAt: z.iso.datetime({ offset: true }),
  /** Where the sample came from as displayed, e.g. "Simulated post" or "Producer note". */
  platformLabel: z.string(),
  referenceUrl: z.url().optional(),
});
export type SignalSample = z.infer<typeof SignalSampleSchema>;

/** Aggregated evidence for one topic. Never a representative view of all fans. */
export const FanSignalSchema = z.object({
  id: z.string(),
  club: ClubSchema,
  topic: z.string(),
  source: z.enum(["fixture", "manual"]),
  mode: SourceModeSchema,
  /** Latest sample time. */
  observedAt: z.iso.datetime({ offset: true }),
  sampleCount: z.number().int().nonnegative(),
  samples: z.array(SignalSampleSchema),
  confidence: ConfidenceSchema,
});
export type FanSignal = z.infer<typeof FanSignalSchema>;

/**
 * How PULSE finds real footage on ScorePlay: `terms` are resolved to player/tag IDs with
 * `GET /tag/search`; `filenameHints` are whole words of curated edit filenames. Semantic phrases
 * never go to the filename search — moments inside videos come from TwelveLabs.
 */
export const MediaDiscoverySpecSchema = z.object({
  terms: z.array(z.string()).default([]),
  filenameHints: z.array(z.string()).default([]),
});
export type MediaDiscoverySpec = z.infer<typeof MediaDiscoverySpecSchema>;

/** Editorial framing for a topic (fixture catalog or producer-entered). */
export const TopicSchema = z.object({
  key: z.string(),
  club: ClubSchema,
  game: z.string(),
  focus: z.string(), // key player or action
  headline: z.string(),
  angle: z.string(),
  interestSummary: z.string(),
  cohort: z.string(),
  desiredFormat: DesiredFormatSchema,
  scoreplay: MediaDiscoverySpecSchema,
  /** TwelveLabs Marengo natural-language query. */
  semanticQuery: z.string(),
  topicTags: z.array(z.string()),
  /** What the content shows (player-spotlight, matchday, …); matched against a business objective's product. */
  contentTraits: z.array(z.string()).default([]),
  /** Short social hooks per language, written by the team for this topic; missing languages fall back to English. */
  hooks: z.partialRecord(LanguageSchema, z.string()).default({}),
  /** Producer-picked brief for MANUAL triggers; fixture topics are matched by tags. */
  sponsorBriefId: z.string().optional(),
});
export type Topic = z.infer<typeof TopicSchema>;

export const FixturePostSchema = z.object({
  id: z.string(),
  topic: z.string(),
  postedAt: z.iso.datetime({ offset: true }),
  text: z.string(),
});

export const SignalFixtureSchema = z.object({
  label: z.string(),
  disclaimer: z.string(),
  /** Replay clock: freshness of FIXTURE signals is measured against this, not wall time. */
  replayClock: z.iso.datetime({ offset: true }),
  topics: z.array(TopicSchema),
  posts: z.array(FixturePostSchema),
});
export type SignalFixture = z.infer<typeof SignalFixtureSchema>;

/** A producer-typed trigger (MANUAL mode); stored, then treated like any other signal. */
export const ManualTriggerSchema = z.object({
  club: ClubSchema,
  text: z.string().trim().min(3).max(280),
  /** Player, team or filename word to look up on ScorePlay (optional). */
  mediaQuery: z.string().trim().max(120).optional(),
  sponsorBriefId: z.string().optional(),
});
export type ManualTrigger = z.infer<typeof ManualTriggerSchema>;

export const StoredManualTriggerSchema = ManualTriggerSchema.extend({
  id: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type StoredManualTrigger = z.infer<typeof StoredManualTriggerSchema>;

// ---------- Sponsor briefs ----------

export const SponsorBriefSchema = z.object({
  id: z.string(),
  club: ClubSchema,
  partnerLabel: z.string(),
  objective: z.string(),
  allowedFormats: z.array(DesiredFormatSchema),
  audienceSegments: z.array(z.string()),
  topicTags: z.array(z.string()),
  /** Absent = no contracted obligation: matching concepts are upsell ideas, not fulfillment. */
  contractedDeliverables: z.number().int().nonnegative().optional(),
  publishedDeliverables: z.number().int().nonnegative().optional(),
  /** OPTIONAL user-entered signed package value; without it only deliverable counts are shown. */
  allocatedPackageValue: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  dueBy: z.iso.datetime({ offset: true }).optional(),
  /** Where this brief would be published; used as the REROUTE publish intent on handoff. */
  publishIntent: z.object({ territory: z.string(), platform: z.string(), usage: UsageSchema }),
  dataStatus: z.enum(["DEMO", "VERIFIED"]),
  disclaimer: z.string().optional(),
});
export type SponsorBrief = z.infer<typeof SponsorBriefSchema>;

// ---------- Opportunities ----------

export const ScoreBreakdownSchema = z.object({
  priority: z.number(),
  fanSignalStrength: z.number(),
  commercialFit: z.number(),
  freshness: z.number(),
  notes: z.object({ fanSignalStrength: z.string(), commercialFit: z.string(), freshness: z.string() }),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

/** Deterministic output of detection (fixture/manual signals + briefs); no ledger state. */
export const DetectedOpportunitySchema = z.object({
  id: z.string(),
  club: ClubSchema,
  game: z.string(),
  focus: z.string(),
  headline: z.string(),
  angle: z.string(),
  interestSummary: z.string(),
  signal: FanSignalSchema,
  targetAudienceCohort: z.string(),
  desiredFormat: DesiredFormatSchema,
  sponsorBriefId: z.string().optional(),
  commercialState: CommercialStateSchema,
  commercialRationale: z.string(),
  contentTraits: z.array(z.string()).default([]),
  hooks: z.partialRecord(LanguageSchema, z.string()).default({}),
  score: ScoreBreakdownSchema,
  evidenceMode: SourceModeSchema,
  discovery: MediaDiscoverySpecSchema,
  semanticQuery: z.string(),
  detectedAt: z.iso.datetime({ offset: true }),
});
export type DetectedOpportunity = z.infer<typeof DetectedOpportunitySchema>;

/** Why TwelveLabs could not (fully) contribute; each case is reported, never collapsed into "no results". */
export const TwelveLabsIssueSchema = z.enum([
  "MISSING_API_KEY",
  "INVALID_API_KEY",
  "MISSING_INDEX_ID",
  "INDEX_NOT_ACCESSIBLE",
  "EMPTY_INDEX",
  "NO_SEARCH_RESULTS",
  "UNSUPPORTED_SEARCH_OPTION",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "MAPPING_FAILED",
]);
export type TwelveLabsIssue = z.infer<typeof TwelveLabsIssueSchema>;

export const MediaCandidateSchema = z.object({
  scoreplayAssetId: z.string(),
  twelveLabsVideoId: z.string().optional(),
  title: z.string(),
  kind: z.enum(["video", "image", "other"]),
  thumbnailUrl: z.string().optional(),
  durationSec: z.number().optional(),
  /** Exact TwelveLabs moment boundaries (seconds), only for TWELVELABS evidence. */
  startSeconds: z.number().nonnegative().optional(),
  endSeconds: z.number().positive().optional(),
  competition: z.string().optional(),
  recordedAt: z.string().optional(),
  /** TWELVELABS = a Marengo moment inside this video; SCOREPLAY_METADATA_FALLBACK = ScorePlay tags/filename only. */
  foundBy: z.enum(["TWELVELABS", "SCOREPLAY_METADATA_FALLBACK"]),
  /** How the video was surfaced: ScorePlay filename/tags, or REROUTE's resolver searching the whole index (INDEX_SEARCH). */
  discoveredBy: z.enum(["FILENAME", "PLAYER_TAG", "TEAM_TAG", "INDEX_SEARCH"]),
  /** TwelveLabs search rank (1 = best) and the query that produced it. */
  rank: z.number().int().positive().optional(),
  query: z.string().optional(),
  origin: DataOriginSchema,
  /**
   * How the TwelveLabs video was tied to this ScorePlay asset: its custom id, or — when the index
   * carries ids from another ScorePlay workspace — the exact same filename and duration.
   */
  mapping: z
    .object({ via: z.enum(["AUTHORITATIVE_ID", "FILENAME_DURATION"]), filename: z.string() })
    .optional(),
});
export type MediaCandidate = z.infer<typeof MediaCandidateSchema>;

export const MediaLookupSchema = z.object({
  status: z.enum(["FOUND", "NOT_FOUND", "UNAVAILABLE"]),
  searchedAt: z.iso.datetime({ offset: true }),
  /** Product-level state of video intelligence for this opportunity (shown to users). */
  intelligence: z.object({
    status: z.enum(["MOMENTS_FOUND", "NO_MATCHING_MOMENT", "NOT_INDEXED", "UNAVAILABLE"]),
    code: TwelveLabsIssueSchema.optional(),
    message: z.string(),
  }),
  /** Developer diagnostics; not shown in the main UI. */
  attempts: z.array(
    z.object({
      service: z.enum(["TwelveLabs", "ScorePlay"]),
      query: z.string(),
      outcome: z.enum(["OK", "EMPTY", "ERROR"]),
      code: z.string().optional(),
      detail: z.string().optional(),
    }),
  ),
  candidates: z.array(MediaCandidateSchema),
});
export type MediaLookup = z.infer<typeof MediaLookupSchema>;

/** A REROUTE verdict as recorded by PULSE: reasons are REROUTE's, never PULSE's own judgment. */
export const RightsCheckSchema = z.object({
  state: RightsStateSchema.exclude(["NOT_CHECKED"]),
  checkedAt: z.iso.datetime({ offset: true }),
  scoreplayAssetId: z.string(),
  policyId: z.string(),
  policyVersion: z.string(),
  policyFictional: z.boolean(),
  reasons: z.array(z.object({ dimension: z.string(), outcome: z.enum(["DENY", "PERMIT", "MISSING"]), explanation: z.string() })),
  missingFacts: z.array(z.string()),
});
export type RightsCheck = z.infer<typeof RightsCheckSchema>;

export const LedgerEntrySchema = z.object({
  status: OpportunityStatusSchema,
  handoff: z
    .object({
      at: z.iso.datetime({ offset: true }),
      scoreplayAssetId: z.string(),
      edit: EditPlanSchema,
      intent: PublishIntentSchema,
      rerouteUrl: z.string(),
      /** Business objective the handoff was made for (its market sets the REROUTE territory). */
      objective: z.string().optional(),
    })
    .optional(),
  rights: RightsCheckSchema.optional(),
  approvedAt: z.iso.datetime({ offset: true }).optional(),
  approvedBy: z.string().optional(),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
  publishEvidenceUrl: z.url().optional(),
  dismissedAt: z.iso.datetime({ offset: true }).optional(),
  dismissReason: z.string().optional(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

// ---------- Business objective → market opportunity ----------

/** Markets PULSE can target = territories REROUTE's publish intent supports. */
export const MarketCodeSchema = z.enum(["FR", "US", "GB", "DE", "ES", "IT", "CA", "MX"]);
export type MarketCode = z.infer<typeof MarketCodeSchema>;

export const ProductSchema = z.enum(["jersey", "tickets", "merch", "engagement", "followers", "subscriptions", "sponsor"]);
export type Product = z.infer<typeof ProductSchema>;

/** Whether the objective's KPI can actually be measured, and by what. Never implies results. */
export const MeasurementSchema = z.object({
  status: z.enum(["NOT_CONNECTED", "PLATFORM_NATIVE", "TRACKED_IN_PULSE"]),
  note: z.string(),
});
export type Measurement = z.infer<typeof MeasurementSchema>;

/** Output of the deterministic objective parser: what PULSE understood, and what it did not. */
export const ParsedObjectiveSchema = z.object({
  raw: z.string(),
  summary: z.string(),
  club: ClubSchema.optional(),
  /** MARKET = one territory; GLOBAL = worldwide audience (no single territory); UNSPECIFIED = neither stated. */
  scope: z.enum(["MARKET", "GLOBAL", "UNSPECIFIED"]),
  market: z.object({ code: MarketCodeSchema, label: z.string(), matched: z.string() }).optional(),
  product: z.object({ key: ProductSchema, label: z.string(), matched: z.string() }).optional(),
  kpi: z.string(),
  deadline: z.object({ text: z.string(), iso: z.iso.datetime({ offset: true }).optional() }).optional(),
  missing: z.array(z.enum(["market", "product", "deadline"])),
  measurement: MeasurementSchema,
  parsedAt: z.iso.datetime({ offset: true }),
});
export type ParsedObjective = z.infer<typeof ParsedObjectiveSchema>;

export const LevelSchema = z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]);
export type Level = z.infer<typeof LevelSchema>;

/** One topic in one market vs its usual level, and vs the global conversation. */
export const MarketAnalysisSchema = z.object({
  market: z.object({ code: z.union([MarketCodeSchema, z.literal("GLOBAL")]), label: z.string() }),
  window: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }),
  current: z.number().int().nonnegative(),
  baseline: z.number().nonnegative(),
  lift: z.number(),
  /** Poisson z-score of the current count against the baseline rate. */
  z: z.number(),
  globalCurrent: z.number().int().nonnegative(),
  globalBaseline: z.number().nonnegative(),
  globalLift: z.number(),
  /** This topic's global volume relative to the biggest topic in the window (0..1). */
  globalVolumeShare: z.number(),
  shareNow: z.number(),
  shareUsual: z.number(),
  globalInterest: LevelSchema.exclude(["NONE"]),
  momentum: LevelSchema,
  confidence: ConfidenceSchema,
  /** Momentum MEDIUM+ in the market while global interest is LOW/MEDIUM and the market's share grew. */
  underTheRadar: z.boolean(),
  sources: z.array(z.string()),
  geographyBasis: z.string(),
  samples: z.array(z.object({ id: z.string(), text: z.string(), lang: z.string(), postedAt: z.iso.datetime({ offset: true }) })),
  mode: SourceModeSchema,
});
export type MarketAnalysis = z.infer<typeof MarketAnalysisSchema>;

/** How well an opportunity serves the active objective (spec: local interest × objective fit × media). */
export const MarketFitSchema = z.object({
  objective: z.string(),
  analysis: MarketAnalysisSchema.optional(),
  localInterest: z.number(),
  objectiveFit: z.number(),
  mediaAvailability: z.number(),
  score: z.number(),
  label: z.enum(["STRONG", "POSSIBLE", "WEAK", "NO_MARKET_DATA"]),
  notes: z.object({ localInterest: z.string(), objectiveFit: z.string(), mediaAvailability: z.string() }),
  why: z.string(),
  proposedContent: z.string(),
  nextAction: z.string(),
});
export type MarketFit = z.infer<typeof MarketFitSchema>;

/** What the API returns: detection + media + ledger, with the rights gate applied. */
export const OpportunityViewSchema = DetectedOpportunitySchema.extend({
  status: OpportunityStatusSchema,
  rightsState: RightsStateSchema,
  /** UI gate label: never "Rights-ready" unless REROUTE said ALLOWED. */
  gate: z.enum(["RIGHTS_READY", "NEEDS_CLEARANCE", "BLOCKED"]),
  /** Fulfillment wording: DELIVERABLE_READY after approval, FULFILLED only once published with evidence. */
  deliverableState: z.enum(["NONE", "OPEN", "DELIVERABLE_READY", "FULFILLED"]),
  media: MediaLookupSchema.optional(),
  ledger: LedgerEntrySchema,
  /** Present only while a business objective is active. */
  market: MarketFitSchema.optional(),
});
export type OpportunityView = z.infer<typeof OpportunityViewSchema>;

export const SnapshotMetaSchema = z.object({
  builtAt: z.iso.datetime({ offset: true }),
  signalSource: z.enum(["fixture", "manual"]),
  demoLabel: z.string().optional(),
  demoDisclaimer: z.string().optional(),
  replayClock: z.iso.datetime({ offset: true }).optional(),
});
export type SnapshotMeta = z.infer<typeof SnapshotMetaSchema>;

// ---------- Campaign proposal ----------

export const ChannelSchema = z.enum(["instagram", "facebook", "x"]);
export type Channel = z.infer<typeof ChannelSchema>;

/** Store/ticketing link: configured by the club (env) or pasted by the producer. PULSE never invents one. */
export const CommerceDestinationSchema = z.object({
  kind: z.enum(["store", "ticketing"]),
  url: z.url({ protocol: /^https$/ }),
  source: z.enum(["CONFIGURED", "PRODUCER_ENTERED"]),
});
export type CommerceDestination = z.infer<typeof CommerceDestinationSchema>;

/**
 * A campaign proposal draft. Flat, versioned, JSON-serializable: one row per opportunity in any
 * store (file today; a Supabase `jsonb` column later). Rights are NOT stored here — they are read
 * from REROUTE's recorded verdict at view time.
 */
export const CampaignDraftSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  opportunityId: z.string(),
  club: ClubSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  objective: z.object({ summary: z.string(), raw: z.string(), kpi: z.string(), measurement: MeasurementSchema }),
  audience: z.object({
    scope: z.enum(["MARKET", "GLOBAL", "UNSPECIFIED"]),
    market: z.object({ code: MarketCodeSchema, label: z.string() }).optional(),
    cohort: z.string(),
    language: LanguageSchema,
    /** BCP 47 locale the copy is written for (e.g. es-MX for Mexico); absent on older drafts. */
    locale: z.string().optional(),
    basis: z.string(),
  }),
  media: z.object({
    scoreplayAssetId: z.string(),
    title: z.string(),
    thumbnailUrl: z.string().optional(),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
    foundBy: MediaCandidateSchema.shape.foundBy,
    origin: DataOriginSchema,
    mapping: MediaCandidateSchema.shape.mapping,
  }),
  rationale: z.array(z.string()),
  creative: z.object({ angle: z.string(), hook: z.string(), hookLanguage: LanguageSchema }),
  cta: z.object({
    text: z.string(),
    status: z.enum(["READY", "NOT_CONFIGURED", "NOT_APPLICABLE"]),
    destination: CommerceDestinationSchema.optional(),
    note: z.string(),
  }),
  channels: z.array(
    z.object({
      channel: ChannelSchema,
      format: z.string(),
      copy: z.string(),
      linkHandling: z.string(),
      characterCount: z.number().int(),
      limit: z.number().int().optional(),
      withinLimit: z.boolean(),
    }),
  ),
  /** The publish intent REROUTE is asked about on handoff (same derivation as the handoff itself). */
  rerouteIntent: PublishIntentSchema,
  evidenceLabels: z.array(z.string()),
  safeguards: z.array(z.string()),
});
export type CampaignDraft = z.infer<typeof CampaignDraftSchema>;

/** Rights as recorded from REROUTE for exactly this draft's asset, cut and territory — never computed by PULSE. */
export const CampaignRightsSchema = z.object({
  state: RightsStateSchema,
  source: z.literal("REROUTE"),
  matchesDraft: z.boolean(),
  checkedAt: z.iso.datetime({ offset: true }).optional(),
  policyId: z.string().optional(),
  policyFictional: z.boolean().optional(),
  note: z.string(),
});
export type CampaignRights = z.infer<typeof CampaignRightsSchema>;

export const CampaignViewSchema = CampaignDraftSchema.extend({
  rights: CampaignRightsSchema,
  /** The active objective changed since this draft was generated. */
  stale: z.boolean(),
});
export type CampaignView = z.infer<typeof CampaignViewSchema>;

export const RankingComparisonSchema = z.array(
  z.object({
    objective: z.string(),
    ranked: z.array(z.object({ id: z.string(), headline: z.string(), score: z.number(), label: MarketFitSchema.shape.label })),
  }),
);
export type RankingComparison = z.infer<typeof RankingComparisonSchema>;

export const OpportunitiesResponseSchema = z.object({
  meta: SnapshotMetaSchema,
  opportunities: z.array(OpportunityViewSchema),
  briefs: z.array(SponsorBriefSchema),
  objective: ParsedObjectiveSchema.optional(),
  /** The same opportunities ranked under preset objectives, to show the ranking depends on the objective. */
  comparison: RankingComparisonSchema,
});
export type OpportunitiesResponse = z.infer<typeof OpportunitiesResponseSchema>;

export const OpportunityResponseSchema = z.object({
  meta: SnapshotMetaSchema,
  opportunity: OpportunityViewSchema,
  brief: SponsorBriefSchema.optional(),
  objective: ParsedObjectiveSchema.optional(),
  campaign: CampaignViewSchema.optional(),
});
export type OpportunityResponse = z.infer<typeof OpportunityResponseSchema>;

// ---------- Handoff ----------

/** Spec §7 handoff contract. `sponsorBriefId` is a reference only — never a rights grant. */
export const PulseHandoffSchema = z.object({
  opportunityId: z.string(),
  club: ClubSchema,
  creativeBrief: z.string(),
  targetAudience: z.string(),
  desiredFormat: DesiredFormatSchema,
  mediaCandidates: z
    .array(
      z.object({
        scoreplayAssetId: z.string(),
        twelveLabsAssetId: z.string().optional(),
        startSeconds: z.number().nonnegative().optional(),
        endSeconds: z.number().positive().optional(),
        durationSec: z.number().optional(),
        competition: z.string().optional(),
      }),
    )
    .min(1),
  sponsorBriefId: z.string().optional(),
  sourceEvidenceIds: z.array(z.string()),
});
export type PulseHandoff = z.infer<typeof PulseHandoffSchema>;

export const HandoffRequestSchema = z.object({
  opportunityId: z.string(),
  scoreplayAssetId: z.string(),
});

export const HandoffResponseSchema = z.object({
  rerouteUrl: z.string(),
  opportunity: OpportunityViewSchema,
});

export const ActionRequestSchema = z.discriminatedUnion("action", [
  z.object({ id: z.string(), action: z.literal("recheck") }),
  z.object({ id: z.string(), action: z.literal("approve"), reviewer: z.string().trim().min(1).max(80) }),
  z.object({ id: z.string(), action: z.literal("publish"), evidenceUrl: z.url({ protocol: /^https?$/ }) }),
  z.object({ id: z.string(), action: z.literal("dismiss"), reason: z.string().trim().max(280).optional() }),
  z.object({ id: z.string(), action: z.literal("restore") }),
  z.object({
    id: z.string(),
    action: z.literal("draftCampaign"),
    scoreplayAssetId: z.string(),
    /** Optional authorized store/ticketing URL entered by the producer (https only). */
    commerceUrl: z.url({ protocol: /^https$/ }).optional(),
  }),
]);
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

export const RefreshRequestSchema = z.object({
  manual: ManualTriggerSchema.optional(),
  /** A free-text business objective; `null` clears the active one; omitted leaves it unchanged. */
  objective: z.string().trim().min(3).max(280).nullable().optional(),
});

// ---------- Business metrics ----------

export const FunnelStageSchema = z.object({
  key: z.enum(["DETECTED", "PRODUCER_SELECTED", "RIGHTS_ELIGIBLE", "APPROVED", "PUBLISHED", "COMMERCIALLY_ATTRIBUTED"]),
  label: z.string(),
  count: z.number().int(),
  /** Median minutes from detection to reaching this stage (observed ledger timestamps only). */
  medianMinutesFromDetection: z.number().optional(),
});

export const BusinessMetricsSchema = z.object({
  funnel: z.array(FunnelStageSchema),
  fulfillment: z.array(
    z.object({
      briefId: z.string(),
      partnerLabel: z.string(),
      dataStatus: z.enum(["DEMO", "VERIFIED"]),
      contracted: z.number().int(),
      publishedBaseline: z.number().int(),
      publishedViaPulse: z.number().int(),
      deliverableReady: z.number().int(),
      remaining: z.number().int(),
      coverage: z.number(), // published / contracted, 0..1
      /** Allocation of already-contracted value — only when the brief carries a package value. */
      openCommitmentAllocation: z.object({ amount: z.number(), currency: z.string() }).optional(),
    }),
  ),
  upsell: z.object({
    ideas: z.number().int(),
    qualified: z.number().int(), // producer-approved + REROUTE ALLOWED
    label: z.literal("PROPOSED / NOT SOLD"),
  }),
  rightsYield: z.object({ allowed: z.number().int(), evaluated: z.number().int() }),
  archiveActivation: z.number().int(),
  efficiency: z.object({
    medianTimeToReadyMinutes: z.number().optional(),
    readyCount: z.number().int(),
    /** No manual baseline is recorded, so minutes saved are never asserted server-side. */
    minutesSaved: z.null(),
    note: z.string(),
  }),
  dataQuality: z.array(z.string()),
});
export type BusinessMetrics = z.infer<typeof BusinessMetricsSchema>;

// ---------- Goal → moments → campaign → rights → review (the product flow) ----------

/** One visual question PULSE asks TwelveLabs for an objective, with how directly it serves it. */
export const GoalIntentSchema = z.object({
  key: z.string(),
  label: z.string(),
  query: z.string(),
  weight: z.number().positive().max(1),
  why: z.string(),
});
export type GoalIntent = z.infer<typeof GoalIntentSchema>;

/** A live TwelveLabs hit supporting a recommendation: which intent's query, its rank, exact boundaries. */
export const MomentMatchSchema = z.object({
  intent: z.string(),
  label: z.string(),
  query: z.string(),
  rank: z.number().int().positive(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
});
export type MomentMatch = z.infer<typeof MomentMatchSchema>;

/** A browser-playable reference to footage that stays in ScorePlay / TwelveLabs; nothing is downloaded. */
export const PreviewSchema = z.object({
  source: z.enum(["SCOREPLAY_PROXY", "TWELVELABS_STREAM"]),
  url: z.url({ protocol: /^https$/ }),
  hls: z.boolean(),
});
export type Preview = z.infer<typeof PreviewSchema>;

export const RecommendationSchema = z.object({
  /** `<scoreplayAssetId>@<start>-<end>`: one exact moment. */
  key: z.string(),
  candidate: MediaCandidateSchema,
  /** Canonical ScorePlay ↔ TwelveLabs identity (MediaResolver); only linkable refs reach a recommendation. */
  media: MediaRefSchema,
  headline: z.string(),
  score: z.number(),
  breakdown: z.object({
    relevance: z.number(),
    readiness: z.number(),
    contextFactor: z.number(),
    notes: z.object({ relevance: z.string(), readiness: z.string(), context: z.string() }),
  }),
  matches: z.array(MomentMatchSchema).min(1),
  /** Season written in the filename (e.g. "2020-21"), when there is one. */
  season: z.string().optional(),
  why: z.object({ opportunity: z.string(), media: z.string(), action: z.string() }),
  /** Lower-ranked moments judged to be the same footage (re-upload: same duration and timecode). */
  duplicates: z.array(z.string()).default([]),
  preview: PreviewSchema.optional(),
  /** What the user sees instead of a player, or alongside it. */
  previewNote: z.string(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

/**
 * The REROUTE usage of the whole campaign: COMMERCIAL when the objective sells something
 * (merchandise, tickets…), SPONSORED for a partner activation, EDITORIAL for reach/engagement content.
 */
export const GoalUsageSchema = UsageSchema.extract(["COMMERCIAL", "SPONSORED", "EDITORIAL"]);
export type GoalUsage = z.infer<typeof GoalUsageSchema>;

/** What PULSE will ask REROUTE about — derived from the objective and the selected club, never guessed. */
export const GoalPlanSchema = z.object({
  club: ClubSchema,
  scope: z.enum(["MARKET", "GLOBAL", "UNSPECIFIED"]),
  /** Every territory is evaluated separately (GLOBAL = an explicit documented list). */
  territories: z.array(z.string().min(2)).min(1),
  territoryBasis: z.string(),
  /** COMMERCIAL/EDITORIAL from the objective; a REROUTE remedy may switch it to another licensed usage. */
  usage: UsageSchema,
  channels: z.array(ChannelSchema).min(1),
  competition: z.string(),
});
export type GoalPlan = z.infer<typeof GoalPlanSchema>;

/** The fixture named in the goal and whether it actually restricted the footage searched. */
export const MatchFilterSchema = z.object({
  requested: z.string(),
  /** APPLIED = only videos whose tags/filename name the opponent were searched; NOT_FOUND = none did, library unfiltered. */
  status: z.enum(["APPLIED", "NOT_FOUND"]),
  videos: z.number().int().nonnegative(),
});
export type MatchFilter = z.infer<typeof MatchFilterSchema>;

/** REROUTE's decision for one channel × territory, verbatim. */
export const IntentDecisionSchema = z.object({ intent: PublishIntentSchema, decision: DecisionSchema });
export type IntentDecision = z.infer<typeof IntentDecisionSchema>;

const iso = z.iso.datetime({ offset: true });

// ---------- Media Compliance Recovery Engine ("Find a way to use it") ----------

export const RecoveryKindSchema = z.enum(["TRIM", "SAFE_SECTION", "REPLACE", "ADAPT_CAMPAIGN", "CHANGE_USAGE", "REQUEST_CLEARANCE"]);
export type RecoveryKind = z.infer<typeof RecoveryKindSchema>;

const SpanSchema = z.object({ start: z.number(), end: z.number() });

/** A finding in plain language with where it came from ("ScorePlay", "TwelveLabs video analysis", "Demo policy …"). */
export const SourcedLineSchema = z.object({ text: z.string(), source: z.string(), at: SpanSchema.optional() });
export type SourcedLine = z.infer<typeof SourcedLineSchema>;

/** An independent REROUTE re-evaluation of the proposed change, for every use of the campaign. */
export const RecheckSchema = z.object({
  verdict: VerdictSchema,
  clearance: ClearanceSchema,
  allowedUses: z.number().int().nonnegative(),
  totalUses: z.number().int().positive(),
  /** What still stands between the changed usage and ALLOWED (empty when ALLOWED). */
  remaining: z.array(SourcedLineSchema),
  policyId: z.string(),
  policyVersion: z.string(),
  evaluatedAt: iso,
});
export type Recheck = z.infer<typeof RecheckSchema>;

/** Before/after of a derived cut (source seconds). An edit PLAN: no file exists unless `execution` says otherwise. */
export const EditTimelineSchema = z.object({
  edlId: z.string(),
  sourceAssetId: z.string(),
  sourceTitle: z.string(),
  assetDurationSec: z.number().optional(),
  original: SpanSchema,
  removed: z.array(SpanSchema.extend({ why: z.string(), source: z.string() })),
  retained: z.array(SpanSchema),
  output: z.array(z.object({ sourceStart: z.number(), sourceEnd: z.number(), outStart: z.number(), outEnd: z.number() })),
  resultDurationSec: z.number(),
  originalDurationSec: z.number(),
  execution: z.literal("PLAN_NOT_RENDERED"),
  /** "Edit plan — not rendered". */
  executionLabel: z.string(),
});
export type EditTimeline = z.infer<typeof EditTimelineSchema>;

export const RecoveryOptionSchema = z.object({
  id: z.string(),
  kind: RecoveryKindSchema,
  /** e.g. "Remove 0:09.0–0:14.5". */
  title: z.string(),
  summary: z.string(),
  /** Expected cost of the change, e.g. "Keeps 5.7 s of 7.8 s" or "Drops France, Spain, Germany". */
  tradeoff: z.string(),
  /** True when the option no longer serves the objective exactly as written (e.g. a sales post becomes organic). */
  changesGoal: z.boolean(),
  /**
   * RESOLVES_DEMO = re-check ALLOWED under a demo policy (never legal clearance); NEEDS_REVIEW / STILL_BLOCKED =
   * re-check result; NOT_VIABLE = rejected before or after the re-check (`notViableBecause`); NEXT_STEP = a
   * human action (clearance request), nothing executable.
   */
  outcome: z.enum(["RESOLVES_DEMO", "NEEDS_REVIEW", "STILL_BLOCKED", "NOT_VIABLE", "NEXT_STEP"]),
  recheck: RecheckSchema.optional(),
  notViableBecause: z.string().optional(),
  timeline: EditTimelineSchema.optional(),
  replacement: z
    .object({ key: z.string(), title: z.string(), scoreplayMediaId: z.string(), start: z.number(), end: z.number(), query: z.string(), rank: z.number().int() })
    .optional(),
  campaignChange: z
    .object({ territories: z.array(z.string()).optional(), dropped: z.array(z.string()).optional(), platforms: z.array(z.string()).optional(), usage: UsageSchema.optional() })
    .optional(),
  /** The engine's pick (at most one option). */
  recommended: z.boolean(),
  /** Whether `applyRecovery` accepts it (never for NOT_VIABLE / NEXT_STEP / STILL_BLOCKED). */
  applicable: z.boolean(),
});
export type RecoveryOption = z.infer<typeof RecoveryOptionSchema>;

export const RecoveryViewSchema = z.object({
  id: z.string(),
  forEvaluationId: z.string(),
  generatedAt: iso,
  /** CLIP = the footage is the problem; CAMPAIGN = the planned use is; MIXED = both. */
  scope: z.enum(["CLIP", "CAMPAIGN", "MIXED"]),
  problem: z.object({ headline: z.string(), items: z.array(SourcedLineSchema) }),
  /** Ranked: recommended first, then the other workable options, then rejected ones and next steps. */
  options: z.array(RecoveryOptionSchema),
  recommendedId: z.string().optional(),
  /** Set when no option resolves the restriction: the honest next step. */
  noPathMessage: z.string().optional(),
});
export type RecoveryView = z.infer<typeof RecoveryViewSchema>;

/** The last applied recovery option and the two evaluations it connects (what changed, and what REROUTE said). */
export const BeforeAfterSchema = z.object({
  optionId: z.string(),
  kind: RecoveryKindSchema,
  title: z.string(),
  before: z.object({ evaluationId: z.string(), verdict: VerdictSchema, allowedUses: z.number().int(), totalUses: z.number().int(), key: z.string(), title: z.string() }),
  after: z.object({ evaluationId: z.string(), verdict: VerdictSchema, clearance: ClearanceSchema, allowedUses: z.number().int(), totalUses: z.number().int(), key: z.string(), title: z.string() }).optional(),
  timeline: EditTimelineSchema.optional(),
});
export type BeforeAfter = z.infer<typeof BeforeAfterSchema>;

/** The rule package a run is evaluated against (Policy Center). `verified` is false for every demo/uploaded package. */
export const PolicyContextSchema = z.object({
  packageId: z.string(),
  version: z.string(),
  title: z.string(),
  club: z.string(),
  kind: z.enum(["VERIFIED", "DEMO"]),
  sourceType: z.enum(["PRESET", "UPLOADED_JSON", "UPLOADED_CSV", "SAMPLE_DOCUMENT_MAPPING"]),
  verified: z.boolean(),
  /** e.g. "Demo policy — not verified legal clearance". */
  label: z.string(),
});
export type PolicyContext = z.infer<typeof PolicyContextSchema>;

/** One recorded REROUTE campaign evaluation (every proposed channel × territory). */
export const GoalEvaluationSchema = z.object({
  /** Id of the `evaluations` record holding the overall decision. */
  id: z.string(),
  /** ORIGINAL = the proposed media and plan; ALTERNATIVE = independent re-check after a recovery change. */
  kind: z.enum(["ORIGINAL", "ALTERNATIVE"]),
  campaignId: z.string(),
  campaignVersion: z.number().int().positive(),
  key: z.string(),
  /** MediaRefs the decision actually used (re-resolved by REROUTE at decision time). */
  media: z.array(MediaRefSchema),
  edit: EditPlanSchema,
  overall: DecisionSchema,
  perIntent: z.array(IntentDecisionSchema).min(1),
  evaluatedAt: iso,
  /** The rule package the decision used (Policy Center), recorded with it. */
  policy: PolicyContextSchema.optional(),
  /**
   * Planned markets/channels no rule of the package licenses, when NONE of the campaign's markets (or channels)
   * is licensed: no edit or replacement can fix it and a reviewer cannot grant it — a licence request is next.
   */
  licenceGap: z.object({ territories: z.array(z.string()), platforms: z.array(z.string()) }).optional(),
});
export type GoalEvaluation = z.infer<typeof GoalEvaluationSchema>;

/** A recovery option as stored on the run: the view fields plus what `applyRecovery` needs to rebuild it. */
export const StoredRecoveryOptionSchema = RecoveryOptionSchema.extend({
  /** TRIM / SAFE_SECTION: the derived cut. */
  edl: EdlSchema.optional(),
  /** The uses the re-check covered (ADAPT_CAMPAIGN / CHANGE_USAGE change them). */
  intents: z.array(PublishIntentSchema).optional(),
  /** REPLACE: the replacement segment and its canonical link at search time (re-resolved before use). */
  segment: SegmentSchema.optional(),
  media: MediaRefSchema.optional(),
  relevance: z.string().optional(),
});
export type StoredRecoveryOption = z.infer<typeof StoredRecoveryOptionSchema>;

/** One "Find a way to use it" run, bound to the evaluation it was computed for. */
export const GoalRecoverySchema = z.object({
  /** Id of the `alternatives` record holding the plan. */
  id: z.string(),
  forEvaluationId: z.string(),
  forKey: z.string(),
  generatedAt: iso,
  scope: z.enum(["CLIP", "CAMPAIGN", "MIXED"]),
  headline: z.string(),
  problems: z.array(SourcedLineSchema),
  options: z.array(StoredRecoveryOptionSchema),
  recommendedId: z.string().optional(),
  noPathMessage: z.string().optional(),
  /** MediaRefs the plan's evidence came through (source + replacements). */
  media: z.array(MediaRefSchema),
});
export type GoalRecovery = z.infer<typeof GoalRecoverySchema>;

/** An applied recovery option: which evaluation it fixed and which campaign version it produced. */
export const AppliedRecoverySchema = z.object({
  recoveryId: z.string(),
  optionId: z.string(),
  kind: RecoveryKindSchema,
  title: z.string(),
  fromEvaluationId: z.string(),
  fromKey: z.string(),
  campaignVersion: z.number().int().positive(),
  at: iso,
});
export type AppliedRecovery = z.infer<typeof AppliedRecoverySchema>;

/** A campaign version. `campaignId` is stable; every change saves a new `version` (campaigns repo). */
export const GoalCampaignSchema = CampaignDraftSchema.extend({
  campaignId: z.string(),
  version: z.number().int().positive(),
  /** The moment this version uses (a ranked recommendation or an adopted alternative). */
  key: z.string(),
  mediaRef: MediaRefSchema,
  plan: GoalPlanSchema,
  /** Every channel × territory REROUTE is asked about. */
  intents: z.array(PublishIntentSchema).min(1),
  /** Why this version exists (EDIT = a derived cut of the same source, see `edl`). */
  origin: z.enum(["PROPOSAL", "SELECTED", "DESTINATION", "ALTERNATIVE", "REMEDY", "EDIT"]),
  /** Set when this version publishes a derived cut of its source moment: an edit PLAN, not a rendered file. */
  edl: EdlSchema.optional(),
});
export type GoalCampaign = z.infer<typeof GoalCampaignSchema>;

/** Where a run's upstream data came from (`RunProvenance` of lib/media/provenance): LIVE, demo recording or both. */
export const RunProvenanceSchema = z.object({ origin: z.enum(["LIVE", "CACHED", "MIXED"]), recordedAt: z.string().optional() });
export type RunProvenance = z.infer<typeof RunProvenanceSchema>;

export const GoalRunSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(2),
  club: ClubSchema,
  submittedAt: iso,
  resultsAt: iso,
  objective: ParsedObjectiveSchema,
  plan: GoalPlanSchema,
  /** The fixture named in the goal, as written. */
  match: z.string().optional(),
  matchFilter: MatchFilterSchema.optional(),
  intents: z.array(GoalIntentSchema),
  library: z.object({
    videos: z.number().int().nonnegative(),
    indexed: z.number().int().nonnegative(),
    indexName: z.string().optional(),
    latestSeason: z.string().optional(),
  }),
  search: z.object({
    status: z.enum(["FOUND", "NO_MATCHING_MOMENT", "NOT_INDEXED", "UNAVAILABLE"]),
    code: z.string().optional(),
    message: z.string(),
  }),
  attempts: MediaLookupSchema.shape.attempts,
  /** Every ranked moment, diverse assets first; the first three are the recommendations. */
  pool: z.array(RecommendationSchema),
  /** Moments swapped in by a recovery (outside the ranked pool). */
  adopted: z.array(RecommendationSchema).default([]),
  selectedKey: z.string().optional(),
  campaign: GoalCampaignSchema.optional(),
  /** When the first proposal was built (automatically, before any user think-time). */
  proposalAt: iso.optional(),
  evaluations: z.array(GoalEvaluationSchema).default([]),
  /** "Find a way to use it" plans, each bound to the evaluation it was computed for. */
  recoveries: z.array(GoalRecoverySchema).default([]),
  /** Applied recovery options, oldest first. */
  applied: z.array(AppliedRecoverySchema).default([]),
  /** The rule package the run is evaluated against (Policy Center); absent = the club's default package. */
  policy: PolicyContextSchema.optional(),
  review: z.object({ receiptId: z.string(), submittedAt: iso, campaignVersion: z.number().int().positive(), evaluationId: z.string() }).optional(),
  /** Merged provenance of every upstream read made by this run's actions; absent until one made a read. */
  dataOrigin: RunProvenanceSchema.optional(),
});
export type GoalRun = z.infer<typeof GoalRunSchema>;

export const RightsIssueSchema = z.object({
  topic: z.string(),
  outcome: z.enum(["DENY", "MISSING"]),
  dimensions: z.array(z.string()),
  /** REROUTE's own explanations, verbatim. */
  explanations: z.array(z.string()).min(1),
});
export type RightsIssue = z.infer<typeof RightsIssueSchema>;

/**
 * One reason split into its two halves: what was actually FOUND (real data, tagged with where it came
 * from) and the RULE that was applied to it (tagged demo/fictional or verified).
 */
export const ReasonFindingSchema = z.object({
  dimension: z.string(),
  outcome: z.enum(["DENY", "MISSING"]),
  found: z.array(z.object({ text: z.string(), source: z.string() })).min(1),
  rule: z.object({ id: z.string().optional(), text: z.string(), tag: z.enum(["Demo policy · fictional", "Verified policy"]) }),
});
export type ReasonFinding = z.infer<typeof ReasonFindingSchema>;

/** REROUTE's answer for one channel × territory, in plain English. */
export const ChannelRightsSchema = z.object({
  channel: z.string(),
  territory: z.string(),
  use: z.string(),
  verdict: VerdictSchema,
  clearance: ClearanceSchema,
  policyId: z.string(),
  policyVersion: z.string().optional(),
  policyFictional: z.boolean(),
  policySelection: PolicySelectionSchema.optional(),
  /** REROUTE's reasons verbatim (incl. `basis`), for the diagnostics drawer. */
  reasons: z.array(ReasonSchema).default([]),
  issues: z.array(RightsIssueSchema),
  /** Non-permitting reasons split into real evidence vs the rule applied. */
  findings: z.array(ReasonFindingSchema).default([]),
  missingFacts: z.array(z.string()),
});
export type ChannelRights = z.infer<typeof ChannelRightsSchema>;

/** REROUTE's latest verdict for the campaign. PULSE adds wording, never judgment. */
export const RightsViewSchema = z.object({
  state: RightsStateSchema,
  clearance: ClearanceSchema.optional(),
  /** DEMO_CLEARANCE_LABEL whenever a fictional demo policy produced any part of the verdict. */
  clearanceLabel: z.string().optional(),
  headline: z.string(),
  detail: z.string(),
  evaluationId: z.string().optional(),
  kind: GoalEvaluationSchema.shape.kind.optional(),
  campaignVersion: z.number().int().optional(),
  evaluatedAt: iso.optional(),
  /** False when the campaign changed after this evaluation: check again. */
  current: z.boolean(),
  perIntent: z.array(ChannelRightsSchema),
  issues: z.array(RightsIssueSchema),
  missingFacts: z.array(z.string()),
});
export type RightsView = z.infer<typeof RightsViewSchema>;

export const RecommendationViewSchema = RecommendationSchema.extend({
  /** Latest recorded overall verdict for this moment, if REROUTE evaluated it. */
  rights: z.object({ state: RightsStateSchema, clearance: ClearanceSchema.optional() }),
});
export type RecommendationView = z.infer<typeof RecommendationViewSchema>;

export const ChecklistItemSchema = z.object({
  item: z.string(),
  status: z.enum(["DONE", "MISSING", "NOT_CONNECTED"]),
  note: z.string(),
});

export const ReviewStatusSchema = z.enum(["NOT_SUBMITTED", "PENDING", "APPROVED", "REJECTED"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const GoalViewSchema = z.object({
  /** Run document version: send it back as `expectedVersion` on every action (stale → CONFLICT). */
  version: z.number().int().positive(),
  run: GoalRunSchema.pick({
    id: true,
    club: true,
    submittedAt: true,
    resultsAt: true,
    objective: true,
    plan: true,
    match: true,
    matchFilter: true,
    intents: true,
    library: true,
    search: true,
    attempts: true,
    selectedKey: true,
  }),
  recommendations: z.array(RecommendationViewSchema),
  selected: RecommendationViewSchema.optional(),
  campaign: GoalCampaignSchema.extend({ checklist: z.array(ChecklistItemSchema) }).optional(),
  rights: RightsViewSchema,
  /** "Find a way to use it" for the LATEST evaluation: ranked, independently re-checked recovery options. */
  recovery: RecoveryViewSchema.optional(),
  /** The current campaign version is a derived cut of its source (edit plan, not rendered). */
  edit: EditTimelineSchema.optional(),
  /** Latest applied recovery: what changed and REROUTE's verdict before and after. */
  beforeAfter: BeforeAfterSchema.optional(),
  /** The rule package this run is evaluated against. */
  policy: PolicyContextSchema.optional(),
  /** Audit trail of every recorded evaluation, oldest first. */
  evaluations: z.array(
    z.object({
      id: z.string(),
      kind: GoalEvaluationSchema.shape.kind,
      campaignVersion: z.number().int(),
      key: z.string(),
      verdict: VerdictSchema,
      clearance: ClearanceSchema,
      evaluatedAt: iso,
    }),
  ),
  receiptId: z.string().optional(),
  reviewStatus: ReviewStatusSchema,
  /** Submitting is allowed for ALLOWED (any clearance) or NEEDS_REVIEW on the current version; never BLOCKED. */
  canSubmit: z.boolean(),
  writeback: z.object({
    status: z.enum(["NOT_STARTED", "DRY_RUN", "WRITTEN", "VERIFIED", "FAILED", "REFUSED"]),
    at: z.string().optional(),
    detail: z.string().optional(),
  }),
  /** `canPublish()` on the receipt: verified clearance AND human approval. Demo clearance is never publishable. */
  publishable: z.boolean(),
  publishNote: z.string(),
  nextStep: z.string(),
  /**
   * The objective's primary KPI. `value` stays null until a verified source is connected; `valueText`
   * says so in one line (e.g. "Sales attribution not connected.").
   */
  kpi: z.object({ label: z.string(), value: z.null(), valueText: z.string(), status: MeasurementSchema.shape.status, note: z.string() }),
  /** Measured server-side from goal submission. `toProposalSec` = first proposal createdAt − submittedAt. */
  timing: z.object({ toRecommendationsSec: z.number(), toProposalSec: z.number().optional() }),
  /** Where the run's TwelveLabs/ScorePlay data came from (LIVE, CACHED demo recording, or MIXED); absent = no upstream read recorded. */
  dataOrigin: RunProvenanceSchema.optional(),
});
export type GoalView = z.infer<typeof GoalViewSchema>;

const httpsUrl = z.url({ protocol: /^https$/ });

/** Every action on an existing run carries the run version the user saw; a stale one is rejected (CONFLICT). */
const onRun = { id: z.string(), expectedVersion: z.number().int().positive() };

export const GoalActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), goal: z.string().trim().min(3).max(280), club: ClubSchema }),
  z.object({ action: z.literal("select"), ...onRun, key: z.string() }),
  z.object({ action: z.literal("draft"), ...onRun, commerceUrl: httpsUrl.optional() }),
  z.object({ action: z.literal("checkRights"), ...onRun }),
  z.object({ action: z.literal("findRecovery"), ...onRun }),
  z.object({ action: z.literal("applyRecovery"), ...onRun, optionId: z.string() }),
  /** Evaluate this run against another rule package (Policy Center); the next rights check uses it. */
  z.object({ action: z.literal("setPolicy"), ...onRun, packageId: z.string() }),
  z.object({ action: z.literal("submitForReview"), ...onRun }),
]);
export type GoalAction = z.infer<typeof GoalActionSchema>;
