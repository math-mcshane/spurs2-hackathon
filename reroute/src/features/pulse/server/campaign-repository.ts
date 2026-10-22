import { randomUUID } from "node:crypto";
import { campaigns } from "@/lib/server/repositories";
import { CampaignDraftSchema, type CampaignDraft } from "../types";

/**
 * Board campaign proposals (one per fan-signal opportunity), stored as versioned campaigns in Supabase
 * (`reroute_campaigns` keyed by `opportunity_id`). Every save appends a version; earlier drafts are kept.
 */
export interface CampaignDraftRepository {
  get(opportunityId: string): Promise<CampaignDraft | undefined>;
  save(draft: CampaignDraft): Promise<CampaignDraft>;
}

/** Audit actor for drafts PULSE composes from (simulated) board signals. */
const BOARD_ACTOR = "pulse-board";

export const campaignRepository: CampaignDraftRepository = {
  async get(opportunityId) {
    const record = await campaigns.findByOpportunity(opportunityId);
    return record ? CampaignDraftSchema.parse(record.draft) : undefined;
  },
  async save(draft) {
    const valid = CampaignDraftSchema.parse(draft);
    const existing = await campaigns.findByOpportunity(valid.opportunityId);
    await campaigns.saveVersion(existing?.id ?? randomUUID(), valid, BOARD_ACTOR, { opportunityId: valid.opportunityId });
    return valid;
  },
};
