import { randomUUID } from "node:crypto";
import type { EditDecision } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { decideEdit } from "@/lib/server/decide";
import { buildCampaignDraft, campaignView } from "../campaign-builder";
import { computeBusinessMetrics } from "../business-metrics";
import { configuredDestination } from "../commerce";
import { detectOpportunities } from "../detect-opportunities";
import { pulseSignalSource } from "../flags";
import { buildHandoff, handoffToReroute } from "../handoff-to-reroute";
import { analyzeMarket } from "../market-signals";
import { PRODUCTS, parseObjective } from "../objective-parser";
import { marketFit } from "../objective-ranker";
import { buildView, rankOpportunities } from "../rank-opportunities";
import { SIGNAL_FIXTURE, SPONSOR_BRIEFS, fixtureSignals, manualSignal } from "../signal-adapter";
import type {
  ActionRequest,
  BusinessMetrics,
  CampaignView,
  CommerceDestination,
  LedgerEntry,
  ManualTrigger,
  OpportunitiesResponse,
  OpportunityResponse,
  OpportunityView,
  ParsedObjective,
  RankingComparison,
  RightsCheck,
  StoredManualTrigger,
} from "../types";
import { campaignRepository } from "./campaign-repository";
import { lookupMedia } from "./media-lookup";
import { readPulse, transact, type PulseData, type Snapshot } from "./store";

/**
 * Rebuilds opportunities from the configured signal source (+ an optional new manual trigger) and
 * looks up media. `objective`: a string sets the active business objective, `null` clears it.
 */
export async function refresh(input: { manual?: ManualTrigger; objective?: string | null } = {}): Promise<void> {
  const { manual } = input;
  const objective = typeof input.objective === "string" ? parseObjective(input.objective) : input.objective;
  if (objective && !objective.market && !objective.product) {
    throw new AppError(
      "BAD_REQUEST",
      `PULSE found neither a market nor a product in “${objective.raw}”. Try: “I want to increase jersey sales in Mexico.”`,
    );
  }
  const source = pulseSignalSource();
  if (typeof source !== "string") {
    throw new AppError(
      "NOT_CONFIGURED",
      `PULSE_SIGNAL_SOURCE="${source.unsupported}" is not supported; use "fixture" or "manual" (no live social connector is configured).`,
    );
  }
  const now = new Date();
  const previous = await readPulse();
  const added: StoredManualTrigger | undefined = manual && { ...manual, id: randomUUID().slice(0, 8), createdAt: now.toISOString() };
  const triggers = added ? [...previous.manualTriggers, added] : previous.manualTriggers;

  const items = [...(source === "fixture" ? fixtureSignals() : []), ...triggers.map(manualSignal)];
  const firstSeen = new Map(previous.snapshot?.opportunities.map((o) => [o.id, o.detectedAt]));
  const detected = detectOpportunities(
    items,
    SPONSOR_BRIEFS,
    { now, replayClock: source === "fixture" ? new Date(SIGNAL_FIXTURE.replayClock) : undefined },
    now.toISOString(),
  ).map((o) => ({ ...o, detectedAt: firstSeen.get(o.id) ?? o.detectedAt }));
  const lookups = await Promise.all(detected.map((o) => lookupMedia(o)));

  const snapshot: Snapshot = {
    meta: {
      builtAt: now.toISOString(),
      signalSource: source,
      ...(source === "fixture" && {
        demoLabel: SIGNAL_FIXTURE.label,
        demoDisclaimer: SIGNAL_FIXTURE.disclaimer,
        replayClock: SIGNAL_FIXTURE.replayClock,
      }),
    },
    opportunities: detected,
    media: Object.fromEntries(detected.map((o, i) => [o.id, lookups[i]])),
  };
  await transact((data) => {
    data.snapshot = snapshot;
    if (added) data.manualTriggers.push(added);
    if (objective !== undefined) data.objective = objective ?? undefined;
    return { result: undefined, write: true };
  });
}

/** Persisted state; builds the first snapshot on demand so a fresh deployment shows opportunities. */
async function loadState(): Promise<PulseData & { snapshot: Snapshot }> {
  const data = await readPulse();
  if (data.snapshot) return { ...data, snapshot: data.snapshot };
  await refresh();
  const built = await readPulse();
  if (!built.snapshot) throw new AppError("INTERNAL", "PULSE snapshot was not persisted");
  return { ...built, snapshot: built.snapshot };
}

function viewsOf(state: PulseData & { snapshot: Snapshot }, objective: ParsedObjective | undefined = state.objective): OpportunityView[] {
  return rankOpportunities(
    state.snapshot.opportunities.map((o) => {
      const view = buildView(o, state.snapshot.media[o.id], state.ledger[o.id]);
      if (!objective) return view;
      const scope = objective.market?.code ?? (objective.scope === "GLOBAL" ? "GLOBAL" : undefined);
      return { ...view, market: marketFit(view, objective, scope && analyzeMarket(o.signal.topic, scope)) };
    }),
  );
}

/** Preset objectives ranked side by side: the same footage, different business goals, different order. */
export const COMPARISON_OBJECTIVES = ["Sell jerseys in Mexico", "Maximize global engagement"] as const;

function compareObjectives(state: PulseData & { snapshot: Snapshot }): RankingComparison {
  return COMPARISON_OBJECTIVES.map((raw) => {
    const objective = parseObjective(raw);
    return {
      objective: objective.summary,
      ranked: viewsOf(state, objective)
        .filter((v) => v.status !== "DISMISSED" && v.market)
        .map((v) => ({ id: v.id, headline: v.headline, score: v.market!.score, label: v.market!.label })),
    };
  });
}

export async function listOpportunities(): Promise<OpportunitiesResponse> {
  const state = await loadState();
  return {
    meta: state.snapshot.meta,
    opportunities: viewsOf(state),
    briefs: [...SPONSOR_BRIEFS],
    objective: state.objective,
    comparison: compareObjectives(state),
  };
}

async function findView(id: string): Promise<{ state: PulseData & { snapshot: Snapshot }; view: OpportunityView }> {
  const state = await loadState();
  const view = viewsOf(state).find((v) => v.id === id);
  if (!view) throw new AppError("NOT_FOUND", `Opportunity ${id} not found`);
  return { state, view };
}

export async function getOpportunity(id: string): Promise<OpportunityResponse> {
  const { state, view } = await findView(id);
  const draft = await campaignRepository.get(id);
  return {
    meta: state.snapshot.meta,
    opportunity: view,
    brief: SPONSOR_BRIEFS.find((b) => b.id === view.sponsorBriefId),
    objective: state.objective,
    campaign: draft && campaignView(draft, view.ledger, state.objective),
  };
}

/**
 * Builds (or rebuilds) the campaign proposal for one opportunity from the active objective and a
 * producer-selected ScorePlay candidate, then saves it through the repository port.
 */
export async function draftCampaign(req: Extract<ActionRequest, { action: "draftCampaign" }>): Promise<{
  opportunity: OpportunityView;
  campaign: CampaignView;
}> {
  const { state, view } = await findView(req.id);
  const objective = state.objective;
  if (!objective) throw new AppError("BAD_REQUEST", "Set a business objective first — a campaign proposal is built for an objective.");
  if (view.status === "DISMISSED" || view.status === "PUBLISHED") {
    throw new AppError("BAD_REQUEST", `Opportunity is ${view.status}; no new campaign draft`);
  }
  const candidate = view.media?.candidates.find((c) => c.scoreplayAssetId === req.scoreplayAssetId);
  if (!candidate) throw new AppError("BAD_REQUEST", `Asset ${req.scoreplayAssetId} is not a media candidate of ${req.id}`);

  const product = objective.product?.key;
  const kind = product && PRODUCTS[product].commerce;
  if (req.commerceUrl && !kind) throw new AppError("BAD_REQUEST", "This objective has no store or ticketing destination.");
  const destination: CommerceDestination | undefined =
    product && kind
      ? req.commerceUrl
        ? { kind, url: req.commerceUrl, source: "PRODUCER_ENTERED" }
        : configuredDestination(view.club, product, kind, objective.market?.code)
      : undefined;

  const draft = await campaignRepository.save(
    buildCampaignDraft({
      view,
      objective,
      candidate,
      brief: SPONSOR_BRIEFS.find((b) => b.id === view.sponsorBriefId),
      destination,
      now: new Date(),
      previous: await campaignRepository.get(req.id),
    }),
  );
  return { opportunity: view, campaign: campaignView(draft, view.ledger, objective) };
}

export async function businessMetrics(): Promise<BusinessMetrics> {
  return computeBusinessMetrics(viewsOf(await loadState()), SPONSOR_BRIEFS);
}

/** Records REROUTE's verdict as PULSE's rights state; PULSE adds no judgment of its own. */
function rightsCheckFrom(result: EditDecision, scoreplayAssetId: string): RightsCheck {
  const { decision } = result;
  const seen = new Set<string>();
  return {
    state: decision.verdict,
    checkedAt: decision.evaluatedAt,
    scoreplayAssetId,
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    policyFictional: decision.policyFictional,
    reasons: decision.reasons
      .filter((r) => r.outcome !== "PERMIT" && !seen.has(r.explanation) && seen.add(r.explanation))
      .map(({ dimension, outcome, explanation }) => ({ dimension, outcome, explanation })),
    missingFacts: decision.missingFacts,
  };
}

function updateLedger(id: string, mutate: (entry: LedgerEntry) => LedgerEntry): Promise<void> {
  return transact((data) => {
    data.ledger[id] = mutate(data.ledger[id] ?? { status: "DETECTED" });
    return { result: undefined, write: true };
  });
}

/** Sends one producer-selected candidate through the existing REROUTE decision path. */
export async function handoff(opportunityId: string, scoreplayAssetId: string): Promise<{ rerouteUrl: string; opportunity: OpportunityView }> {
  const { state, view } = await findView(opportunityId);
  if (view.status === "DISMISSED" || view.status === "PUBLISHED") {
    throw new AppError("BAD_REQUEST", `Opportunity is ${view.status}; restore it before sending it to REROUTE`);
  }
  const candidate = view.media?.candidates.find((c) => c.scoreplayAssetId === scoreplayAssetId);
  if (!candidate) throw new AppError("BAD_REQUEST", `Asset ${scoreplayAssetId} is not a media candidate of ${opportunityId}`);

  const brief = SPONSOR_BRIEFS.find((b) => b.id === view.sponsorBriefId);
  const { edit, intent, rerouteUrl } = handoffToReroute(buildHandoff(view, candidate), {
    brief,
    territory: state.objective?.market?.code,
    now: new Date(),
  });
  const rights = rightsCheckFrom(await decideEdit(edit, intent), scoreplayAssetId);
  // A new handoff is a new cut: any earlier approval was for a different candidate and is dropped.
  await updateLedger(opportunityId, () => ({
    status: "SENT_TO_REROUTE",
    handoff: { at: new Date().toISOString(), scoreplayAssetId, edit, intent, rerouteUrl, objective: state.objective?.summary },
    rights,
  }));
  return { rerouteUrl, opportunity: (await findView(opportunityId)).view };
}

/** Producer actions. Approval and publication re-ask REROUTE; a stale or client-sent verdict is never trusted. */
export async function act(req: Exclude<ActionRequest, { action: "draftCampaign" }>): Promise<OpportunityView> {
  const { view } = await findView(req.id);
  const entry = view.ledger;

  switch (req.action) {
    case "dismiss":
      if (entry.status === "PUBLISHED") throw new AppError("BAD_REQUEST", "Published opportunities cannot be dismissed");
      await updateLedger(req.id, (e) => ({ ...e, status: "DISMISSED", dismissedAt: new Date().toISOString(), dismissReason: req.reason || undefined }));
      break;
    case "restore":
      if (entry.status !== "DISMISSED") throw new AppError("BAD_REQUEST", "Only dismissed opportunities can be restored");
      await updateLedger(req.id, (e) => ({
        ...e,
        status: e.handoff ? "SENT_TO_REROUTE" : "DETECTED",
        approvedAt: undefined,
        approvedBy: undefined,
        dismissedAt: undefined,
        dismissReason: undefined,
      }));
      break;
    case "recheck":
    case "approve":
    case "publish": {
      const sent = entry.handoff;
      if (!sent) throw new AppError("BAD_REQUEST", "Open the opportunity in REROUTE first; nothing has been checked yet");
      if (req.action === "approve" && entry.status !== "SENT_TO_REROUTE") {
        throw new AppError("BAD_REQUEST", `Cannot approve an opportunity that is ${entry.status}`);
      }
      if (req.action === "publish" && entry.status !== "APPROVED") {
        throw new AppError("BAD_REQUEST", "Only approved opportunities can be recorded as published");
      }
      const rights = rightsCheckFrom(await decideEdit(sent.edit, sent.intent), sent.scoreplayAssetId);
      const allowed = rights.state === "ALLOWED";
      const at = new Date().toISOString();
      await updateLedger(req.id, (e) => {
        if (!allowed || req.action === "recheck") return { ...e, rights };
        if (req.action === "approve") return { ...e, rights, status: "APPROVED", approvedAt: at, approvedBy: req.reviewer };
        return { ...e, rights, status: "PUBLISHED", publishedAt: at, publishEvidenceUrl: req.evidenceUrl };
      });
      if (!allowed && req.action !== "recheck") {
        throw new AppError(
          "FORBIDDEN",
          `REROUTE verdict is ${rights.state}; only an ALLOWED verdict can be ${req.action === "approve" ? "approved" : "recorded as published"}. Resolve it in REROUTE first.`,
        );
      }
      break;
    }
  }
  return (await findView(req.id)).view;
}
