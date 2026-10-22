"use client";

import { useEffect, useRef, useState } from "react";
import { FilmIcon, RefreshCwIcon, VideoOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { clock } from "../moment-ranking";
import type { Preview } from "../types";

const HLS_MIME = "application/vnd.apple.mpegurl";

export type MomentPreviewSource = {
  title: string;
  scoreplayAssetId: string;
  thumbnailUrl?: string;
  durationSec?: number;
  start: number;
  end?: number;
  preview?: Preview;
  /** What the user sees instead of a player when there is no stream. */
  note: string;
};

/**
 * Plays exactly one moment from its authorized stream (ScorePlay proxy or the TwelveLabs index HLS):
 * seeks to the TwelveLabs start and pauses once at its end. Nothing is downloaded or stored. The
 * player is (re)initialised only when the stream URL or start changes — never because a parent
 * re-rendered with an equal preview — and the fallback appears only after a real playback error.
 */
export function MomentPreview({ source: s, className }: { source: MomentPreviewSource; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const stopped = useRef(false);
  /** True while the effect tears the player down: errors fired then are not playback failures. */
  const tearingDown = useRef(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
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

  const span = `${clock(start)}–${clock(s.end ?? start)}`;
  if (!s.preview || failed) {
    return (
      <div className={cn("relative flex aspect-video w-full flex-col justify-end overflow-hidden rounded-lg border border-white/10 bg-zinc-900", className)}>
        {s.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- ScorePlay/TwelveLabs thumbnail reference
          <img src={s.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover opacity-40" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : (
          <FilmIcon className="absolute top-1/2 left-1/2 size-8 -translate-1/2 text-zinc-700" aria-hidden />
        )}
        <div className="relative space-y-1 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8 text-[11px] text-zinc-300">
          <p className="flex items-center gap-1.5 font-medium text-zinc-100">
            <VideoOffIcon className="size-3.5" aria-hidden /> Preview not available
          </p>
          <p>{failed ? `This stream could not be played in your browser. To watch it, open ScorePlay asset ${s.scoreplayAssetId} at ${span}.` : s.note}</p>
          {failed && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sky-300 underline-offset-2 hover:underline"
              onClick={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
            >
              <RefreshCwIcon className="size-3" aria-hidden /> Try again
            </button>
          )}
          <p className="font-mono text-[10px] text-zinc-500">
            ScorePlay {s.scoreplayAssetId}
            {s.durationSec !== undefined && ` · ${clock(s.durationSec)} long`} · moment {span}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-white/10 bg-black", className)}>
      <video
        key={attempt}
        ref={video}
        poster={s.thumbnailUrl}
        controls
        muted
        playsInline
        preload="metadata"
        className="aspect-video w-full object-contain"
        aria-label={`${s.title}, moment ${span}`}
        onLoadedMetadata={(e) => {
          if (Math.abs(e.currentTarget.currentTime - start) > 0.5) e.currentTarget.currentTime = start;
        }}
        onTimeUpdate={(e) => {
          // Stop once when playback first runs through the moment's end; after that the viewer is free.
          if (s.end === undefined || stopped.current || e.currentTarget.currentTime <= s.end) return;
          stopped.current = true;
          e.currentTarget.pause();
        }}
        onError={(e) => {
          const err = e.currentTarget.error;
          // Teardown (src removed/MSE detached) and user aborts are not playback failures.
          if (tearingDown.current || !err || err.code === MediaError.MEDIA_ERR_ABORTED) return;
          setFailed(true);
        }}
      />
      <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">{span}</span>
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
