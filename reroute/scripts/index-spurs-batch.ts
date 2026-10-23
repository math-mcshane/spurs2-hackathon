/**
 * Self-index a small, hand-picked batch of San Antonio Spurs ScorePlay videos into a SEPARATE Marengo 3.0 index.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/index-spurs-batch.ts                 # plan only: reads, never writes
 *   pnpm exec tsx --env-file=.env.local scripts/index-spurs-batch.ts --ids 1,2,3     # plan for other ScorePlay ids
 *   SPURS_MEDIA_TRANSFER_AUTHORIZATION="<who approved, when, where>" \
 *     pnpm exec tsx --env-file=.env.local scripts/index-spurs-batch.ts --execute     # transfer + index + verify
 *
 * Account: `PULSE_TWELVELABS_API_KEY_SPURS` (required — never falls back to the shared/Tottenham key).
 * Index: `PULSE_TWELVELABS_INDEX_ID_SPURS` when set, else the account's index named `pulse-nba-spurs`, else one is
 * created (Marengo 3.0, visual + audio) on `--execute`. The Tottenham index (`TWELVELABS_INDEX_ID`,
 * `PULSE_TWELVELABS_INDEX_ID_TOTTENHAM`) is refused as a target; nothing is ever updated or deleted.
 *
 * Transfer: TwelveLabs imports ScorePlay's own `video.proxy_large` rendition by URL (no download relay, nothing is
 * re-hosted or made public by us). The URL is never printed. Each asset carries `user_metadata.scoreplay_id` and the
 * authorization reference; identity is still lib/media's filename + duration match, verified at the end.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { TwelveLabs } from "twelvelabs-js";
import { CLUBS } from "../src/features/pulse/clubs";
import { defaultScorePlayHttp, getMedia, namesTerm } from "../src/features/pulse/server/scoreplay-discovery";
import { getMediaResolver, normalizeFilename, DURATION_TOLERANCE_SEC } from "../src/lib/media";
import { clubIndexVariable, clubKeyVariable } from "../src/lib/twelvelabs/config";

const CLUB = "spurs";
const INDEX_NAME = "pulse-nba-spurs";
/** Hand-picked from live ScorePlay tags: Wembanyama dunk / alley-oop edits, the Sprite- and Frost Bank-tagged clips. */
const DEFAULT_IDS = ["130907679", "130907602", "130907603", "130907419", "130929725"];
const MAX_BATCH = 5;
const MAX_DURATION_SEC = 60;
const POLL_MS = 5_000;
const ASSET_TIMEOUT_MS = 10 * 60_000;
const INDEX_TIMEOUT_MS = 20 * 60_000;

const VideoShape = z.object({ video: z.object({ proxy_large: z.string().nullish() }).loose().nullish() }).loose();

type Planned = { id: string; filename: string; durationSec: number; bytes?: number; url: string; people: string[]; sponsors: string[] };

const fail = (msg: string): never => {
  console.error(`[REFUSED] ${msg}`);
  process.exit(1);
};

function args() {
  const a = process.argv.slice(2);
  const at = a.indexOf("--ids");
  const ids = at >= 0 ? (a[at + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_IDS;
  return { execute: a.includes("--execute"), ids };
}

async function plan(ids: string[]): Promise<Planned[]> {
  if (ids.length === 0 || ids.length > MAX_BATCH) fail(`batch must be 1–${MAX_BATCH} ScorePlay ids (got ${ids.length})`);
  if (ids.some((id) => !/^\d+$/.test(id))) fail("ScorePlay ids are integers");
  const http = defaultScorePlayHttp();
  const out: Planned[] = [];
  for (const id of ids) {
    const m = await getMedia(http, id);
    const tags = (m.tags ?? []).filter((t) => !t.hidden);
    const teams = tags.flatMap((t) => (t.tag_option?.name ? [t.tag_option.name] : []));
    if (m.type !== "video") fail(`${id} is not a video`);
    if (!teams.some((n) => CLUBS[CLUB].library.teamTerms.some((term) => namesTerm(n, term)))) fail(`${id} is not tagged ${CLUBS[CLUB].library.teamTerms.join("/")} in ScorePlay`);
    const durationSec = (m.media_duration ?? 0) / 1e9;
    if (!(durationSec > 0 && durationSec <= MAX_DURATION_SEC)) fail(`${id} duration ${durationSec}s is outside 0–${MAX_DURATION_SEC}s`);
    if (!m.name) fail(`${id} has no filename`);
    const url = VideoShape.parse(m).video?.proxy_large;
    if (!url || new URL(url).protocol !== "https:") fail(`${id} has no https proxy_large rendition`);
    const head = await fetch(url!, { method: "HEAD" });
    out.push({
      id,
      filename: m.name!,
      durationSec,
      bytes: Number(head.headers.get("content-length")) || undefined,
      url: url!,
      people: tags.flatMap((t) => (t.player?.full_name ? [t.player.full_name] : [])),
      sponsors: tags.flatMap((t) => (t.sponsor?.label ?? t.sponsor?.name ? [(t.sponsor.label ?? t.sponsor.name)!] : [])),
    });
  }
  return out;
}

async function findOrCreateIndex(tl: TwelveLabs, execute: boolean): Promise<string | undefined> {
  const tottenham = new Set([process.env.TWELVELABS_INDEX_ID?.trim(), process.env[clubIndexVariable("tottenham")]?.trim()].filter(Boolean));
  let indexId = process.env[clubIndexVariable(CLUB)]?.trim();
  if (!indexId) {
    const all = [];
    for await (const idx of await tl.indexes.list({ pageLimit: 50 })) all.push(idx);
    console.log(`Account indexes: ${all.map((i) => `"${i.indexName}" (${i.videoCount ?? 0})`).join(", ") || "none"}`);
    indexId = all.find((i) => i.indexName === INDEX_NAME)?.id;
  }
  if (indexId) {
    if (tottenham.has(indexId)) fail(`${indexId} is the Tottenham index; the NBA batch needs its own index`);
    const idx = await tl.indexes.retrieve(indexId);
    if (!(idx.models ?? []).some((m) => m.modelName === "marengo3.0")) fail(`${indexId} has no marengo3.0 model`);
    console.log(`Using index ${indexId} "${idx.indexName}", ${idx.videoCount ?? 0} video(s)`);
    return indexId;
  }
  if (!execute) {
    console.log(`Would create index "${INDEX_NAME}" (marengo3.0: visual, audio; thumbnail add-on)`);
    return undefined;
  }
  const created = await tl.indexes.create({ indexName: INDEX_NAME, models: [{ modelName: "marengo3.0", modelOptions: ["visual", "audio"] }], addons: ["thumbnail"] });
  if (!created.id) fail("index creation returned no id");
  console.log(`Created index ${created.id} "${INDEX_NAME}"`);
  return created.id;
}

async function poll<T>(label: string, timeoutMs: number, read: () => Promise<T>, status: (t: T) => string | undefined, done: string): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    const t = await read();
    const s = status(t) ?? "unknown";
    if (s !== last) console.log(`  ${label}: ${s}`);
    last = s;
    if (s === done) return t;
    if (s === "failed") fail(`${label} failed`);
    if (Date.now() > until) fail(`${label} still ${s} after ${timeoutMs / 60_000} min`);
    await sleep(POLL_MS);
  }
}

async function main() {
  const { execute, ids } = args();
  const keyVar = clubKeyVariable(CLUB);
  const apiKey = process.env[keyVar]?.trim();
  if (!apiKey) fail(`${keyVar} is not set (the NBA index must live under an explicitly chosen TwelveLabs account)`);
  const authorization = process.env.SPURS_MEDIA_TRANSFER_AUTHORIZATION?.trim();
  if (execute && !authorization) fail("--execute needs SPURS_MEDIA_TRANSFER_AUTHORIZATION (who approved transferring these ScorePlay assets to TwelveLabs, when, where)");

  const batch = await plan(ids);
  const totalSec = batch.reduce((s, b) => s + b.durationSec, 0);
  const totalMb = batch.reduce((s, b) => s + (b.bytes ?? 0), 0) / 1e6;
  console.log(`${execute ? "EXECUTE" : "PLAN ONLY (no writes)"} — ${batch.length} video(s), ${totalSec.toFixed(1)} s, ${totalMb.toFixed(1)} MB (proxy_large)`);
  for (const b of batch) console.log(`  ${b.id}  ${b.durationSec.toFixed(2).padStart(6)} s  ${((b.bytes ?? 0) / 1e6).toFixed(1).padStart(5)} MB  ${b.filename}  people=[${b.people.join(", ")}] sponsors=[${b.sponsors.join(", ")}]`);

  const tl = new TwelveLabs({ apiKey: apiKey! });
  const indexId = await findOrCreateIndex(tl, execute);
  if (!execute || !indexId) return;

  const indexed = [];
  for await (const a of await tl.indexes.indexedAssets.list(indexId, { pageLimit: 50 })) indexed.push(a);
  for (const b of batch) {
    const dup = indexed.find((a) => a.systemMetadata?.filename && normalizeFilename(a.systemMetadata.filename) === normalizeFilename(b.filename) && Math.abs((a.systemMetadata.duration ?? -99) - b.durationSec) <= DURATION_TOLERANCE_SEC);
    if (dup) {
      console.log(`${b.id} already indexed as ${dup.id} (${dup.status}) — skipped`);
      continue;
    }
    console.log(`${b.id} ${b.filename}`);
    const meta = { scoreplay_id: b.id, scoreplay_rendition: "video_large", scoreplay_type: "video", club: CLUB, transfer_authorization: authorization!.slice(0, 200) };
    const asset = await tl.assets.create({ method: "url", url: b.url, filename: b.filename, userMetadata: JSON.stringify(meta) });
    if (!asset.id) fail(`asset creation for ${b.id} returned no id`);
    await poll(`asset ${asset.id}`, ASSET_TIMEOUT_MS, () => tl.assets.retrieve(asset.id!), (a) => a.status, "ready");
    const ia = await tl.indexes.indexedAssets.create(indexId, { assetId: asset.id!, enableVideoStream: true, userMetadata: meta });
    if (!ia.id) fail(`indexing ${b.id} returned no id`);
    await poll(`indexed asset ${ia.id}`, INDEX_TIMEOUT_MS, () => tl.indexes.indexedAssets.retrieve(indexId, ia.id!), (a) => a.status, "ready");
  }

  // Identity check through the product's own resolver, exactly as PULSE will use it.
  process.env[clubIndexVariable(CLUB)] = indexId;
  const resolver = getMediaResolver(CLUB);
  await resolver.refresh();
  let linked = 0;
  for (const b of batch) {
    const ref = await resolver.forScoreplay(b.id);
    if (ref.twelvelabsVideoId && ref.method === "FILENAME_DURATION") linked++;
    console.log(`  ${b.id} → ${ref.twelvelabsVideoId ?? "-"} (${ref.method})`);
  }
  console.log(`${linked}/${batch.length} linked. Add to the PULSE env (server-only):\n  ${clubIndexVariable(CLUB)}=${indexId}`);
  if (linked !== batch.length) process.exit(2);
}

main().catch((err) => {
  console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
