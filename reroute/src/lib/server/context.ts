import type { Asset, EditPlan, Evidence, VideoIntelligence } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getScorePlayClient } from "@/lib/scoreplay";
import { getVideoIntelligence } from "@/lib/twelvelabs";
import { listHumanObservations } from "./store";

/**
 * Whether machine video analysis exists for an asset. Anything but AVAILABLE means on-screen
 * sponsor/people facts are unconfirmed, so the asset can never be ALLOWED (see decide.ts).
 */
export type AnalysisStatus =
  | { status: "AVAILABLE" }
  | { status: "NOT_CONFIGURED" | "FAILED"; detail: string };

type VideoUnavailable = { status: "NOT_CONFIGURED"; detail: string };

export interface ContextDeps {
  getAsset(id: string): Promise<Asset>;
  /** Resolve the video-intelligence client; may throw AppError NOT_CONFIGURED. */
  video(): VideoIntelligence;
  humanObservations(id: string): Promise<Evidence[]>;
}

export function defaultDeps(): ContextDeps {
  return {
    getAsset: (id) => getScorePlayClient().getAsset(id),
    video: getVideoIntelligence,
    humanObservations: listHumanObservations,
  };
}

/**
 * Everything the rights engine needs for a set of assets: ScorePlay metadata plus observations
 * (TwelveLabs merged with HUMAN). Loads lazily and de-duplicates in-flight fetches so the resolver
 * can extend it with candidate assets.
 */
export class DecisionContext {
  readonly assets: Record<string, Asset> = {};
  readonly observations: Record<string, Evidence[]> = {};
  readonly analysis: Record<string, AnalysisStatus> = {};
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

  private async load(id: string): Promise<void> {
    const [asset, human, machine] = await Promise.all([
      this.deps.getAsset(id),
      this.deps.humanObservations(id),
      this.machineObservations(id),
    ]);
    this.assets[id] = asset;
    this.analysis[id] = machine.status;
    this.observations[id] = [...machine.evidence, ...human];
  }

  private async machineObservations(id: string): Promise<{ status: AnalysisStatus; evidence: Evidence[] }> {
    const video = this.video();
    if ("status" in video) return { status: video, evidence: [] };
    try {
      return { status: { status: "AVAILABLE" }, evidence: await video.observations(id) };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const status = err instanceof AppError && err.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED";
      if (status === "FAILED") console.warn(`[reroute] video analysis unavailable for ${id}: ${detail}`);
      return { status: { status, detail }, evidence: [] };
    }
  }
}

/** Load assets + observations for every distinct asset referenced by `edit`. */
export async function loadDecisionContext(edit: EditPlan, deps?: ContextDeps): Promise<DecisionContext> {
  const ctx = new DecisionContext(deps);
  await ctx.ensure(edit.segments.map((s) => s.scoreplayMediaId));
  return ctx;
}
