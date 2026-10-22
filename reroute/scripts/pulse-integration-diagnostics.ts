/**
 * Read-only live diagnostics for PULSE's ScorePlay + TwelveLabs integration and the goal flow's
 * REROUTE verdicts. Never prints secrets, never downloads or copies media, writes no PULSE/REROUTE
 * state; prints ids, counts, filenames, timecodes and verdicts only.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/pulse-integration-diagnostics.ts
 */
import { z } from "zod";
import { MediaSearchResultSchema, WhoamiSchema } from "../src/lib/scoreplay/schemas";
import { ScorePlayHttpClient } from "../src/lib/scoreplay/client";
import { SIGNAL_FIXTURE, SPONSOR_BRIEFS, fixtureSignals } from "../src/features/pulse/signal-adapter";
import { detectOpportunities } from "../src/features/pulse/detect-opportunities";
import { lookupMedia, linkToIndex } from "../src/features/pulse/server/media-lookup";
import { defaultScorePlayHttp, discoverVideos, resolveTags, searchMediaPages } from "../src/features/pulse/server/scoreplay-discovery";
import { createTwelveLabsSdk, loadCatalog, readTwelveLabsConfig, searchMoments } from "../src/features/pulse/server/twelvelabs-moments";
import { searchGoal } from "../src/features/pulse/server/goal-search";
import { parseObjective } from "../src/features/pulse/objective-parser";
import { parseMatch } from "../src/features/pulse/goal-intents";
import { rerouteRequestFor } from "../src/features/pulse/goal-campaign";
import { clock } from "../src/features/pulse/moment-ranking";
import { decideEdit } from "../src/lib/server/decide";

/** `GET /v1.3/indexes` response, as documented. */
const IndexListSchema = z.object({
  data: z
    .array(
      z.object({
        _id: z.string(),
        index_name: z.string(),
        video_count: z.number(),
        models: z.array(z.object({ model_name: z.string(), model_options: z.array(z.string()).optional() })).optional(),
      }),
    )
    .default([]),
});

const line = (s = "") => console.log(s);
const section = (s: string) => line(`\n== ${s} ==`);
const errText = (e: unknown) => {
  if (!(e instanceof Error)) return String(e);
  return "code" in e ? `[${String(e.code)}] ${e.message}` : e.message;
};

async function scoreplay() {
  section("ScorePlay");
  const http = defaultScorePlayHttp();
  line(`SCOREPLAY_API_KEY: ${http.apiKey ? "set" : "MISSING"} · base ${http.baseUrl}`);
  const res = await http.fetch(`${http.baseUrl}/whoami`, { headers: { "X-ScorePlay-Api-Key": http.apiKey ?? "" } });
  const who = WhoamiSchema.safeParse(await res.json().catch(() => undefined));
  line(`GET /whoami → HTTP ${res.status} · user_type=${who.success ? who.data.user_type : "?"} · company=${who.success ? who.data.company?.subdomain : "?"} · rights=${who.success ? (who.data.rights ?? []).length : "?"} (can_do_media_edit: ${who.success && who.data.rights?.includes("can_do_media_edit")})`);

  const tags = await resolveTags(http, ["Harper"]);
  line(`GET /tag/search?query=Harper → players: ${tags.players.map((p) => `${p.id} ${p.name}`).join(", ") || "none"}`);
  if (tags.players.length) {
    const page = await searchMediaPages(http, { players: tags.players.map((p) => p.id), media_type: "video" }, { perPage: 5, maxItems: 5 });
    line(`POST /media/search {players:[Harper], media_type:"video"} → count=${page.count}; first: ${page.media.map((m) => m.name).join(" | ")}`);
  }

  // Pagination: walk every video page and compare unique ids with the reported count.
  const all = await searchMediaPages(http, { media_type: "video" }, { perPage: 50, maxItems: 1000 });
  line(`Pagination (videos, per_page=50): ${all.pages} page(s), ${all.media.length} items, ${new Set(all.media.map((m) => m.ID)).size} unique, count=${all.count}`);
  const v = all.media[0];
  if (v) {
    line(`Metadata of ${v.ID} "${v.name}": type=${v.type}, media_duration=${String(v.media_duration)}ns, event=${v.event?.full_path ?? v.event_id ?? "-"}, players=${(v.player_ids ?? []).length}, tags=${(v.tag_option_ids ?? []).length}`);
  }

  // Root cause check: the previous PULSE path (REROUTE searchAssets: no media_type filter, 12 results, videos filtered afterwards).
  const legacy = (await new ScorePlayHttpClient().searchAssets("Harper", 12)).filter((a) => a.kind === "video");
  const discovered = await discoverVideos(http, { terms: ["Harper"], filenameHints: ["Harper"] });
  line(`Raw vs normalized for "Harper": previous path → ${legacy.length} video(s); PULSE discovery → ${discovered.videos.length} video(s) (${discovered.queries.map((q) => `${q.kind}=${q.count}`).join(", ")})`);
  line(`  first three: ${discovered.videos.slice(0, 3).map((d) => `${d.asset.id} ${d.asset.title} [${d.discoveredBy}]`).join(" | ")}`);
  const raw = await http.fetch(`${http.baseUrl}/media/search?page=1&per_page=1`, {
    method: "POST",
    headers: { "X-ScorePlay-Api-Key": http.apiKey ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "bench reaction after a spectacular dunk", media_type: "video" }),
  });
  const rawCount = MediaSearchResultSchema.safeParse(await raw.json());
  line(`Semantic phrase as filename query → count=${rawCount.success ? rawCount.data.count : "?"} (expected 0: name search matches whole filename words with AND)`);
}

async function twelvelabs() {
  section("TwelveLabs");
  let config;
  try {
    config = readTwelveLabsConfig();
  } catch (e) {
    line(`Configuration: ${errText(e)}`);
    return;
  }
  line(`Key from ${config.keyVariable}${config.keyVariable === "TWELVE_LABS_API_KEY" ? " (legacy alias — prefer TWELVELABS_API_KEY)" : ""} · TWELVELABS_INDEX_ID=${config.indexId}`);
  const list = await fetch("https://api.twelvelabs.io/v1.3/indexes?page_limit=50", { headers: { "x-api-key": config.apiKey } });
  const parsedIndexes = IndexListSchema.safeParse(await list.json().catch(() => undefined));
  const indexes = parsedIndexes.success ? parsedIndexes.data : { data: [] };
  line(`GET /v1.3/indexes → HTTP ${list.status}`);
  for (const i of indexes.data ?? []) {
    line(`  ${i._id} "${i.index_name}" videos=${i.video_count} models=${(i.models ?? []).map((m) => `${m.model_name}[${(m.model_options ?? []).join("/")}]`).join(",")}`);
  }
  const sdk = createTwelveLabsSdk(config.apiKey);
  let catalog;
  try {
    catalog = await loadCatalog(sdk, config.indexId);
  } catch (e) {
    line(`Index ${config.indexId}: ${errText(e)}`);
    return;
  }
  const ready = catalog.entries.filter((e) => e.status === "ready").length;
  line(`Index "${catalog.indexName}": ${catalog.entries.length} indexed assets (${ready} ready), models ${catalog.models.join(",")}, search options ${catalog.searchOptions.join(",")}`);

  // Mapping: custom id (user_metadata.scoreplay_id) vs this ScorePlay workspace.
  const http = defaultScorePlayHttp();
  const sp = new ScorePlayHttpClient();
  for (const e of catalog.entries.slice(0, 3)) {
    const byId = e.customId ? await sp.getAsset(e.customId).then((a) => `readable (${a.title})`, () => "NOT readable in this workspace") : "no custom id";
    const same = (await searchMediaPages(http, { name: (e.filename ?? "").replace(/\.[^.]+$/, ""), media_type: "video" }, { perPage: 10, maxItems: 10 })).media.filter(
      (m) => m.name === e.filename,
    );
    line(`  ${e.videoId} "${e.filename}" ${e.durationSec?.toFixed(1)}s · user_metadata.scoreplay_id=${e.customId ?? "-"} → ${byId} · same filename in workspace: ${same.map((m) => m.ID).join(", ") || "none"}`);
  }

  const team = await discoverVideos(http, { terms: ["Tottenham Hotspur"], filenameHints: [] }, { maxPerQuery: 100 });
  const { links, ambiguous } = linkToIndex(team.videos, catalog.entries);
  line(`Tottenham ScorePlay videos: ${team.videos.length}; linked to index: ${links.length} (custom id ${links.filter((l) => l.via === "CUSTOM_ID").length}, filename+duration ${links.filter((l) => l.via === "FILENAME_DURATION").length}); ambiguous ${ambiguous.length}`);
  const query = "Tottenham defender blocking a shot";
  const moments = await searchMoments(sdk, config.indexId, query, { videoIds: links.map((l) => l.entry.videoId), limit: 5 });
  line(`Marengo "${query}" within linked videos → ${moments.length} moment(s):`);
  for (const m of moments) {
    const link = links.find((l) => l.entry.videoId === m.videoId);
    line(`  #${m.rank} ${m.start.toFixed(2)}–${m.end.toFixed(2)} s · TL ${m.videoId} → ScorePlay ${link?.video.asset.id ?? "UNMAPPED"} "${link?.video.asset.title ?? "?"}" (${link?.via ?? "-"})`);
  }
}

async function pipeline() {
  section("PULSE media pipeline (per fixture opportunity)");
  const now = new Date();
  const opps = detectOpportunities(fixtureSignals(), SPONSOR_BRIEFS, { now, replayClock: new Date(SIGNAL_FIXTURE.replayClock) }, now.toISOString());
  for (const o of opps) {
    const r = await lookupMedia(o);
    const c = r.candidates[0];
    line(`${o.id}: ${r.status} · ${r.intelligence.status}${r.intelligence.code ? ` [${r.intelligence.code}]` : ""} · top: ${c ? `${c.scoreplayAssetId} "${c.title}" ${c.foundBy}${c.startSeconds !== undefined ? ` ${c.startSeconds.toFixed(1)}–${c.endSeconds?.toFixed(1)}s` : ""}` : "none"}`);
  }
}

/** Mission F: the same Tottenham library, two goals, live ranking — plus REROUTE's verdict on each top moment. */
async function goals() {
  section("Goal flow (live ScorePlay + TwelveLabs, REROUTE verdict on the top moment)");
  const run = { id: "diagnostics", schemaVersion: 1 as const, club: "tottenham" as const, submittedAt: new Date().toISOString(), resultsAt: new Date().toISOString(), rights: {} };
  for (const goal of [
    "Promote Tottenham merchandise to UK fans using the best moments from the Manchester United match.",
    "Maximize global engagement from the Manchester United match.",
  ]) {
    const objective = parseObjective(goal);
    const started = Date.now();
    const found = await searchGoal({ club: "tottenham", objective, match: parseMatch(goal) });
    line(`“${goal}” → ${objective.summary} · ${found.search.status} in ${Date.now() - started} ms · ${found.search.message}`);
    for (const [i, r] of found.pool.slice(0, 3).entries()) {
      line(`  ${i + 1}. [${r.score}] ${r.headline} · ScorePlay ${r.candidate.scoreplayAssetId} "${r.candidate.title}" ${clock(r.candidate.startSeconds ?? 0)}–${clock(r.candidate.endSeconds ?? 0)} · preview ${r.preview?.source ?? "none"}`);
    }
    const top = found.pool[0];
    if (!top) continue;
    const { edit, intent } = rerouteRequestFor({ ...run, objective, ...found }, top, new Date());
    const { decision } = await decideEdit(edit, intent);
    line(`  REROUTE (${decision.policyId}${decision.policyFictional ? ", FICTIONAL" : ""}) for ${intent.usage} ${intent.platform} ${intent.territory}: ${decision.verdict}`);
    for (const f of decision.missingFacts) line(`    missing: ${f}`);
  }
}

async function main() {
  for (const step of [scoreplay, twelvelabs, pipeline, goals]) {
    try {
      await step();
    } catch (e) {
      line(`  FAILED: ${errText(e)}`);
    }
  }
}

void main();
