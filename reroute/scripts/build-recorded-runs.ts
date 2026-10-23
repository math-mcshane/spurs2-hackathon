/**
 * Extracts the second, independent TwelveLabs Pegasus run (media audit, 2026-10-23) from the audit catalog into
 * `src/lib/twelvelabs/recorded/pegasus-audit-2026-10-23.json`, the recorded evidence `recorded-runs.ts` serves.
 *
 *   pnpm exec tsx scripts/build-recorded-runs.ts
 *
 * Offline: reads only `../docs/demo/media-intelligence-catalog.json` (schema pulse.media-intelligence-catalog/v1).
 * Keeps ONLY observations whose `run` is `audit-2026-10-23` (the product-stored run is already served by the
 * product's own observation cache), de-duplicated per video across moments, keyed by ScorePlay media id together
 * with the TwelveLabs video + index ids the observation was made on. Copies catalog fields verbatim — nothing is
 * inferred or synthesized (the catalog carries no rubric answers or summaries for this run, so none are written).
 * Refuses to write if the output contains a URL- or token-like string.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const ROOT = path.resolve(__dirname, "..");
const CATALOG = path.resolve(ROOT, "../docs/demo/media-intelligence-catalog.json");
const OUT = path.resolve(ROOT, "src/lib/twelvelabs/recorded/pegasus-audit-2026-10-23.json");
const CATALOG_RUN = "audit-2026-10-23";

const Observation = z.object({
  kind: z.enum(["brand", "person", "graphic", "broadcaster"]),
  entity: z.string().min(1),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  description: z.string().min(1),
  run: z.string(),
});
const Catalog = z.object({
  schema: z.literal("pulse.media-intelligence-catalog/v1"),
  summary: z.object({ generatedAt: z.string() }),
  moments: z.array(
    z.object({
      asset: z.object({
        scoreplayMediaId: z.string().min(1),
        /** null for videos not in any TwelveLabs index (NBA); those carry no Pegasus observations. */
        twelvelabsVideoId: z.string().min(1).nullable(),
        twelvelabsIndexId: z.string().min(1).nullable(),
        filename: z.string(),
      }),
      observations: z.array(Observation),
    }),
  ),
});

type Obs = Omit<z.infer<typeof Observation>, "run">;
type Video = { twelvelabsVideoId: string; twelvelabsIndexId: string; filename: string; observations: Obs[] };

const catalog = Catalog.parse(JSON.parse(readFileSync(CATALOG, "utf8")));
const videos = new Map<string, Video & { seen: Set<string> }>();

for (const m of catalog.moments) {
  const { scoreplayMediaId: id, twelvelabsVideoId, twelvelabsIndexId, filename } = m.asset;
  const audit = m.observations.filter((o) => o.run === CATALOG_RUN);
  if (!audit.length) continue;
  if (!twelvelabsVideoId || !twelvelabsIndexId) throw new Error(`ScorePlay ${id} has Pegasus observations but no TwelveLabs video`);
  let v = videos.get(id);
  if (!v) videos.set(id, (v = { twelvelabsVideoId, twelvelabsIndexId, filename, observations: [], seen: new Set() }));
  if (v.twelvelabsVideoId !== twelvelabsVideoId || v.twelvelabsIndexId !== twelvelabsIndexId) {
    throw new Error(`ScorePlay ${id} maps to two TwelveLabs videos in the catalog; refusing to guess`);
  }
  for (const { kind, entity, start, end, confidence, description } of audit) {
    if (end < start) throw new Error(`ScorePlay ${id}: observation "${entity}" ends before it starts`);
    const o: Obs = { kind, entity, start, end, confidence, description };
    const key = JSON.stringify(o);
    if (v.seen.has(key)) continue;
    v.seen.add(key);
    v.observations.push(o);
  }
}

const byObs = (a: Obs, b: Obs) =>
  a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind) || a.entity.localeCompare(b.entity) || a.description.localeCompare(b.description);

const ids = [...videos.keys()].sort();
const out = {
  run: {
    id: "pegasus:audit-2026-10-23",
    model: "pegasus1.6",
    recordedAt: "2026-10-23T03:11:15Z",
    window: "2026-10-23 03:05–03:11 UTC",
    index: { id: [...new Set(ids.map((id) => videos.get(id)!.twelvelabsIndexId))].join(","), name: "premiere-league" },
    source: `docs/demo/media-intelligence-catalog.json (${catalog.schema}, generated ${catalog.summary.generatedAt})`,
    note:
      "Second, independent TwelveLabs Pegasus analysis of the same indexed videos with the product's prompt and JSON schema, " +
      "recorded during the media audit. AI observations — evidence, not facts; none human-verified. Served alongside the " +
      "product run so the rights engine sees both (conservative union).",
  },
  videos: Object.fromEntries(
    ids.map((id) => {
      const { seen: _seen, ...v } = videos.get(id)!;
      return [id, { ...v, observations: [...v.observations].sort(byObs) }];
    }),
  ),
};

const text = `${JSON.stringify(out, null, 2)}\n`;
const forbidden = /https?:|www\.|token|bearer|api[_-]?key|secret|thumbnail|\.m3u8|signature=/i;
const hit = text.match(forbidden);
if (hit) throw new Error(`refusing to write: output contains a URL/token-like string (${hit[0]})`);

writeFileSync(OUT, text);
const total = ids.reduce((n, id) => n + out.videos[id].observations.length, 0);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${ids.length} videos, ${total} observations (run ${out.run.id})`);
