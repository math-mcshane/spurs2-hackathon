/**
 * Recorded TwelveLabs analysis runs served as real, provenance-tagged evidence next to the product run.
 *
 * `pegasus:audit-2026-10-23`: a second, independent Pegasus 1.6 analysis (product prompt + JSON schema) of the
 * premiere-league index, recorded during the 2026-10-23 media audit and extracted from the audit catalog by
 * `scripts/build-recorded-runs.ts`. Pegasus runs vary (e.g. a crest seen 9–11 s in one run, 9–14.5 s in the other),
 * so the rights engine gets both runs — the conservative union. Evidence is served only when the asset's MediaRef
 * links to the exact TwelveLabs video (and index) the observations were recorded on.
 *
 * Server-side only by convention (bundles the recorded data); UI labels live in `./runs`.
 */
import { isEvidenceLinkable, type Evidence, type MediaRef } from "@/lib/contracts";
import { LABEL_PREFIX, slugify } from "./parse";
import audit from "./recorded/pegasus-audit-2026-10-23.json";
import { AUDIT_RUN } from "./runs";

export { analysisRunLabel, AUDIT_RUN, PRODUCT_RUN } from "./runs";

type Kind = "brand" | "person" | "graphic" | "broadcaster";
type RecordedObservation = { kind: string; entity: string; start: number; end: number; confidence: number; description: string };
type RecordedVideo = { twelvelabsVideoId: string; twelvelabsIndexId: string; filename: string; observations: RecordedObservation[] };

/** Catalog kind → the Pegasus category whose label prefix `parse.ts` uses, so both runs share one label space. */
const CATEGORY: Record<Kind, keyof typeof LABEL_PREFIX> = {
  brand: "sponsor_brand",
  person: "person",
  graphic: "onscreen_graphic",
  broadcaster: "broadcaster",
};

const videos: Record<string, RecordedVideo> = audit.videos;

/** Provenance of the recorded run (shown in receipts / evidence panels). */
export const RECORDED_RUN = {
  id: AUDIT_RUN,
  model: audit.run.model,
  recordedAt: audit.run.recordedAt,
  window: audit.run.window,
  index: audit.run.index,
  source: audit.run.source,
  note: audit.run.note,
  videos: Object.keys(videos).length,
} as const;

/**
 * Recorded-run observations for a linkable ref, or [] when the ref is not evidence-linkable, nothing was recorded for
 * its ScorePlay id, or it resolves to a different TwelveLabs video/index than the recording (identity check).
 */
export function recordedObservations(ref: MediaRef): Evidence[] {
  if (!isEvidenceLinkable(ref) || !ref.scoreplayMediaId) return [];
  const video = videos[ref.scoreplayMediaId];
  if (!video || video.twelvelabsVideoId !== ref.twelvelabsVideoId) return [];
  if (ref.twelvelabsIndexId && ref.twelvelabsIndexId !== video.twelvelabsIndexId) return [];
  const scoreplayMediaId = ref.scoreplayMediaId;
  return video.observations.flatMap((o): Evidence[] => {
    const category = CATEGORY[o.kind as Kind];
    const slug = slugify(o.entity);
    if (!category || !slug) return [];
    return [
      {
        scoreplayMediaId,
        start: o.start,
        end: o.end,
        observation: `${o.entity}: ${o.description}`,
        source: "TWELVELABS",
        label: `${LABEL_PREFIX[category]}:${slug}`,
        confidence: o.confidence,
        origin: "CACHED",
        analysisRun: AUDIT_RUN,
      },
    ];
  });
}
