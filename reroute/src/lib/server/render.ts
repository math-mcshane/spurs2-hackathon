import { spawn } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { Asset, Segment } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { STATE_ROOT } from "@/lib/state-dir";

export const RENDERS_DIR = path.join(STATE_ROOT, ".renders");

/** Spec §9: off-platform media processing only after organizers approve it. */
export function mediaProcessingApproved(): boolean {
  return process.env.MEDIA_PROCESSING_APPROVED === "true";
}

export function renderPath(receiptId: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(receiptId)) throw new AppError("BAD_REQUEST", "Invalid receipt id");
  return path.join(RENDERS_DIR, `${receiptId}.mp4`);
}

/** Run a binary from PATH without a shell; resolves stdout, rejects with stderr tail. */
function run(cmd: string, args: string[]): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
  child.on("error", (err: NodeJS.ErrnoException) =>
    reject(
      err.code === "ENOENT"
        ? new AppError("NOT_CONFIGURED", `${cmd} not found on PATH`)
        : new AppError("INTERNAL", `${cmd} failed to start: ${err.message}`),
    ),
  );
  child.on("close", (code) =>
    code === 0 ? resolve(stdout) : reject(new AppError("INTERNAL", `${cmd} exited ${code}: ${stderr.trim()}`)),
  );
  return promise;
}

async function hasAudio(url: string): Promise<boolean> {
  const out = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "a",
    "-show_entries", "stream=index",
    "-of", "csv=p=0",
    url,
  ]);
  return out.trim().length > 0;
}

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;

/**
 * Trim each segment from its authorized ScorePlay preview URL, normalize (720p/30fps/yuv420p,
 * 48 kHz stereo; silence where a source has no audio) and concatenate into `.renders/<receiptId>.mp4`.
 */
export async function renderEdit(receiptId: string, segments: Segment[], assets: Record<string, Asset>): Promise<string> {
  const sources = segments.map((segment) => {
    const url = assets[segment.scoreplayMediaId]?.previewUrl;
    if (!url) {
      throw new AppError("NOT_FOUND", `Asset ${segment.scoreplayMediaId} has no authorized ScorePlay preview URL`);
    }
    return { segment, url };
  });
  const audio = await Promise.all(sources.map((s) => hasAudio(s.url)));

  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const { segment, url } of sources) {
    args.push("-ss", String(segment.start), "-t", String(segment.end - segment.start), "-i", url);
  }
  const filters: string[] = [];
  const concatInputs: string[] = [];
  sources.forEach(({ segment }, i) => {
    filters.push(
      `[${i}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
    );
    filters.push(
      audio[i]
        ? `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`
        : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${segment.end - segment.start}[a${i}]`,
    );
    concatInputs.push(`[v${i}][a${i}]`);
  });
  filters.push(`${concatInputs.join("")}concat=n=${sources.length}:v=1:a=1[v][a]`);

  await mkdir(RENDERS_DIR, { recursive: true });
  const out = renderPath(receiptId);
  const tmp = `${out}.tmp.mp4`;
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    tmp,
  );
  try {
    await run("ffmpeg", args);
    await rename(tmp, out);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return out;
}
