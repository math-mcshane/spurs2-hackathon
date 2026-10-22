/**
 * pnpm exec tsx --env-file=.env.local scripts/twelvelabs-smoke.ts "dunk"
 * pnpm exec tsx --env-file=.env.local scripts/twelvelabs-smoke.ts --observe <scoreplayMediaId>
 */
import { TwelveLabsVideoIntelligence } from "../src/lib/twelvelabs/client";
import { AppError } from "../src/lib/errors";
import { getMediaResolver } from "../src/lib/media";

async function main() {
  const args = process.argv.slice(2);
  const tl = new TwelveLabsVideoIntelligence();

  const observeAt = args.indexOf("--observe");
  if (observeAt >= 0) {
    const id = args[observeAt + 1];
    if (!id) throw new AppError("BAD_REQUEST", "--observe needs a scoreplayMediaId");
    const ev = await tl.observations(await getMediaResolver().forScoreplay(id));
    console.log(`${ev.length} observation(s) for ${id}:`);
    for (const e of ev) {
      const tc = e.start !== undefined ? `${e.start.toFixed(1)}-${e.end?.toFixed(1)}s` : "video";
      console.log(`  [${e.origin}] ${tc.padEnd(12)} ${e.label ?? ""} conf=${e.confidence ?? "-"} | ${e.observation}`);
    }
    return;
  }

  const { index, origin } = await tl.describeIndex();
  console.log(`Index [${origin}]`, index);
  const { videos } = await tl.listVideos(5);
  for (const v of videos) {
    const full = await tl.getVideo(v.id);
    console.log(`  video ${v.id} asset=${full.assetId ?? "-"} file=${full.filename ?? "-"} user_metadata=${JSON.stringify(full.userMetadata)}`);
  }

  const query = args[0] ?? "dunk";
  const hits = await tl.search(query, { limit: 5 });
  console.log(`Search "${query}": ${hits.length} mapped hit(s)`);
  for (const h of hits) {
    console.log(`  #${h.rank} [${h.origin}] scoreplay=${h.scoreplayMediaId} tl=${h.twelvelabsVideoId} ${h.start}-${h.end}s score=${h.score ?? "-"}`);
  }
}

main().catch((err) => {
  const code = err instanceof AppError ? err.code : "ERROR";
  console.error(`[${code}] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
