import { isEvidenceLinkable, type Asset, type EditPlan, type Evidence, type MediaRef, type VideoIntelligence } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getMediaResolver } from "@/lib/media";
import type { AnalysisStatus } from "@/lib/rights";
import { getScorePlayClient } from "@/lib/scoreplay";
import { getVideoIntelligence } from "@/lib/twelvelabs";
import { recordedObservations } from "@/lib/twelvelabs/recorded-runs";
import { listHumanObservations } from "./store";

export type { AnalysisStatus } from "@/lib/rights";

type VideoUnavailable = { status: "NOT_CONFIGURED"; detail: string };

export interface ContextDeps {
  getAsset(id: string): Promise<Asset>;
  /** Video-intelligence client for the club's index; may throw AppError NOT_CONFIGURED. */
  video(): VideoIntelligence;
  /** ScorePlay → TwelveLabs identity (lib/media); may throw AppError NOT_CONFIGURED. */
  mediaRef(scoreplayMediaId: string): Promise<MediaRef>;
  humanObservations(id: string): Promise<Evidence[]>;
}

/** Live dependencies; `club` picks the club's TwelveLabs index (per-club override, else the shared one). */
export function defaultDeps(club?: string): ContextDeps {
  return {
    getAsset: (id) => getScorePlayClient().getAsset(id),
    video: () => getVideoIntelligence(club),
    mediaRef: (id) => getMediaResolver(club).forScoreplay(id),
    humanObservations: listHumanObservations,
  };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Everything the rights engine needs for a set of assets: ScorePlay metadata, the MediaRef used to link
 * TwelveLabs analysis (recorded for receipts), machine observations and HUMAN observations. Loads lazily and
 * de-duplicates in-flight fetches so the resolver can extend it with candidate assets.
 */
export class DecisionContext {
  readonly assets: Record<string, Asset> = {};
  readonly observations: Record<string, Evidence[]> = {};
  readonly analysis: Record<string, AnalysisStatus> = {};
  /** MediaRef per ScorePlay id (absent when identity resolution itself was unavailable). */
  readonly media: Record<string, MediaRef> = {};
  /** Degradations the user should know about (e.g. HUMAN observations unavailable). */
  readonly notes: string[] = [];
  private readonly pending = new Map<string, Promise<void>>();
  private videoClient: VideoIntelligence | VideoUnavailable | undefined;

  constructor(private readonly deps: ContextDeps = defaultDeps()) {}

  async ensure(mediaIds: Iterable<string>): Promise<void> {
    await Promise.all(
      [...new Set(mediaIds)].map((id) => {
        let p = this.pending.get(id);
        if (!p) {
          p = this.load(id);
          this.pending.set(id, p);
          // Failed loads must not poison the cache.
          p.catch(() => this.pending.delete(id));
        }
        return p;
      }),
    );
  }

  /** Video client or the reason it is unavailable. Resolved once per context. */
  video(): VideoIntelligence | VideoUnavailable {
    if (this.videoClient === undefined) {
      try {
        this.videoClient = this.deps.video();
      } catch (err) {
        if (!(err instanceof AppError && err.code === "NOT_CONFIGURED")) throw err;
        this.videoClient = { status: "NOT_CONFIGURED", detail: err.message };
      }
    }
    return this.videoClient;
  }

  /** MediaRefs of the given assets (for receipts / evaluations), in order, skipping unresolved ones. */
  mediaRefs(ids: Iterable<string>): MediaRef[] {
    return [...new Set(ids)].flatMap((id) => (this.media[id] ? [this.media[id]] : []));
  }

  private async load(id: string): Promise<void> {
    const [asset, human, machine] = await Promise.all([this.deps.getAsset(id), this.humanObservations(id), this.machineObservations(id)]);
    this.assets[id] = asset;
    this.analysis[id] = machine.status;
    this.observations[id] = [...machine.evidence, ...human];
  }

  /** HUMAN observations; an unconfigured store degrades to none (with a note) instead of failing the decision. */
  private async humanObservations(id: string): Promise<Evidence[]> {
    try {
      return await this.deps.humanObservations(id);
    } catch (err) {
      if (!(err instanceof AppError && err.code === "NOT_CONFIGURED")) throw err;
      const note = `Reviewer observations are unavailable (${err.message}); decisions use ScorePlay metadata and video analysis only.`;
      if (!this.notes.includes(note)) this.notes.push(note);
      return [];
    }
  }

  private async machineObservations(id: string): Promise<{ status: AnalysisStatus; evidence: Evidence[] }> {
    const video = this.video();
    if ("status" in video) return { status: video, evidence: [] };
    let ref: MediaRef;
    try {
      ref = await this.deps.mediaRef(id);
    } catch (err) {
      const status = err instanceof AppError && err.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED";
      return { status: { status, detail: `media identity lookup: ${message(err)}` }, evidence: [] };
    }
    this.media[id] = ref;
    if (!isEvidenceLinkable(ref)) {
      const detail =
        ref.method === "AMBIGUOUS"
          ? `${ref.candidates.length} candidate videos match by filename and duration`
          : "it is not in the video-intelligence index — no indexed video matches its filename and duration";
      return { status: { status: "UNLINKABLE", detail }, evidence: [] };
    }
    try {
      const product = await video.observations(ref);
      return { status: { status: "AVAILABLE" }, evidence: withRecordedRuns(product, ref) };
    } catch (err) {
      if (err instanceof AppError && err.code === "NOT_FOUND" && err.message.startsWith("MEDIA_IDENTITY")) {
        return { status: { status: "UNLINKABLE", detail: err.message }, evidence: [] };
      }
      const status = err instanceof AppError && err.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED";
      if (status === "FAILED") console.warn(`[reroute] video analysis unavailable for ${id}: ${message(err)}`);
      return { status: { status, detail: message(err) }, evidence: [] };
    }
  }
}

const sameMoment = (e: Evidence) => `${e.label ?? ""}|${e.start ?? ""}|${e.end ?? ""}`;

/**
 * Product-run evidence plus every recorded run of the same TwelveLabs video (`recorded-runs.ts`): the engine sees
 * both runs (conservative union). A recorded observation identical in label and time range to one already present is
 * dropped. Only called once the product analysis is AVAILABLE — a recorded run never upgrades a missing analysis.
 */
export function withRecordedRuns(product: Evidence[], ref: MediaRef): Evidence[] {
  const seen = new Set(product.map(sameMoment));
  return [...product, ...recordedObservations(ref).filter((e) => !seen.has(sameMoment(e)))];
}

/** Load assets + observations for every distinct asset referenced by `edit`. */
export async function loadDecisionContext(edit: EditPlan, opts: { deps?: ContextDeps; club?: string } = {}): Promise<DecisionContext> {
  const ctx = new DecisionContext(opts.deps ?? defaultDeps(opts.club));
  await ctx.ensure(edit.segments.map((s) => s.scoreplayMediaId));
  return ctx;
}
