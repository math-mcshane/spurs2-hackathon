import { describe, expect, it, vi } from "vitest";
import { isEvidenceLinkable } from "@/lib/contracts";
import { linkCatalogs, type ScorePlayCatalogEntry, type TwelveLabsCatalogEntry } from "./link";
import { CATALOG_TTL_MS, CatalogMediaResolver } from "./resolver";

const sp = (scoreplayMediaId: string, filename: string, durationSec: number): ScorePlayCatalogEntry => ({ scoreplayMediaId, filename, durationSec });
const tl = (twelvelabsVideoId: string, filename: string, durationSec: number, claimedScoreplayId?: string): TwelveLabsCatalogEntry => ({
  twelvelabsVideoId,
  filename,
  durationSec,
  claimedScoreplayId,
});
const NOW = new Date("2026-10-22T12:00:00Z");

describe("linkCatalogs", () => {
  it("links one ScorePlay video to one TwelveLabs video by normalized filename + duration", () => {
    const { refs, ambiguous, unmapped } = linkCatalogs(
      [sp("130851361", "Manchester United vs Spurs | Full Match | 2026-27.mp4", 6334.96)],
      [tl("6ad911e9500e82756f2eb4eb", "  manchester united vs spurs | full match | 2026-27.MP4 ", 6334.997, "130850832")],
      { indexId: "idx", now: NOW },
    );
    expect(ambiguous).toEqual([]);
    expect(unmapped).toEqual([]);
    expect(refs).toEqual([
      {
        scoreplayMediaId: "130851361",
        twelvelabsVideoId: "6ad911e9500e82756f2eb4eb",
        twelvelabsIndexId: "idx",
        method: "FILENAME_DURATION",
        match: expect.objectContaining({ durationDeltaSec: 0.037 }),
        candidates: [],
        checkedAt: NOW.toISOString(),
      },
    ]);
    expect(isEvidenceLinkable(refs[0])).toBe(true);
  });

  it("compares filenames in Unicode NFC and keeps the extension", () => {
    const decomposed = "Sa\u0301vio cele.mp4"; // "Sávio" with a combining accent
    const { refs, unmapped } = linkCatalogs([sp("1", "Sávio cele.mp4", 13.44), sp("2", "clip.mov", 5)], [tl("a", decomposed, 13.44), tl("b", "clip.mp4", 5)]);
    expect(refs.map((r) => [r.scoreplayMediaId, r.twelvelabsVideoId])).toEqual([["1", "a"]]);
    expect(unmapped.map((r) => r.scoreplayMediaId ?? r.candidates[0].twelvelabsVideoId)).toEqual(["2", "b"]);
  });

  it("marks a duplicate filename AMBIGUOUS in both directions, with candidates", () => {
    // Two TwelveLabs videos for one ScorePlay file…
    const many = linkCatalogs([sp("1", "dup.mp4", 10)], [tl("a", "dup.mp4", 10), tl("b", "dup.mp4", 10.2)]);
    expect(many.refs).toEqual([]);
    expect(many.ambiguous.find((r) => r.scoreplayMediaId === "1")).toMatchObject({
      method: "AMBIGUOUS",
      candidates: [{ twelvelabsVideoId: "a" }, { twelvelabsVideoId: "b" }],
    });
    expect(many.ambiguous.filter((r) => r.scoreplayMediaId === null)).toHaveLength(2);

    // …and two ScorePlay videos for one TwelveLabs file.
    const reverse = linkCatalogs([sp("1", "dup.mp4", 10), sp("2", "dup.mp4", 10)], [tl("a", "dup.mp4", 10)]);
    expect(reverse.refs).toEqual([]);
    expect(reverse.ambiguous.map((r) => r.scoreplayMediaId)).toEqual(["1", "2", null]);
    expect(reverse.ambiguous[0].candidates).toEqual([expect.objectContaining({ twelvelabsVideoId: "a" }), expect.objectContaining({ scoreplayMediaId: "2" })]);
    expect(reverse.ambiguous.every((r) => !isEvidenceLinkable(r))).toBe(true);
  });

  it("leaves a duration mismatch (> 0.5 s) UNMAPPED", () => {
    const { refs, unmapped } = linkCatalogs([sp("1", "a.mp4", 30)], [tl("a", "a.mp4", 30.6)]);
    expect(refs).toEqual([]);
    expect(unmapped.map((r) => r.method)).toEqual(["UNMAPPED", "UNMAPPED"]);
    expect(unmapped[0]).toMatchObject({ scoreplayMediaId: "1" });
    expect(unmapped[0]).not.toHaveProperty("twelvelabsVideoId");
  });

  it("ignores a user_metadata id from another workspace; trusts one that resolves here with the same filename", () => {
    // Foreign id (cloned workspace): not an identity — the filename+duration rule decides.
    const foreign = linkCatalogs([sp("130851361", "full.mp4", 100)], [tl("v", "full.mp4", 100, "130850832")]);
    expect(foreign.refs[0]).toMatchObject({ scoreplayMediaId: "130851361", method: "FILENAME_DURATION" });

    // An id that exists here but names a different file is not trusted either.
    const wrongFile = linkCatalogs([sp("1", "a.mp4", 10), sp("2", "b.mp4", 20)], [tl("v", "b.mp4", 20, "1")]);
    expect(wrongFile.refs).toEqual([expect.objectContaining({ scoreplayMediaId: "2", twelvelabsVideoId: "v", method: "FILENAME_DURATION" })]);

    // A resolving id with the same filename is authoritative, even if a sibling file shares name+duration.
    const ok = linkCatalogs([sp("1", "a.mp4", 10), sp("2", "a.mp4", 10)], [tl("v", "a.mp4", 10, "1")]);
    expect(ok.refs).toEqual([expect.objectContaining({ scoreplayMediaId: "1", twelvelabsVideoId: "v", method: "AUTHORITATIVE_ID" })]);
    expect(ok.unmapped.map((r) => r.scoreplayMediaId)).toEqual(["2"]);
  });
});

describe("CatalogMediaResolver", () => {
  const source = () => ({
    indexId: "idx",
    scoreplay: vi.fn(async () => [sp("1", "a.mp4", 10), sp("2", "dup.mp4", 5), sp("3", "dup.mp4", 5)]),
    twelvelabs: vi.fn(async () => [tl("a", "a.mp4", 10), tl("d", "dup.mp4", 5), tl("x", "x.mp4", 1)]),
  });

  it("resolves both directions; unknown ids are UNMAPPED, never guessed", async () => {
    const r = new CatalogMediaResolver(source());
    expect(await r.forScoreplay("1")).toMatchObject({ method: "FILENAME_DURATION", twelvelabsVideoId: "a" });
    expect(await r.forTwelveLabs("a")).toMatchObject({ method: "FILENAME_DURATION", scoreplayMediaId: "1" });
    expect(await r.forScoreplay("2")).toMatchObject({ method: "AMBIGUOUS" });
    expect(await r.forTwelveLabs("d")).toMatchObject({ method: "AMBIGUOUS", scoreplayMediaId: null });
    expect(await r.forTwelveLabs("x")).toMatchObject({ method: "UNMAPPED", scoreplayMediaId: null });
    const unknown = await r.forScoreplay("999");
    expect(unknown).toMatchObject({ method: "UNMAPPED", scoreplayMediaId: "999" });
    expect(unknown).not.toHaveProperty("twelvelabsVideoId");
  });

  it("caches both catalogs for the TTL and reloads on refresh()", async () => {
    let now = 0;
    const s = source();
    const r = new CatalogMediaResolver(s, () => now);
    await r.forScoreplay("1");
    await r.forTwelveLabs("a");
    expect(s.scoreplay).toHaveBeenCalledTimes(1);
    now = CATALOG_TTL_MS + 1;
    await r.forScoreplay("1");
    expect(s.scoreplay).toHaveBeenCalledTimes(2);
    await r.refresh();
    expect(s.twelvelabs).toHaveBeenLastCalledWith({ fresh: true });
    expect(s.scoreplay).toHaveBeenCalledTimes(3);
  });
});
