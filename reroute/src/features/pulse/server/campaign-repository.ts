import { CampaignDraftSchema, type CampaignDraft } from "../types";
import { transact } from "./store";

/**
 * Persistence port for campaign drafts. One draft per opportunity, stored as a whole validated
 * document — maps 1:1 to a future Supabase table, e.g.
 * `pulse_campaign_drafts(opportunity_id text primary key, id text, schema_version int, payload jsonb, updated_at timestamptz)`.
 * A Supabase adapter implements these two methods; nothing else in PULSE touches storage for drafts.
 */
export interface CampaignDraftRepository {
  get(opportunityId: string): Promise<CampaignDraft | undefined>;
  save(draft: CampaignDraft): Promise<CampaignDraft>;
}

/** Local adapter: PULSE's own `.data/pulse.json` (never REROUTE's store). */
export const fileCampaignRepository: CampaignDraftRepository = {
  get: (opportunityId) => transact((data) => ({ result: data.campaigns[opportunityId], write: false })),
  save: (draft) =>
    transact((data) => {
      const valid = CampaignDraftSchema.parse(draft);
      data.campaigns[valid.opportunityId] = valid;
      return { result: valid, write: true };
    }),
};

/** The active adapter. */
export const campaignRepository: CampaignDraftRepository = fileCampaignRepository;
