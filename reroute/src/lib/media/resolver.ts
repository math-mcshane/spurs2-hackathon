import type { MediaRef, MediaResolver } from "@/lib/contracts";
import { linkCatalogs, type LinkedCatalogs, type ScorePlayCatalogEntry, type TwelveLabsCatalogEntry } from "./link";
import { reportProvenance, trackProvenance, type RunProvenance } from "./provenance";

export const CATALOG_TTL_MS = 10 * 60_000;

export type CatalogSource = {
  indexId: string;
  /** Every ScorePlay video in the workspace (fully paginated); given the TwelveLabs catalog so it can refine likely matches. */
  scoreplay(twelvelabs: readonly TwelveLabsCatalogEntry[]): Promise<ScorePlayCatalogEntry[]>;
  /** Every video in the TwelveLabs index. `fresh` bypasses any loader-side cache. */
  twelvelabs(opts: { fresh: boolean }): Promise<TwelveLabsCatalogEntry[]>;
};

export type MediaCatalog = LinkedCatalogs & {
  indexId: string;
  loadedAt: string;
  scoreplayVideos: number;
  twelvelabsVideos: number;
  bySp: ReadonlyMap<string, MediaRef>;
  byTl: ReadonlyMap<string, MediaRef>;
};

function build(indexId: string, sp: ScorePlayCatalogEntry[], tl: TwelveLabsCatalogEntry[], now: Date): MediaCatalog {
  const linked = linkCatalogs(sp, tl, { indexId, now });
  const all = [...linked.refs, ...linked.ambiguous, ...linked.unmapped];
  const bySp = new Map(all.flatMap((r) => (r.scoreplayMediaId ? [[r.scoreplayMediaId, r] as const] : [])));
  const byTl = new Map<string, MediaRef>();
  for (const r of all) {
    const tlId = r.twelvelabsVideoId ?? (r.scoreplayMediaId === null ? r.candidates[0]?.twelvelabsVideoId : undefined);
    if (tlId) byTl.set(tlId, r);
  }
  return { ...linked, indexId, loadedAt: now.toISOString(), scoreplayVideos: sp.length, twelvelabsVideos: tl.length, bySp, byTl };
}

/**
 * MediaResolver over both catalogs, cached in memory for `CATALOG_TTL_MS`. Unknown ids resolve to UNMAPPED.
 * The origin of the catalog reads (live or demo recording) is re-reported to the run's provenance on every use.
 */
export class CatalogMediaResolver implements MediaResolver {
  private cached?: { at: number; loaded: Promise<{ catalog: MediaCatalog; provenance?: RunProvenance }> };

  constructor(
    private readonly source: CatalogSource,
    private readonly clock: () => number = Date.now,
  ) {}

  get indexId(): string {
    return this.source.indexId;
  }

  catalog(): Promise<MediaCatalog> {
    if (this.cached && this.clock() - this.cached.at < CATALOG_TTL_MS) return this.use(this.cached.loaded);
    return this.load(false);
  }

  /** Reload both catalogs now (bypassing every cache). */
  refresh(): Promise<MediaCatalog> {
    return this.load(true);
  }

  private use(loaded: Promise<{ catalog: MediaCatalog; provenance?: RunProvenance }>): Promise<MediaCatalog> {
    return loaded.then(({ catalog, provenance }) => {
      reportProvenance(provenance);
      return catalog;
    });
  }

  private load(fresh: boolean): Promise<MediaCatalog> {
    const at = this.clock();
    // TwelveLabs first: the ScorePlay loader uses its filenames to decide which assets need exact durations.
    const loaded = trackProvenance(() =>
      this.source.twelvelabs({ fresh }).then(async (tl) => build(this.source.indexId, await this.source.scoreplay(tl), tl, new Date(at))),
    ).then(({ value, provenance }) => ({ catalog: value, provenance }));
    const entry = { at, loaded };
    this.cached = entry;
    loaded.catch(() => {
      if (this.cached === entry) this.cached = undefined;
    });
    return this.use(loaded);
  }

  async forScoreplay(scoreplayMediaId: string): Promise<MediaRef> {
    const c = await this.catalog();
    return (
      c.bySp.get(scoreplayMediaId) ?? { scoreplayMediaId, twelvelabsIndexId: c.indexId, method: "UNMAPPED", candidates: [], checkedAt: c.loadedAt }
    );
  }

  async forTwelveLabs(twelvelabsVideoId: string): Promise<MediaRef> {
    const c = await this.catalog();
    return (
      c.byTl.get(twelvelabsVideoId) ?? {
        scoreplayMediaId: null,
        twelvelabsIndexId: c.indexId,
        method: "UNMAPPED",
        candidates: [{ twelvelabsVideoId }],
        checkedAt: c.loadedAt,
      }
    );
  }
}
