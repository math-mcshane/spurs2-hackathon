"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCwIcon, VideoOffIcon } from "lucide-react";
import { reviewApi } from "@/components/reroute/reviewer";
import { cn } from "@/lib/utils";
import { MEDIA_PREVIEW_DISABLED_NOTE } from "../flags";
import { clock } from "../moment-ranking";
import type { Preview } from "../types";

const HLS_MIME = "application/vnd.apple.mpegurl";

/** The server's MEDIA_PREVIEW_ENABLED (via the session endpoint), read once per page; any failure = disabled. */
let mediaPreviewFlag: Promise<boolean> | undefined;
const serverMediaPreview = () => (mediaPreviewFlag ??= reviewApi.session().then((s) => s.mediaPreview, () => false));

/** "0:07–0:15 of 0:30": the exact moment inside its asset. */
export function segmentLabel(start: number, end: number | undefined, durationSec: number | undefined): string {
  const span = `${clock(start)}–${clock(end ?? start)}`;
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
  /** What the user sees instead of a player when there is no stream. */
  note: string;
};

/**
 * Plays exactly one moment from its authorized stream (ScorePlay proxy or the TwelveLabs index HLS):
 * seeks to the TwelveLabs start and pauses once at its end. Nothing is downloaded or stored. The
 * player is (re)initialised only when the stream URL or start changes — never because a parent
 * re-rendered with an equal preview — and the fallback appears only after a real playback error.
 * Without a stream (always while MEDIA_PREVIEW_ENABLED is off) it renders a neutral, static placeholder:
 * the exact segment, the asset title and its ScorePlay id — no player, no thumbnail, no spinner.
 */
export function MomentPreview({ source: s, className }: { source: MomentPreviewSource; className?: string }) {
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

  const span = `${clock(start)}–${clock(s.end ?? start)}`;
  if (!s.preview || failed) {
    return (
      <div
        role="note"
        aria-label={`${s.title}, moment ${span}`}
        className={cn("flex aspect-video w-full flex-col justify-center gap-2 overflow-hidden rounded-lg border border-white/10 bg-zinc-900 p-4 text-[11px] text-zinc-300", className)}
      >
        <p className="flex items-center gap-1.5 font-mono text-sm text-zinc-100">
          <VideoOffIcon className="size-4 shrink-0 text-zinc-500" aria-hidden /> {segmentLabel(start, s.end, s.durationSec)}
        </p>
        <p className="truncate font-medium text-zinc-200" title={s.title}>
          {s.title}
        </p>
        <p className="font-mono text-[10px] text-zinc-500">ScorePlay asset {s.scoreplayAssetId}</p>
        <p className="text-zinc-400">
          {failed
            ? `This stream could not be played in your browser. To watch it, open ScorePlay asset ${s.scoreplayAssetId} at ${span}.`
            : previewsOn
              ? s.note
              : MEDIA_PREVIEW_DISABLED_NOTE}
        </p>
        {failed && (
          <button
            type="button"
            className="inline-flex items-center gap-1 self-start text-sky-300 underline-offset-2 hover:underline"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            <RefreshCwIcon className="size-3" aria-hidden /> Try again
          </button>
        )}
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
