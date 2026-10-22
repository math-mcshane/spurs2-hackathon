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
 * Link two catalogs:
 *  1. AUTHORITATIVE_ID — a TwelveLabs `claimedScoreplayId` that exists in THIS ScorePlay catalog, with the same
 *     normalized filename, claimed by exactly one TwelveLabs video;
 *  2. FILENAME_DURATION — normalized filename equality + |Δduration| ≤ 0.5 s, unique in BOTH directions;
 *  3. otherwise AMBIGUOUS (with `candidates`) or UNMAPPED. Nothing is guessed.
 */
export function linkCatalogs(
  scoreplay: readonly ScorePlayCatalogEntry[],
  twelvelabs: readonly TwelveLabsCatalogEntry[],
  opts: { indexId?: string; now?: Date } = {},
): LinkedCatalogs {
  const checkedAt = (opts.now ?? new Date()).toISOString();
  const base = { twelvelabsIndexId: opts.indexId, checkedAt };
  const out: LinkedCatalogs = { refs: [], ambiguous: [], unmapped: [] };
  const linkedSp = new Set<string>();
  const linkedTl = new Set<string>();
  const spById = new Map(scoreplay.map((s) => [s.scoreplayMediaId, s]));

  // 1. Authoritative ids, verified against this workspace.
  const claims = new Map<string, TwelveLabsCatalogEntry[]>();
  for (const t of twelvelabs) {
    if (t.claimedScoreplayId && spById.has(t.claimedScoreplayId)) claims.set(t.claimedScoreplayId, [...(claims.get(t.claimedScoreplayId) ?? []), t]);
  }
  for (const [spId, tls] of claims) {
    const sp = spById.get(spId)!;
    const t = tls[0];
    if (tls.length !== 1 || key(sp.filename) === undefined || key(sp.filename) !== key(t.filename)) continue;
    linkedSp.add(spId);
    linkedTl.add(t.twelvelabsVideoId);
    out.refs.push({ ...base, scoreplayMediaId: spId, twelvelabsVideoId: t.twelvelabsVideoId, method: "AUTHORITATIVE_ID", match: match(sp, t), candidates: [] });
  }

  // 2. Filename + duration among the rest, unique both ways.
  const sps = scoreplay.filter((s) => !linkedSp.has(s.scoreplayMediaId));
  const tls = twelvelabs.filter((t) => !linkedTl.has(t.twelvelabsVideoId));
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
      linkedTl.add(cands[0].twelvelabsVideoId);
      out.refs.push({ ...base, scoreplayMediaId: s.scoreplayMediaId, twelvelabsVideoId: cands[0].twelvelabsVideoId, method: "FILENAME_DURATION", match: match(s, cands[0]), candidates: [] });
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
