"use client";

import { useEffect, useRef, useState } from "react";
import { FilmIcon, VideoOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { clock } from "../moment-ranking";
import type { Recommendation } from "../types";

const HLS_MIME = "application/vnd.apple.mpegurl";

/**
 * Plays exactly the recommended moment from its authorized stream (ScorePlay proxy or the
 * TwelveLabs index stream): seeks to the TwelveLabs start and pauses at its end. Nothing is
 * downloaded or stored. Without a playable stream — or if playback fails — it shows the real asset
 * metadata and what to do instead, never a broken player.
 */
export function MomentPreview({ rec, className }: { rec: Recommendation; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const stopped = useRef(false);
  const [failed, setFailed] = useState(false);
  const start = rec.candidate.startSeconds ?? 0;
  const end = rec.candidate.endSeconds;
  const preview = rec.preview;

  useEffect(() => {
    const el = video.current;
    if (!el || !preview) return;
    if (!preview.hls || el.canPlayType(HLS_MIME)) {
      el.src = preview.url;
      return;
    }
    let destroyed = false;
    let hls: { destroy(): void } | undefined;
    // Lazy: hls.js is only needed where the browser has no native HLS (e.g. Chrome), and only once a stream exists.
    void import("hls.js").then(({ default: Hls }) => {
      if (destroyed) return;
      if (!Hls.isSupported()) {
        setFailed(true);
        return;
      }
      const player = new Hls({ startPosition: start, maxBufferLength: 12, maxMaxBufferLength: 20 });
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setFailed(true);
      });
      player.loadSource(preview.url);
      player.attachMedia(el);
      hls = player;
    }, () => setFailed(true));
    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [preview, start]);

  const span = `${clock(start)}–${clock(end ?? start)}`;
  if (!preview || failed) {
    return (
      <div className={cn("relative flex aspect-video w-full flex-col justify-end overflow-hidden rounded-lg border border-white/10 bg-zinc-900", className)}>
        {rec.candidate.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- ScorePlay/TwelveLabs thumbnail reference
          <img src={rec.candidate.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover opacity-40" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : (
          <FilmIcon className="absolute top-1/2 left-1/2 size-8 -translate-1/2 text-zinc-700" aria-hidden />
        )}
        <div className="relative space-y-1 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8 text-[11px] text-zinc-300">
          <p className="flex items-center gap-1.5 font-medium text-zinc-100">
            <VideoOffIcon className="size-3.5" aria-hidden /> Preview not available
          </p>
          <p>{failed ? `This stream could not be played in your browser. To watch it, open ScorePlay asset ${rec.candidate.scoreplayAssetId} at ${span}.` : rec.previewNote}</p>
          <p className="font-mono text-[10px] text-zinc-500">
            ScorePlay {rec.candidate.scoreplayAssetId}
            {rec.candidate.durationSec !== undefined && ` · ${clock(rec.candidate.durationSec)} long`} · moment {span}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-white/10 bg-black", className)}>
      <video
        ref={video}
        poster={rec.candidate.thumbnailUrl}
        controls
        muted
        playsInline
        preload="metadata"
        className="aspect-video w-full object-contain"
        aria-label={`${rec.candidate.title}, moment ${span}`}
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = start;
        }}
        onTimeUpdate={(e) => {
          // Stop once when playback first runs through the moment's end; after that the viewer is free.
          if (end === undefined || stopped.current || e.currentTarget.currentTime <= end) return;
          stopped.current = true;
          e.currentTarget.pause();
        }}
        onError={() => setFailed(true)}
      />
      <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">
        {span}
      </span>
    </div>
  );
}
