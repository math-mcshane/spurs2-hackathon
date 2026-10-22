/**
 * Server-only TwelveLabs wrapper (twelvelabs-js v1.3.6). Reads an organizer-built index; never
 * uploads or indexes media. See API_NOTES.md for endpoint findings.
 */
import { TwelveLabs } from "twelvelabs-js";
import type { DataOrigin, Evidence, SearchHit, VideoIntelligence } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { recorded } from "./cache";
import {
  CUSTOM_ID_KEYS,
  customIdFromMetadata,
  mapSearchClips,
  parsePegasusObservations,
  PegasusParseError,
  PEGASUS_JSON_SCHEMA,
  PEGASUS_PROMPT,
  type RawSearchClip,
} from "./parse";

if (typeof window !== "undefined") throw new Error("twelvelabs client is server-only");

const API_BASE = "https://api.twelvelabs.io/v1.3";
const PEGASUS_MODEL = "pegasus1.6";
const MAX_PAGE_LIMIT = 50;

interface Config {
  apiKey: string;
  indexId: string;
}

function readConfig(): Config {
  const apiKey = process.env.TWELVELABS_API_KEY;
  const indexId = process.env.TWELVELABS_INDEX_ID;
  if (!apiKey || !indexId) {
    const missing = [!apiKey && "TWELVELABS_API_KEY", !indexId && "TWELVELABS_INDEX_ID"].filter(Boolean).join(", ");
    throw new AppError("NOT_CONFIGURED", `TwelveLabs not configured: missing ${missing}`);
  }
  return { apiKey, indexId };
}

function upstream(what: string, err: unknown): AppError {
  if (err instanceof AppError) return err;
  const status = err instanceof Error && "statusCode" in err ? ` (HTTP ${String(err.statusCode)})` : "";
  const msg = err instanceof Error ? err.message : String(err);
  return new AppError("UPSTREAM", `TwelveLabs ${what} failed${status}: ${msg}`, { cause: err });
}

interface VideoInfo {
  id: string;
  assetId?: string;
  filename?: string;
  durationSec?: number;
  userMetadata: Record<string, unknown>;
}

export interface IndexSummary {
  id: string;
  name?: string;
  videoCount?: number;
  models: string[];
}

export class TwelveLabsVideoIntelligence implements VideoIntelligence {
  private readonly sdk: TwelveLabs;
  private readonly indexId: string;
  private readonly apiKey: string;
  /** TL video id → ScorePlay id (null = video has no mapping). */
  private readonly customIdByVideo = new Map<string, string | null>();
  /** ScorePlay id → TL video id. */
  private readonly videoByCustomId = new Map<string, string>();

  constructor(config: Config = readConfig()) {
    this.sdk = new TwelveLabs({ apiKey: config.apiKey });
    this.indexId = config.indexId;
    this.apiKey = config.apiKey;
  }

  private remember(videoId: string, customId: string | undefined): void {
    this.customIdByVideo.set(videoId, customId ?? null);
    if (customId) this.videoByCustomId.set(customId, videoId);
  }

  async describeIndex(): Promise<{ index: IndexSummary; origin: DataOrigin }> {
    try {
      const { value, origin } = await recorded({ op: "index", indexId: this.indexId }, async () => {
        const idx = await this.sdk.indexes.retrieve(this.indexId);
        return {
          id: idx.id ?? this.indexId,
          name: idx.indexName,
          videoCount: idx.videoCount,
          models: (idx.models ?? []).map((m) => m.modelName ?? "").filter(Boolean),
        } satisfies IndexSummary;
      });
      return { index: value, origin };
    } catch (err) {
      throw upstream("index lookup", err);
    }
  }

  async listVideos(pageLimit = 10): Promise<{ videos: VideoInfo[]; origin: DataOrigin }> {
    try {
      const { value, origin } = await recorded({ op: "listVideos", indexId: this.indexId, pageLimit }, async () => {
        const page = await this.sdk.indexes.videos.list(this.indexId, { pageLimit });
        return page.data.map(
          (v): VideoInfo => ({
            id: v.id ?? "",
            assetId: v.assetId,
            filename: v.systemMetadata?.filename,
            durationSec: v.systemMetadata?.duration,
            userMetadata: {},
          }),
        );
      });
      return { videos: value.filter((v) => v.id), origin };
    } catch (err) {
      throw upstream("video list", err);
    }
  }

  async getVideo(videoId: string): Promise<VideoInfo> {
    try {
      const { value } = await recorded({ op: "video", indexId: this.indexId, videoId }, async () => {
        const v = await this.sdk.indexes.videos.retrieve(this.indexId, videoId);
        return {
          id: v.id ?? videoId,
          assetId: v.assetId,
          filename: v.systemMetadata?.filename,
          durationSec: v.systemMetadata?.duration,
          userMetadata: { ...(v.userMetadata ?? {}) },
        } satisfies VideoInfo;
      });
      this.remember(value.id, customIdFromMetadata(value.userMetadata));
      return value;
    } catch (err) {
      throw upstream(`video ${videoId} lookup`, err);
    }
  }

  async search(query: string, opts: { limit?: number; excludeMediaIds?: string[] } = {}): Promise<SearchHit[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 5, MAX_PAGE_LIMIT));
    // Over-fetch: unmapped/excluded clips are dropped after the call.
    const pageLimit = Math.min(MAX_PAGE_LIMIT, limit * 4 + (opts.excludeMediaIds?.length ?? 0));
    const request = { op: "search", indexId: this.indexId, query, pageLimit };
    let result: { value: RawSearchClip[]; origin: DataOrigin };
    try {
      result = await recorded(request, async () => {
        const res = await this.sdk.search.create({
          indexId: this.indexId,
          queryText: query,
          searchOptions: ["visual"],
          groupBy: "clip",
          pageLimit,
          includeUserMetadata: true,
        });
        return (res.data ?? []).map(
          (c): RawSearchClip => ({
            videoId: c.videoId,
            start: c.start,
            end: c.end,
            rank: c.rank,
            thumbnailUrl: c.thumbnailUrl,
            userMetadata: c.userMetadata ? { ...c.userMetadata } : undefined,
          }),
        );
      });
    } catch (err) {
      throw upstream("search", err);
    }

    for (const clip of result.value) {
      const id = customIdFromMetadata(clip.userMetadata);
      if (clip.videoId && id) this.remember(clip.videoId, id);
    }
    // Search results may omit user_metadata: resolve unknown videos via a (cached) video lookup.
    const unknown = [...new Set(result.value.map((c) => c.videoId).filter((v): v is string => !!v))].filter(
      (v) => !this.customIdByVideo.has(v),
    );
    await Promise.all(
      unknown.map((v) =>
        this.getVideo(v).catch((err) => {
          console.warn(`[twelvelabs] could not resolve custom_id for video ${v}:`, err instanceof Error ? err.message : err);
        }),
      ),
    );

    const { hits, unmapped } = mapSearchClips(result.value, (v) => this.customIdByVideo.get(v) ?? undefined, {
      origin: result.origin,
      excludeMediaIds: opts.excludeMediaIds,
      limit,
    });
    if (unmapped.length) {
      console.warn(
        `[twelvelabs] dropped ${unmapped.length} hit(s) without ScorePlay custom_id (keys ${CUSTOM_ID_KEYS.join("/")}): ${[...new Set(unmapped)].join(", ")}`,
      );
    }
    return hits;
  }

  /** Find the TwelveLabs video carrying this ScorePlay id in user_metadata. */
  async findVideoByCustomId(scoreplayMediaId: string): Promise<VideoInfo> {
    const known = this.videoByCustomId.get(scoreplayMediaId);
    if (known) return this.getVideo(known);
    for (const key of CUSTOM_ID_KEYS) {
      let ids: string[];
      try {
        ({ value: ids } = await recorded(
          { op: "findByCustomId", indexId: this.indexId, key, scoreplayMediaId },
          async () => {
            const page = await this.sdk.indexes.videos.list(this.indexId, {
              pageLimit: 2,
              userMetadata: { [key]: scoreplayMediaId },
            });
            return page.data.map((v) => v.id ?? "").filter(Boolean);
          },
        ));
      } catch (err) {
        throw upstream("video lookup by custom_id", err);
      }
      if (ids.length > 1) console.warn(`[twelvelabs] ${ids.length}+ videos share ${key}=${scoreplayMediaId}; using first`);
      if (ids[0]) return this.getVideo(ids[0]);
    }
    throw new AppError("NOT_FOUND", `No TwelveLabs video in index ${this.indexId} has custom_id ${scoreplayMediaId}`);
  }

  async observations(scoreplayMediaId: string): Promise<Evidence[]> {
    const video = await this.findVideoByCustomId(scoreplayMediaId);
    let out: { value: { data: string; finishReason?: string }; origin: DataOrigin };
    try {
      out = await recorded(
        { op: "analyze", model: PEGASUS_MODEL, videoId: video.id, assetId: video.assetId, prompt: PEGASUS_PROMPT, schema: PEGASUS_JSON_SCHEMA },
        () => this.analyze(video),
      );
    } catch (err) {
      throw upstream("Pegasus analyze", err);
    }
    if (out.value.finishReason === "length") {
      throw new AppError("UPSTREAM", "Pegasus output truncated (finish_reason=length); not using partial observations");
    }
    try {
      const { evidence, dropped } = parsePegasusObservations(out.value.data, scoreplayMediaId, out.origin);
      if (dropped) console.warn(`[twelvelabs] dropped ${dropped} malformed Pegasus observation(s) for ${scoreplayMediaId}`);
      return evidence;
    } catch (err) {
      if (err instanceof PegasusParseError) throw new AppError("UPSTREAM", err.message, { cause: err });
      throw err;
    }
  }

  private async analyze(video: VideoInfo): Promise<{ data: string; finishReason?: string }> {
    const common = {
      prompt: PEGASUS_PROMPT,
      temperature: 0.1,
      maxTokens: 4096,
      responseFormat: { type: "json_schema" as const, jsonSchema: { ...PEGASUS_JSON_SCHEMA } },
    };
    if (video.assetId) {
      const res = await this.sdk.analyze({
        modelName: PEGASUS_MODEL,
        video: { type: "asset_id", assetId: video.assetId },
        ...common,
      });
      if (typeof res.data !== "string") throw new Error("analyze returned no data");
      return { data: res.data, finishReason: res.finishReason };
    }
    // Indexes built before the assets API expose only a video id; SDK 1.3.6 has no `video_id`
    // field, so call the legacy REST form directly (see API_NOTES.md, open question).
    const resp = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        video_id: video.id,
        prompt: common.prompt,
        temperature: common.temperature,
        max_tokens: common.maxTokens,
        stream: false,
        response_format: { type: "json_schema", json_schema: PEGASUS_JSON_SCHEMA },
      }),
    });
    const body: unknown = await resp.json().catch(() => undefined);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(body)}`);
    if (!body || typeof body !== "object" || !("data" in body) || typeof body.data !== "string") {
      throw new Error("analyze returned no data");
    }
    const finishReason = "finish_reason" in body && typeof body.finish_reason === "string" ? body.finish_reason : undefined;
    return { data: body.data, finishReason };
  }
}
