import type { RightsDecision } from './compliance';

export interface VideoAnalysis { summary: string; labels: string[]; scenes?: Array<{ startSeconds: number; endSeconds: number; description: string }>; modelVersion?: string; musicDetected: boolean; minorDetected: boolean; thirdPartyRights: 'none' | 'ambiguous' | 'confirmed'; providerRef?: string }
export interface VideoAnalysisAdapter { analyze(assetRef: string): Promise<VideoAnalysis> }
export interface SportsMediaLocator { collectionId?: string; mediaId?: string; versionId?: string; fileId?: string; capturedAtTimecode?: string }
export interface MediaEnrichment { tags: Record<string, string | string[]>; logs: Array<{ startSeconds: number; endSeconds: number; type: string; value: string }> }
export interface ScorePlayAsset { externalId: string; filename: string; creatorHandle?: string; locator?: SportsMediaLocator; enrichment?: MediaEnrichment; metadata: Record<string, string | string[]> }
export interface RightsWriteback { externalId: string; decision: RightsDecision; expiresAt: string; consentRecordId: string; auditHash: string }
export interface ScorePlayAdapter { ingest(asset: ScorePlayAsset): Promise<{ assetRef: string }>; writeRights(result: RightsWriteback): Promise<void> }

export class MockTwelveLabsAdapter implements VideoAnalysisAdapter {
  async analyze(): Promise<VideoAnalysis> { return { summary: 'Fan celebrates a game-winning moment courtside.', labels: ['fan reaction', 'arena', 'celebration'], scenes: [{ startSeconds: 0, endSeconds: 14, description: 'Courtside celebration after a game-winning moment' }], modelVersion: 'demo-placeholder', musicDetected: false, minorDetected: false, thirdPartyRights: 'none', providerRef: 'mock-tl-9082' }; }
}

export class MockScorePlayAdapter implements ScorePlayAdapter {
  async ingest(asset: ScorePlayAsset) { return { assetRef: `mock-scoreplay:${asset.externalId}` }; }
  async writeRights(): Promise<void> { return; }
}

// Production adapters intentionally stop here. Do not add URLs until vendor docs and credentials are supplied.
export const integrationConfig = {
  scorePlayBaseUrl: process.env.NEXT_PUBLIC_SCOREPLAY_BASE_URL ?? '',
  twelveLabsBaseUrl: process.env.NEXT_PUBLIC_TWELVELABS_BASE_URL ?? '',
  mode: process.env.NEXT_PUBLIC_INTEGRATION_MODE ?? 'mock',
};
