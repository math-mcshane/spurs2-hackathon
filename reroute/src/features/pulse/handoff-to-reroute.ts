import type { EditPlan, PublishIntent } from "@/lib/contracts";
import { CLUBS } from "./clubs";
import type { MediaCandidate, OpportunityView, PulseHandoff, SponsorBrief } from "./types";

/** Default cut length when the media search returned no timecodes (spec demo A: 12–15 s social). */
export const PULSE_CUT_MAX_SEC = 15;

/** Spec §7 handoff contract for one opportunity; the producer-selected candidate goes first. */
export function buildHandoff(view: OpportunityView, selected: MediaCandidate): PulseHandoff {
  const others = (view.media?.candidates ?? []).filter((c) => c.scoreplayAssetId !== selected.scoreplayAssetId);
  return {
    opportunityId: view.id,
    club: view.club,
    creativeBrief: `${view.headline} — ${view.angle}`,
    targetAudience: view.targetAudienceCohort,
    desiredFormat: view.desiredFormat,
    mediaCandidates: [selected, ...others].map((c) => ({
      scoreplayAssetId: c.scoreplayAssetId,
      twelveLabsAssetId: c.twelveLabsVideoId,
      startSeconds: c.startSeconds,
      endSeconds: c.endSeconds,
      durationSec: c.durationSec,
      competition: c.competition,
    })),
    sponsorBriefId: view.sponsorBriefId,
    sourceEvidenceIds: view.signal.samples.map((s) => s.id),
  };
}

export type RerouteInput = { edit: EditPlan; intent: PublishIntent; rerouteUrl: string };

/**
 * Maps the handoff onto what REROUTE actually accepts: one `EditPlan` + `PublishIntent` (for
 * `decideEdit`) and a deep link to the REROUTE desk preloading the same asset, cut and intent.
 * The creative brief, audience and other candidates stay in PULSE state. The sponsor brief only
 * says *where* the post would run (publish intent); it never grants rights. An active business
 * objective's market overrides the territory, so REROUTE checks rights where the post targets.
 */
export function handoffToReroute(
  payload: PulseHandoff,
  opts: { brief?: SponsorBrief; territory?: string; now: Date },
): RerouteInput {
  const [candidate] = payload.mediaCandidates;
  const start = candidate.startSeconds ?? 0;
  const end =
    candidate.endSeconds ?? Math.min(start + PULSE_CUT_MAX_SEC, candidate.durationSec ?? start + PULSE_CUT_MAX_SEC);
  const edit: EditPlan = {
    id: `pulse-${payload.opportunityId}-${candidate.scoreplayAssetId}`,
    title: `PULSE · ${payload.creativeBrief}`.slice(0, 140),
    segments: [{ scoreplayMediaId: candidate.scoreplayAssetId, start, end, label: "PULSE cut" }],
    derived: false,
  };
  const club = CLUBS[payload.club];
  const where = opts.brief?.publishIntent ?? club.editorialIntent;
  const intent: PublishIntent = {
    territory: opts.territory ?? where.territory,
    platform: where.platform,
    usage: where.usage,
    competition: candidate.competition ?? club.competition,
    // Same default REROUTE's desk uses: the next full hour + 1 h.
    publishAt: new Date(Math.ceil(opts.now.getTime() / 3_600_000) * 3_600_000 + 3_600_000).toISOString(),
  };
  const params = new URLSearchParams({
    pulse: payload.opportunityId,
    asset: candidate.scoreplayAssetId,
    start: String(start),
    end: String(end),
    territory: intent.territory,
    platform: intent.platform,
    usage: intent.usage,
    competition: intent.competition,
    publishAt: intent.publishAt,
    brief: payload.creativeBrief.slice(0, 160),
  });
  return { edit, intent, rerouteUrl: `/?${params}` };
}
