/**
 * Pure ScorePlay ↔ TwelveLabs identity linking (no I/O). The single implementation of the rule in
 * contracts.ts `MediaMappingMethodSchema`.
 */
import type { MediaRef } from "@/lib/contracts";

export const DURATION_TOLERANCE_SEC = 0.5;

export type ScorePlayCatalogEntry = { scoreplayMediaId: string; filename?: string; durationSec?: number };
export type TwelveLabsCatalogEntry = {
  twelvelabsVideoId: string;
  filename?: string;
  durationSec?: number;
  /** `user_metadata` ScorePlay id claimed by the index. A hint only: trusted solely if it resolves here with the same filename. */
  claimedScoreplayId?: string;
};

export type LinkedCatalogs = {
  /** Evidence-linkable refs (AUTHORITATIVE_ID | FILENAME_DURATION), one per linked pair. */
  refs: MediaRef[];
  /** AMBIGUOUS refs from both sides (ScorePlay-side carry the SP id; TwelveLabs-side have `scoreplayMediaId: null`). */
  ambiguous: MediaRef[];
  /** UNMAPPED refs from both sides. */
  unmapped: MediaRef[];
};

/** Case-insensitive, trimmed, Unicode NFC; the extension is kept. */
export const normalizeFilename = (name: string): string => name.normalize("NFC").trim().toLowerCase();

const key = (name: string | undefined): string | undefined => (name && name.trim() ? normalizeFilename(name) : undefined);

function sameFile(sp: ScorePlayCatalogEntry, tl: TwelveLabsCatalogEntry): boolean {
  const a = key(sp.filename);
  return (
    a !== undefined &&
    a === key(tl.filename) &&
    sp.durationSec !== undefined &&
    tl.durationSec !== undefined &&
    Math.abs(sp.durationSec - tl.durationSec) <= DURATION_TOLERANCE_SEC
  );
}

const match = (sp: ScorePlayCatalogEntry | undefined, tl: TwelveLabsCatalogEntry | undefined): MediaRef["match"] => ({
  scoreplayFilename: sp?.filename,
  twelvelabsFilename: tl?.filename,
  scoreplayDurationSec: sp?.durationSec,
  twelvelabsDurationSec: tl?.durationSec,
  durationDeltaSec:
    sp?.durationSec !== undefined && tl?.durationSec !== undefined ? Math.round(Math.abs(sp.durationSec - tl.durationSec) * 1000) / 1000 : undefined,
});

const spCandidate = (s: ScorePlayCatalogEntry) => ({ scoreplayMediaId: s.scoreplayMediaId, filename: s.filename, durationSec: s.durationSec });
const tlCandidate = (t: TwelveLabsCatalogEntry) => ({ twelvelabsVideoId: t.twelvelabsVideoId, filename: t.filename, durationSec: t.durationSec });

/**
 * Link two catalogs. A pair links only when normalized filename + |Δduration| ≤ 0.5 s match uniquely in BOTH
 * directions. Such a pair is AUTHORITATIVE_ID when the TwelveLabs `claimedScoreplayId` names that same
 * ScorePlay asset (claim corroborated), else FILENAME_DURATION. A claim never creates or redirects a link.
 * Everything else is AMBIGUOUS (with `candidates`) or UNMAPPED. Nothing is guessed.
 */
export function linkCatalogs(
  sps: readonly ScorePlayCatalogEntry[],
  tls: readonly TwelveLabsCatalogEntry[],
  opts: { indexId?: string; now?: Date } = {},
): LinkedCatalogs {
  const checkedAt = (opts.now ?? new Date()).toISOString();
  const base = { twelvelabsIndexId: opts.indexId, checkedAt };
  const out: LinkedCatalogs = { refs: [], ambiguous: [], unmapped: [] };
  const linkedTl = new Set<string>();
  const tlFor = new Map(sps.map((s) => [s.scoreplayMediaId, tls.filter((t) => sameFile(s, t))]));
  const spFor = new Map(tls.map((t) => [t.twelvelabsVideoId, sps.filter((s) => sameFile(s, t))]));

  for (const s of sps) {
    const cands = tlFor.get(s.scoreplayMediaId)!;
    if (cands.length === 0) {
      out.unmapped.push({ ...base, scoreplayMediaId: s.scoreplayMediaId, method: "UNMAPPED", match: match(s, undefined), candidates: [] });
      continue;
    }
    const rivals = spFor.get(cands[0].twelvelabsVideoId)!;
    if (cands.length === 1 && rivals.length === 1) {
      const t = cands[0];
      linkedTl.add(t.twelvelabsVideoId);
      const method = t.claimedScoreplayId === s.scoreplayMediaId ? "AUTHORITATIVE_ID" : "FILENAME_DURATION";
      out.refs.push({ ...base, scoreplayMediaId: s.scoreplayMediaId, twelvelabsVideoId: t.twelvelabsVideoId, method, match: match(s, t), candidates: [] });
      continue;
    }
    const otherSps = [...new Set(cands.flatMap((t) => spFor.get(t.twelvelabsVideoId)!))].filter((o) => o !== s);
    out.ambiguous.push({
      ...base,
      scoreplayMediaId: s.scoreplayMediaId,
      method: "AMBIGUOUS",
      match: match(s, undefined),
      candidates: [...cands.map(tlCandidate), ...otherSps.map(spCandidate)],
    });
  }
  for (const t of tls) {
    if (linkedTl.has(t.twelvelabsVideoId)) continue;
    const cands = spFor.get(t.twelvelabsVideoId)!;
    const ref = { ...base, scoreplayMediaId: null, match: match(undefined, t) };
    if (cands.length === 0) {
      out.unmapped.push({ ...ref, method: "UNMAPPED", candidates: [tlCandidate(t)] });
    } else {
      const otherTls = [...new Set(cands.flatMap((s) => tlFor.get(s.scoreplayMediaId)!))].filter((o) => o !== t);
      out.ambiguous.push({ ...ref, method: "AMBIGUOUS", candidates: [tlCandidate(t), ...cands.map(spCandidate), ...otherTls.map(tlCandidate)] });
    }
  }
  return out;
}
