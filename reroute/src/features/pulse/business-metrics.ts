import type { BusinessMetrics, OpportunityView, SponsorBrief } from "./types";

/** Media recorded this long before publication counts as archive reuse. */
export const ARCHIVE_AGE_DAYS = 30;

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = values.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/** Median minutes from detection to the timestamp `pick` returns (views without one are skipped). */
function medianMinutes(views: OpportunityView[], pick: (v: OpportunityView) => string | undefined): number | undefined {
  return median(
    views.flatMap((v) => {
      const at = pick(v);
      return at ? [Math.max(0, (Date.parse(at) - Date.parse(v.detectedAt)) / 60_000)] : [];
    }),
  );
}

/**
 * Fulfillment, pipeline and efficiency are reported separately and never summed into a revenue
 * figure. Money appears only as an allocation of an already-signed package value when a brief
 * carries one; no price, conversion rate or sale is ever invented.
 */
export function computeBusinessMetrics(views: readonly OpportunityView[], briefs: readonly SponsorBrief[]): BusinessMetrics {
  const all = [...views];
  const active = all.filter((v) => v.status !== "DISMISSED");
  const selected = all.filter((v) => v.ledger.handoff);
  const eligible = all.filter((v) => v.rightsState === "ALLOWED");
  const approved = all.filter((v) => v.status === "APPROVED" || v.status === "PUBLISHED");
  const published = all.filter((v) => v.status === "PUBLISHED" && v.ledger.publishEvidenceUrl);
  const attributed = published.filter((v) => v.deliverableState === "FULFILLED");

  const fulfillment = briefs.flatMap((brief) => {
    const contracted = brief.contractedDeliverables;
    if (contracted === undefined) return [];
    const mine = all.filter((v) => v.sponsorBriefId === brief.id);
    const publishedBaseline = brief.publishedDeliverables ?? 0;
    const publishedViaPulse = mine.filter((v) => v.deliverableState === "FULFILLED").length;
    const deliverableReady = mine.filter((v) => v.deliverableState === "DELIVERABLE_READY").length;
    const remaining = Math.max(0, contracted - publishedBaseline - publishedViaPulse);
    const value = brief.allocatedPackageValue;
    return [
      {
        briefId: brief.id,
        partnerLabel: brief.partnerLabel,
        dataStatus: brief.dataStatus,
        contracted,
        publishedBaseline,
        publishedViaPulse,
        deliverableReady,
        remaining,
        coverage: contracted > 0 ? Math.min(1, (publishedBaseline + publishedViaPulse) / contracted) : 0,
        openCommitmentAllocation:
          value !== undefined && brief.currency && contracted > 0
            ? { amount: Math.round((value / contracted) * remaining), currency: brief.currency }
            : undefined,
      },
    ];
  });

  const archiveActivation = published.filter((v) => {
    const used = v.media?.candidates.find((c) => c.scoreplayAssetId === v.ledger.handoff?.scoreplayAssetId);
    if (!used?.recordedAt || !v.ledger.publishedAt) return false;
    return Date.parse(v.ledger.publishedAt) - Date.parse(used.recordedAt) > ARCHIVE_AGE_DAYS * 86_400_000;
  }).length;

  const policies = [
    ...new Set(all.flatMap((v) => (v.ledger.rights ? [`${v.ledger.rights.policyId}${v.ledger.rights.policyFictional ? " (fictional)" : ""}`] : []))),
  ];
  const dataQuality = [
    all.some((v) => v.evidenceMode === "FIXTURE") && "Fan signals include SIMULATED demo replay posts — not live public sentiment.",
    all.some((v) => v.evidenceMode === "MANUAL") && "Some opportunities are producer-entered triggers without fan evidence.",
    briefs.some((b) => b.dataStatus === "DEMO") &&
      `${briefs.filter((b) => b.dataStatus === "DEMO").length} sponsor brief(s) are FICTIONAL demo contracts.`,
    policies.length > 0
      ? `Rights states are REROUTE verdicts under policy ${policies.join(", ")}.`
      : "No opportunity has been checked by REROUTE yet; every rights state is NOT_CHECKED.",
    "No revenue is reported: no attributable, validated sale has been recorded.",
  ].filter((s): s is string => typeof s === "string");

  return {
    funnel: [
      { key: "DETECTED", label: "Detected", count: all.length },
      {
        key: "PRODUCER_SELECTED",
        label: "Producer-selected",
        count: selected.length,
        medianMinutesFromDetection: medianMinutes(selected, (v) => v.ledger.handoff?.at),
      },
      {
        key: "RIGHTS_ELIGIBLE",
        label: "Rights-eligible (REROUTE ALLOWED)",
        count: eligible.length,
        medianMinutesFromDetection: medianMinutes(eligible, (v) => v.ledger.rights?.checkedAt),
      },
      {
        key: "APPROVED",
        label: "Approved",
        count: approved.length,
        medianMinutesFromDetection: medianMinutes(approved, (v) => v.ledger.approvedAt),
      },
      {
        key: "PUBLISHED",
        label: "Published (evidenced)",
        count: published.length,
        medianMinutesFromDetection: medianMinutes(published, (v) => v.ledger.publishedAt),
      },
      {
        key: "COMMERCIALLY_ATTRIBUTED",
        label: "Commercially attributed (contracted deliverable)",
        count: attributed.length,
        medianMinutesFromDetection: medianMinutes(attributed, (v) => v.ledger.publishedAt),
      },
    ],
    fulfillment,
    upsell: {
      ideas: active.filter((v) => v.commercialState === "UPSELL_IDEA").length,
      qualified: approved.filter((v) => v.commercialState === "UPSELL_IDEA" && v.rightsState === "ALLOWED").length,
      label: "PROPOSED / NOT SOLD",
    },
    rightsYield: { allowed: eligible.length, evaluated: all.filter((v) => v.ledger.rights).length },
    archiveActivation,
    efficiency: {
      medianTimeToReadyMinutes: medianMinutes(approved, (v) => v.ledger.approvedAt),
      readyCount: approved.length,
      minutesSaved: null,
      note: "Observed detection → approval time only. No manual baseline is recorded, so minutes saved are not claimed.",
    },
    dataQuality,
  };
}
