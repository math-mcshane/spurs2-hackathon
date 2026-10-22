/**
 * REROUTE unified CDM — shared TypeScript contracts
 * Spurs² Hackathon · Rights & Compliance · DEMO policies only
 */

export type Verdict = 'ALLOWED' | 'NEEDS_REVIEW' | 'BLOCKED';
export type UsageType = 'organic' | 'sponsored' | 'paid';
export type PackKind =
  | 'league'
  | 'team'
  | 'player'
  | 'territory'
  | 'advertiser'
  | 'platform'
  | 'competition';

export type MediaType = 'photo' | 'video';
export type WritebackStatus = 'pending' | 'ok' | 'failed' | 'skipped';

/** ScorePlay-shaped locator (CLEAR discovery) */
export interface SportsMediaLocator {
  collectionId?: string;
  mediaId: string;
  versionId?: string;
  fileId?: string;
  capturedAtTimecode?: string;
}

export interface Org {
  id: string;
  scoreplayCompanyId?: string;
  clubCode?: 'SAS' | 'TOT' | string;
}

export interface EventRef {
  id: string;
  scoreplayEventId?: string;
  name: string;
  competitionCode?: string;
  fullPath?: string;
}

export interface Rendition {
  id: string;
  details: 'photographer_quality' | 'compressed_quality' | 'thumbnail_quality' | string;
  url: string;
  width?: number;
  height?: number;
  isThumbnail?: boolean;
  isCompressed?: boolean;
}

export interface AssetTag {
  tagOptionId: string;
  label: string;
  type?: string;
  playerId?: string;
  sponsorId?: string;
}

/** Canonical media row */
export interface Asset {
  id: string;
  scoreplayMediaId: string;
  orgId: string;
  event?: EventRef;
  mediaType: MediaType;
  description?: string;
  usage?: string;
  status?: string;
  validated?: boolean;
  /** ScorePlay URL passed directly to TwelveLabs */
  tlSourceUrl: string;
  tlAssetId?: string;
  tlIndexId?: string;
  tlStatus?: 'pending' | 'ready' | 'failed';
  renditions: Rendition[];
  tags: AssetTag[];
  locator?: SportsMediaLocator;
}

export interface PublishIntent {
  territory: string; // ISO-ish: FR, US, GB, Worldwide
  platform: string; // instagram | x | tiktok | youtube | ...
  usage: UsageType;
  competition: string;
  publishAt: string; // ISO date
  advertiserId?: string;
  campaignId?: string;
  notes?: string;
}

export interface Segment {
  id: string;
  editId: string;
  startSeconds: number;
  endSeconds: number;
  sourceAssetId: string;
  label?: string;
  observationIds?: string[];
}

export interface Edit {
  id: string;
  title: string;
  orgId: string;
  rootAssetId: string;
  versionId: string;
  parentVersionId?: string;
  segments: Segment[];
  durationSeconds: number;
}

export interface Observation {
  id: string;
  runId: string;
  assetId: string;
  questionId: string; // e.g. sponsors_seen, player_focus
  section?: string; // MEDIA-01, RIGHTS-01, ...
  value: string | string[] | Record<string, unknown>;
  startSeconds?: number;
  endSeconds?: number;
  citation?: string;
  confidence?: number;
}

export interface ObservationRun {
  id: string;
  assetId: string;
  provider: 'twelvelabs';
  modelAnalyze?: string; // pegasus1.6
  modelSearch?: string; // marengo3.0
  indexId?: string;
  sourceUrl: string;
  cached: boolean;
  createdAt: string;
}

export interface PolicyRule {
  ruleId: string;
  packId: string;
  dimension: string;
  severity: 'block' | 'restrict' | 'warn';
  parameters: Record<string, unknown>;
  demoLabel: string; // always set for hackathon
  version: number;
  active: boolean;
}

export interface PolicyPack {
  id: string;
  kind: PackKind;
  name: string;
  version: string;
  rules: PolicyRule[];
  demo: true;
}

export interface EntitlementFact {
  id: string;
  assetId?: string;
  subjectKind: PackKind | 'creator';
  claimType: string;
  claimValue: string;
  validFrom?: string;
  validUntil?: string;
  source: 'scoreplay' | 'demo_seed' | 'clear_license' | 'manual';
}

export interface PackDecision {
  packId: string;
  kind: PackKind;
  verdict: Verdict;
  ruleIds: string[];
  reasons: string[];
}

export interface Decision {
  id: string;
  editId: string;
  intent: PublishIntent;
  verdict: Verdict;
  packDecisions: PackDecision[];
  segmentVerdicts: Array<{ segmentId: string; verdict: Verdict; ruleIds: string[] }>;
  policyVersions: string[];
  observationRunIds: string[];
  evaluatedAt: string;
  evaluator: string;
}

export interface Alternative {
  id: string;
  forSegmentId: string;
  candidateAssetId: string;
  startSeconds: number;
  endSeconds: number;
  similarityScore: number;
  decision: Decision;
  previewUrl?: string;
}

export interface ResolutionPlan {
  id: string;
  editId: string;
  decisionId: string;
  replacements: Array<{
    segmentId: string;
    alternativeId: string;
  }>;
  createdAt: string;
}

export interface RenderJob {
  id: string;
  planId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  outputVersionId?: string;
  outputPath?: string;
  error?: string;
}

export interface RightsReceipt {
  id: string;
  editId: string;
  versionId: string;
  intent: PublishIntent;
  verdict: Verdict;
  decisionId: string;
  policyVersions: string[];
  evidenceSummary: string[];
  replacements: Array<{
    segmentId: string;
    fromAssetId: string;
    toAssetId: string;
    startSeconds: number;
    endSeconds: number;
  }>;
  demoDisclosure: string;
  createdAt: string;
  writebackStatus: WritebackStatus;
}

/** CLEAR bridge */
export interface Creator {
  id: string;
  displayName: string;
  contact?: string;
  handle?: string;
}

export interface ConsentEvent {
  id: string;
  creatorId: string;
  assetId: string;
  licensePayloadHash: string;
  acceptedAt: string;
}

export interface MicroLicense {
  id: string;
  assetId: string;
  platforms: string[];
  territories: string[];
  paidAllowed: boolean;
  modificationAllowed: boolean;
  expiresAt: string;
  templateVersion: string;
}
