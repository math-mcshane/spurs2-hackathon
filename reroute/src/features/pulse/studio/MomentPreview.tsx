"use client";

import { useEffect, useRef, useState } from "react";
import { LockKeyholeIcon, RefreshCwIcon } from "lucide-react";
import { reviewApi } from "@/components/reroute/reviewer";
import { cn } from "@/lib/utils";
import { MEDIA_PREVIEW_DISABLED_NOTE } from "../flags";
import { clock } from "../moment-ranking";
import type { Preview } from "../types";

const HLS_MIME = "application/vnd.apple.mpegurl";

/** The server's MEDIA_PREVIEW_ENABLED (via the session endpoint), read once per page; any failure = disabled. */
let mediaPreviewFlag: Promise<boolean> | undefined;
const serverMediaPreview = () => (mediaPreviewFlag ??= reviewApi.session().then((s) => s.mediaPreview, () => false));

/**
 * "0:07–0:15 of 0:30": the exact moment inside its asset. The segment is clamped to the duration before
 * rounding (rounding is monotonic), so the end can never read past the asset's length.
 */
export function segmentLabel(start: number, end: number | undefined, durationSec: number | undefined): string {
  const cap = (t: number) => (durationSec === undefined ? t : Math.min(t, durationSec));
  const span = `${clock(cap(start))}–${clock(cap(end ?? start))}`;
  return durationSec === undefined ? span : `${span} of ${clock(durationSec)}`;
}

export type MomentPreviewSource = {
  title: string;
  scoreplayAssetId: string;
  thumbnailUrl?: string;
  durationSec?: number;
  start: number;
  end?: number;
  preview?: Preview;
  /** Edit plan: ranges cut from [start, end]. Playback jumps over them — a preview of the plan, not a rendered file. */
  skip?: readonly { start: number; end: number }[];
  /** What the user sees instead of a player when there is no stream. */
  note: string;
};

/** stage = Campaign Studio, lead = first moment in the gallery, compact = secondary moment, thumb = alternative row. */
export type FrameSize = "stage" | "lead" | "compact" | "thumb";

const TIMECODE: Record<FrameSize, string> = {
  stage: "text-[clamp(2.5rem,1.5rem+3vw,4.25rem)]",
  lead: "text-[clamp(2.25rem,1.4rem+2.6vw,3.75rem)]",
  compact: "text-[1.625rem]",
  thumb: "text-[0.8125rem] whitespace-nowrap",
};

/**
 * One match moment. With an authorized stream (MEDIA_PREVIEW_ENABLED and a reviewer session) it plays exactly
 * that segment: seeks to the TwelveLabs start and pauses once at its end; nothing is downloaded or stored. The
 * player is (re)initialised only when the stream URL or start changes, and the fallback appears only after a
 * real playback error. Without a stream it renders the moment as a static frame — timecode, its place in the
 * asset, and why there is no picture — never a thumbnail, stock image or URL.
 */
export function MomentPreview({ source: s, size = "compact", label, className }: { source: MomentPreviewSource; size?: FrameSize; label?: string; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const stopped = useRef(false);
  /** True while the effect tears the player down: errors fired then are not playback failures. */
  const tearingDown = useRef(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [previewsOn, setPreviewsOn] = useState(false);
  const url = s.preview?.url;
  const hlsStream = s.preview?.hls ?? false;
  const start = s.start;

  useEffect(() => {
    const el = video.current;
    if (!el || !url) return;
    tearingDown.current = false;
    let destroyed = false;
    let hls: { destroy(): void } | undefined;
    if (!hlsStream || el.canPlayType(HLS_MIME)) {
      el.src = url;
    } else {
      // Lazy: hls.js is only needed where the browser has no native HLS (e.g. Chrome), and only once a stream exists.
      void import("hls.js").then(
        ({ default: Hls }) => {
          if (destroyed) return;
          if (!Hls.isSupported()) {
            setFailed(true);
            return;
          }
          const player = new Hls({ startPosition: start, maxBufferLength: 12, maxMaxBufferLength: 20 });
          let recovered = false;
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || destroyed) return;
            // One recovery attempt per failure kind before giving up (transient segment/codec hiccups).
            if (!recovered && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              recovered = true;
              player.recoverMediaError();
            } else if (!recovered && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              recovered = true;
              player.startLoad();
            } else {
              setFailed(true);
            }
          });
          player.loadSource(url);
          player.attachMedia(el);
          hls = player;
        },
        () => setFailed(true),
      );
    }
    return () => {
      destroyed = true;
      tearingDown.current = true;
      hls?.destroy();
    };
  }, [url, hlsStream, start, attempt]);

  useEffect(() => {
    if (url) return;
    let live = true;
    void serverMediaPreview().then((on) => live && setPreviewsOn(on));
    return () => {
      live = false;
    };
  }, [url]);

  const span = segmentLabel(start, s.end, s.durationSec);
  const frame = cn("relative overflow-hidden rounded-lg bg-surface ring-1 ring-line ring-inset", size === "thumb" ? "aspect-[4/3]" : "aspect-video", className);

  if (!s.preview || failed) {
    const note = failed ? `This stream could not be played in your browser. Open ScorePlay asset ${s.scoreplayAssetId} at ${span}.` : previewsOn ? s.note : MEDIA_PREVIEW_DISABLED_NOTE;
    const short = failed ? "Can't play in this browser" : previewsOn ? "Preview for signed-in reviewers" : "Preview off · awaiting playback rights";
    const big = size === "stage" || size === "lead";
    return (
      <figure role="img" aria-label={`${s.title}, moment ${span}. ${note}`} title={note} className={cn(frame, "bg-linear-to-b from-surface-raised to-surface")}>
        {big && <FrameCorners inset="0.75rem" />}
        {label && size !== "thumb" && (
          <figcaption className={cn("absolute text-eyebrow font-medium text-ink-muted uppercase", big ? "top-7 left-7 sm:left-8" : "top-3.5 left-4")}>{label}</figcaption>
        )}
        <div className={cn("absolute inset-x-0 flex items-center", size === "thumb" ? "inset-y-0 justify-center" : "top-1/2 -translate-y-1/2", big ? "px-6 sm:px-8" : "px-4")}>
          <Timecode start={start} end={s.end} durationSec={s.durationSec} className={TIMECODE[size]} />
        </div>
        {size !== "thumb" && (
          <div className={cn("absolute inset-x-0 bottom-0 space-y-2.5", big ? "px-6 pb-6 sm:px-8" : "px-4 pb-3.5")}>
            {s.durationSec !== undefined && <SegmentTrack start={start} end={s.end ?? start} total={s.durationSec} labels={big} />}
            {(big || failed) && (
              <p className="flex items-center gap-1.5 text-meta text-ink-muted">
                <LockKeyholeIcon className="size-3 shrink-0" aria-hidden />
                {short}
                {failed && (
                  <button
                    type="button"
                    className="ml-2 inline-flex items-center gap-1 text-ink underline-offset-2 hover:underline"
                    onClick={() => {
                      setFailed(false);
                      setAttempt((n) => n + 1);
                    }}
                  >
                    <RefreshCwIcon className="size-3" aria-hidden /> Try again
                  </button>
                )}
              </p>
            )}
          </div>
        )}
      </figure>
    );
  }
  return (
    <div className={cn(frame, "bg-black")}>
      <video
        key={attempt}
        ref={video}
        poster={s.thumbnailUrl}
        controls
        muted
        playsInline
        preload="metadata"
        className="size-full object-contain"
        aria-label={`${s.title}, moment ${span}`}
        onLoadedMetadata={(e) => {
          if (Math.abs(e.currentTarget.currentTime - start) > 0.5) e.currentTarget.currentTime = start;
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          // Edit plan: jump over a cut range the playhead enters (seek lands at its end).
          const cut = s.skip?.find((r) => el.currentTime >= r.start && el.currentTime < r.end - 0.05);
          if (cut && !el.paused) {
            el.currentTime = cut.end;
            return;
          }
          // Stop once when playback first runs through the moment's end; after that the viewer is free.
          if (s.end === undefined || stopped.current || el.currentTime <= s.end) return;
          stopped.current = true;
          el.pause();
        }}
        onError={(e) => {
          const err = e.currentTarget.error;
          // Teardown (src removed/MSE detached) and user aborts are not playback failures.
          if (tearingDown.current || !err || err.code === MediaError.MEDIA_ERR_ABORTED) return;
          setFailed(true);
        }}
      />
      {size !== "thumb" && <span className="tabular pointer-events-none absolute top-3 left-3 rounded bg-obsidian/80 px-1.5 py-0.5 font-mono text-meta text-ink">{span}</span>}
      {size !== "thumb" && s.skip && s.skip.length > 0 && (
        <span className="pointer-events-none absolute top-3 right-3 rounded bg-obsidian/80 px-1.5 py-0.5 text-meta text-ink">
          Edit plan preview · skips {s.skip.map((r) => `${r.start.toFixed(1)}–${r.end.toFixed(1)} s`).join(", ")}
        </span>
      )}
    </div>
  );
}

/** "0:07 – 0:15" in the editorial face: the moment itself is the headline of the frame. */
function Timecode({ start, end, durationSec, className }: { start: number; end?: number; durationSec?: number; className?: string }) {
  const cap = (t: number) => (durationSec === undefined ? t : Math.min(t, durationSec));
  return (
    <p className={cn("tabular font-display leading-none font-medium tracking-[-0.03em] text-ink", className)} aria-hidden>
      {clock(cap(start))}
      <span className="px-[0.18em] text-ink-muted/70">–</span>
      {clock(cap(end ?? start))}
    </p>
  );
}

/** Where the moment sits in its asset: the full clip as a hairline, the moment as a solid bar. */
export function SegmentTrack({ start, end, total, labels = false, className }: { start: number; end: number; total: number; labels?: boolean; className?: string }) {
  const left = total > 0 ? Math.min(100, (start / total) * 100) : 0;
  const width = total > 0 ? Math.max(1.5, Math.min(100 - left, ((Math.min(end, total) - start) / total) * 100)) : 100;
  return (
    <div className={className} aria-hidden>
      <div className="relative h-[3px] rounded-full bg-line-strong">
        <div className="absolute inset-y-0 rounded-full bg-ink" style={{ left: `${left}%`, width: `${width}%` }} />
      </div>
      {labels && (
        <div className="tabular mt-1.5 hidden justify-between font-mono text-meta text-ink-muted sm:flex">
          <span>0:00</span>
          <span>{clock(total)}</span>
        </div>
      )}
    </div>
  );
}

/** Broadcast-style corner marks that frame the moment. */
function FrameCorners({ inset }: { inset: string }) {
  const c = "absolute size-3 border-line-strong";
  return (
    <div className="pointer-events-none absolute" style={{ inset }} aria-hidden>
      <span className={cn(c, "top-0 left-0 border-t border-l")} />
      <span className={cn(c, "top-0 right-0 border-t border-r")} />
      <span className={cn(c, "bottom-0 left-0 border-b border-l")} />
      <span className={cn(c, "right-0 bottom-0 border-r border-b")} />
    </div>
  );
}

/** Preview source for a ranked or adopted recommendation. */
export function recommendationSource(rec: {
  candidate: { title: string; scoreplayAssetId: string; thumbnailUrl?: string; durationSec?: number; startSeconds?: number; endSeconds?: number };
  preview?: Preview;
  previewNote: string;
}): MomentPreviewSource {
  const c = rec.candidate;
  return {
    title: c.title,
    scoreplayAssetId: c.scoreplayAssetId,
    thumbnailUrl: c.thumbnailUrl,
    durationSec: c.durationSec,
    start: c.startSeconds ?? 0,
    end: c.endSeconds,
    preview: rec.preview,
    note: rec.previewNote,
  };
}
