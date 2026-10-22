/**
 * Server-only TwelveLabs wrapper (twelvelabs-js v1.3.6). Reads an organizer-built index; never
 * uploads or indexes media. ScorePlay ↔ TwelveLabs identity comes ONLY from lib/media's MediaResolver.
 */
import { TwelveLabs } from "twelvelabs-js";
import { isEvidenceLinkable, type DataOrigin, type Evidence, type MediaRef, type MediaResolver, type SearchHit, type VideoIntelligence } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getMediaResolver } from "@/lib/media";
import { ReplayMissError, replayable, requestKey } from "@/lib/media/replay";
import { readTwelveLabsConfig, type TwelveLabsConfig } from "./config";
import {
  mapSearchClips,
  parsePegasusObservations,
  PegasusParseError,
  PEGASUS_JSON_SCHEMA,
  PEGASUS_PROMPT,
  type DroppedHit,
  type RawSearchClip,
} from "./parse";

if (typeof window !== "undefined") throw new Error("twelvelabs client is server-only");

const API_BASE = "https://api.twelvelabs.io/v1.3";
const PEGASUS_MODEL = "pegasus1.6";
/** Durable observation-cache key: model + prompt + schema (a prompt change invalidates old results). */
const PEGASUS_MODEL_KEY = `${PEGASUS_MODEL}:${requestKey({ prompt: PEGASUS_PROMPT, schema: PEGASUS_JSON_SCHEMA })}`;
/** Pegasus analyzes videos up to 60 min; longer ones are refused up front (never sent to analyze). */
export const PEGASUS_MAX_DURATION_SEC = 60 * 60;
const MAX_PAGE_LIMIT = 50;
/** Marengo `queryText` limit is 500 tokens; capped in characters at the client boundary. */
const MAX_QUERY_CHARS = 500;
/** How long a failed Pegasus analysis is replayed instead of re-paying for it. */
const FAILURE_TTL_MS = 5 * 60_000;

type PegasusOutput = { data: string; finishReason?: string };

/** Durable store for raw Pegasus output, keyed by TwelveLabs video id + model key. */
export interface ObservationStore {
  get(twelvelabsVideoId: string, modelKey: string): Promise<unknown | undefined>;
  put(twelvelabsVideoId: string, modelKey: string, value: unknown): Promise<void>;
}

/** In-memory store; also the fallback when the Supabase repository is unavailable. */
export function memoryObservationStore(): ObservationStore {
  const m = new Map<string, unknown>();
  return {
    get: async (v, k) => m.get(`${v}\n${k}`),
    put: async (v, k, value) => void m.set(`${v}\n${k}`, value),
  };
}

/** Persistence's `observationCache` repository when it loads and answers; in-memory otherwise. */
function defaultObservationStore(): ObservationStore {
  const memory = memoryObservationStore();
  // Dynamic on purpose: the repositories module imports "server-only", which throws outside the
  // react-server condition (tsx scripts, smoke tests) — there the cache falls back to memory.
  const durable = import("@/lib/server/repositories").then((m): ObservationStore => m.observationCache).catch(() => undefined);
  const warn = (op: string, err: unknown) => console.warn(`[twelvelabs] observation cache ${op} failed, using memory:`, err instanceof Error ? err.message : err);
  return {
    async get(v, k) {
      const store = await durable;
      if (store) {
        try {
          const hit = await store.get(v, k);
          if (hit !== undefined) return hit;
        } catch (err) {
          warn("read", err);
        }
      }
      return memory.get(v, k);
    },
    async put(v, k, value) {
      await memory.put(v, k, value);
      const store = await durable;
      if (store) await store.put(v, k, value).catch((err: unknown) => warn("write", err));
    },
  };
}

const isPegasusOutput = (v: unknown): v is PegasusOutput => !!v && typeof v === "object" && "data" in v && typeof v.data === "string";

/** User-visible error: operation + HTTP status only. The upstream body/message is logged server-side, never returned. */
function upstream(what: string, err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ReplayMissError) return new AppError("UPSTREAM", `TwelveLabs ${what} is not in the demo recording (DEMO_REPLAY=true)`, { cause: err });
  const status = err instanceof Error && "statusCode" in err ? ` (HTTP ${String(err.statusCode)})` : "";
  console.warn(`[twelvelabs] ${what} failed${status}:`, err instanceof Error ? err.message : String(err));
  return new AppError("UPSTREAM", `TwelveLabs ${what} failed${status}`, { cause: err });
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

export type SearchResult = { hits: SearchHit[]; dropped: DroppedHit[]; origin: DataOrigin };

export class TwelveLabsVideoIntelligence implements VideoIntelligence {
  private readonly sdk: TwelveLabs;
  private readonly indexId: string;
  private readonly apiKey: string;
  private readonly resolver: MediaResolver;
  private readonly store: ObservationStore;
  /** One Pegasus analysis per video at a time; concurrent callers share it. */
  private readonly inflight = new Map<string, Promise<{ value: PegasusOutput; origin: DataOrigin }>>();
  /** Recent analysis failures, replayed for FAILURE_TTL_MS so repeated requests don't re-pay. */
  private readonly failures = new Map<string, { at: number; error: AppError }>();
  /** Videos longer than PEGASUS_MAX_DURATION_SEC: a permanent technical limitation, never retried. */
  private readonly tooLong = new Map<string, AppError>();

  constructor(opts: { club?: string; config?: TwelveLabsConfig; resolver?: MediaResolver; observationStore?: ObservationStore } = {}) {
    const config = opts.config ?? readTwelveLabsConfig({ club: opts.club });
    this.sdk = new TwelveLabs({ apiKey: config.apiKey });
    this.indexId = config.indexId;
    this.apiKey = config.apiKey;
    this.resolver = opts.resolver ?? getMediaResolver(opts.club);
    this.store = opts.observationStore ?? defaultObservationStore();
  }

  async describeIndex(): Promise<{ index: IndexSummary; origin: DataOrigin }> {
    try {
      const { value, origin } = await replayable("twelvelabs", { op: "index", indexId: this.indexId }, async () => {
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
      const { value, origin } = await replayable("twelvelabs", { op: "listVideos", indexId: this.indexId, pageLimit }, async () => {
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
      const { value } = await replayable("twelvelabs", { op: "video", indexId: this.indexId, videoId }, async () => {
        const v = await this.sdk.indexes.videos.retrieve(this.indexId, videoId);
        return {
          id: v.id ?? videoId,
          assetId: v.assetId,
          filename: v.systemMetadata?.filename,
          durationSec: v.systemMetadata?.duration,
          userMetadata: { ...(v.userMetadata ?? {}) },
        } satisfies VideoInfo;
      });
      return value;
    } catch (err) {
      throw upstream(`video ${videoId} lookup`, err);
    }
  }

  /** Marengo search with the mapping report: hits carry resolved ScorePlay ids; unlinkable videos are in `dropped`. */
  async searchWithDiagnostics(query: string, opts: { limit?: number; excludeMediaIds?: string[] } = {}): Promise<SearchResult> {
    if (query.length > MAX_QUERY_CHARS) throw new AppError("BAD_REQUEST", `Search query exceeds ${MAX_QUERY_CHARS} characters`);
    const limit = Math.max(1, Math.min(opts.limit ?? 5, MAX_PAGE_LIMIT));
    // Over-fetch: unlinkable/excluded clips are dropped after the call.
    const pageLimit = Math.min(MAX_PAGE_LIMIT, limit * 4 + (opts.excludeMediaIds?.length ?? 0));
    let result: { value: RawSearchClip[]; origin: DataOrigin };
    try {
      result = await replayable("twelvelabs", { op: "search", indexId: this.indexId, query, pageLimit }, async () => {
        const res = await this.sdk.search.create({ indexId: this.indexId, queryText: query, searchOptions: ["visual"], groupBy: "clip", pageLimit });
        return (res.data ?? []).map((c): RawSearchClip => ({ videoId: c.videoId, start: c.start, end: c.end, rank: c.rank, thumbnailUrl: c.thumbnailUrl }));
      });
    } catch (err) {
      throw upstream("search", err);
    }
    const videoIds = [...new Set(result.value.flatMap((c) => c.videoId ?? []))];
    const refs = new Map(await Promise.all(videoIds.map(async (v) => [v, await this.resolver.forTwelveLabs(v)] as const)));
    const { hits, dropped } = mapSearchClips(result.value, (v) => refs.get(v), { origin: result.origin, excludeMediaIds: opts.excludeMediaIds, limit });
    return { hits, dropped, origin: result.origin };
  }

  async search(query: string, opts: { limit?: number; excludeMediaIds?: string[] } = {}): Promise<SearchHit[]> {
    const { hits, dropped } = await this.searchWithDiagnostics(query, opts);
    if (dropped.length) {
      const summary = dropped.map((d) => `${d.twelvelabsVideoId}:${d.method}`);
      console.warn(`[twelvelabs] dropped ${dropped.length} hit(s) without a unique ScorePlay asset: ${[...new Set(summary)].join(", ")}`);
    }
    return hits;
  }

  /** Pegasus observations for the TwelveLabs video of a linkable ref (`ref.twelvelabsVideoId`). */
  async observations(ref: MediaRef): Promise<Evidence[]> {
    if (!isEvidenceLinkable(ref)) {
      throw new AppError(
        "NOT_FOUND",
        `MEDIA_IDENTITY: ScorePlay asset ${ref.scoreplayMediaId ?? "?"} has no unique TwelveLabs video (${ref.method}); no evidence can be attached`,
      );
    }
    const videoId = ref.twelvelabsVideoId!;
    const scoreplayMediaId = ref.scoreplayMediaId!;
    const out = await this.pegasus(videoId, ref.match?.twelvelabsDurationSec);
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

  /** Permanent TECHNICAL limitation (cached forever) when the video exceeds Pegasus' maximum duration. */
  private checkDuration(videoId: string, durationSec: number | undefined): void {
    if (durationSec === undefined || durationSec <= PEGASUS_MAX_DURATION_SEC) return;
    const error = new AppError(
      "UPSTREAM",
      `TECHNICAL_LIMITATION: video too long for analysis (>60 min; ${Math.round(durationSec)} s) — no Pegasus observations for this asset`,
    );
    this.tooLong.set(videoId, error);
    throw error;
  }

  /**
   * Stored result, else one shared analysis per video (live, or the demo recording); failures are replayed
   * for FAILURE_TTL_MS, videos over the Pegasus limit fail fast forever without calling analyze.
   */
  private async pegasus(videoId: string, durationSec?: number): Promise<{ value: PegasusOutput; origin: DataOrigin }> {
    const request = { op: "analyze", modelKey: PEGASUS_MODEL_KEY, indexId: this.indexId, videoId };
    const stored = await this.store.get(videoId, PEGASUS_MODEL_KEY);
    if (isPegasusOutput(stored)) {
      // The recorder also captures results already in the durable store, so replay does not depend on it.
      if (process.env.DEMO_RECORD === "true") await replayable("twelvelabs", request, async () => stored);
      return { value: stored, origin: "CACHED" };
    }
    const limited = this.tooLong.get(videoId);
    if (limited) throw limited;
    this.checkDuration(videoId, durationSec);
    const failed = this.failures.get(videoId);
    if (failed && Date.now() - failed.at < FAILURE_TTL_MS) throw failed.error;
    let running = this.inflight.get(videoId);
    if (!running) {
      running = (async () => {
        try {
          const out = await replayable("twelvelabs", request, async () => {
            const video = await this.getVideo(videoId);
            this.checkDuration(videoId, video.durationSec);
            return this.analyze(video);
          });
          if (out.value.finishReason !== "length") await this.store.put(videoId, PEGASUS_MODEL_KEY, out.value);
          this.failures.delete(videoId);
          return out;
        } catch (err) {
          const error = upstream("Pegasus analyze", err);
          if (!this.tooLong.has(videoId)) this.failures.set(videoId, { at: Date.now(), error });
          throw error;
        } finally {
          this.inflight.delete(videoId);
        }
      })();
      this.inflight.set(videoId, running);
    }
    return running;
  }

  private async analyze(video: VideoInfo): Promise<PegasusOutput> {
    const common = {
      prompt: PEGASUS_PROMPT,
      temperature: 0.1,
      maxTokens: 4096,
      responseFormat: { type: "json_schema" as const, jsonSchema: { ...PEGASUS_JSON_SCHEMA } },
    };
    if (video.assetId) {
      const res = await this.sdk.analyze({ modelName: PEGASUS_MODEL, video: { type: "asset_id", assetId: video.assetId }, ...common });
      if (typeof res.data !== "string") throw new Error("analyze returned no data");
      return { data: res.data, finishReason: res.finishReason };
    }
    // Indexes built before the assets API expose only a video id; SDK 1.3.6 has no `video_id`
    // field, so call the legacy REST form directly (see API_NOTES.md).
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
    if (!resp.ok) throw Object.assign(new Error(`analyze HTTP ${resp.status}: ${JSON.stringify(body)}`), { statusCode: resp.status });
    if (!isPegasusOutput(body)) throw new Error("analyze returned no data");
    const finishReason = "finish_reason" in body && typeof body.finish_reason === "string" ? body.finish_reason : undefined;
    return { data: body.data, finishReason };
  }
}
