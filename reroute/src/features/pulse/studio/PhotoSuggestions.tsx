"use client";

import { ChevronRightIcon, RectangleHorizontalIcon, RectangleVerticalIcon, SquareIcon } from "lucide-react";
import type { PhotoSuggestion } from "../types";
import { Eyebrow, STATUS, StatusPill, calmDemoLabel, rightsStatus } from "./parts";

const ORIENTATION: Record<PhotoSuggestion["orientation"], { word: string; Icon: typeof SquareIcon }> = {
  PORTRAIT: { word: "Portrait", Icon: RectangleVerticalIcon },
  LANDSCAPE: { word: "Landscape", Icon: RectangleHorizontalIcon },
  SQUARE: { word: "Square", Icon: SquareIcon },
  UNKNOWN: { word: "Orientation unknown", Icon: SquareIcon },
};

/**
 * Discover, secondary row: club-library photos PULSE matched on ScorePlay captions and tags (not visually
 * analysed), each with REROUTE's verdict for the goal's planned uses. The ScorePlay thumbnail appears only when
 * the server sent one (signed-in reviewer, previews enabled); otherwise an orientation glyph. Video stays the hero.
 */
export function PhotoSuggestions({ photos, note }: { photos: readonly PhotoSuggestion[]; note?: string }) {
  if (!photos.length && !note) return null;
  return (
    <section aria-labelledby="photos-title" className="mt-14 border-t border-line pt-8">
      <h2 id="photos-title">
        <Eyebrow>Photos from the club library · ScorePlay metadata only</Eyebrow>
      </h2>
      <p className="mt-2 max-w-2xl text-small text-ink-muted">
        Not visually analysed — PULSE matched these on ScorePlay captions and tags.
        {photos.some((p) => p.thumbnailUrl) ? " Thumbnails shown to signed-in reviewers only." : ""}
      </p>
      {photos.length ? (
        <ul className="mt-6 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p) => (
            <li key={p.scoreplayMediaId}>
              <Photo photo={p} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-small text-ink-soft">{note}</p>
      )}
    </section>
  );
}

function Photo({ photo: p }: { photo: PhotoSuggestion }) {
  const o = ORIENTATION[p.orientation];
  const status = rightsStatus(p.rights.verdict, p.rights.clearance);
  return (
    <article aria-label={`Photo ${p.filename}`} className="flex min-w-0 flex-col gap-3">
      {p.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- authorized ScorePlay thumbnail (reviewer session only)
        <img src={p.thumbnailUrl} alt={p.caption ?? p.filename} loading="lazy" className="aspect-[4/3] w-full rounded-lg bg-surface object-cover ring-1 ring-line ring-inset" />
      )}
      <div className="flex items-center gap-3">
        {!p.thumbnailUrl && (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-muted" role="img" aria-label={`${o.word} photo, not displayed`}>
            <o.Icon className="size-5" strokeWidth={1.5} aria-hidden />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="truncate font-mono text-small text-ink" title={p.filename}>
            {p.filename}
          </h3>
          <p className="text-meta text-ink-muted">{[o.word, p.event].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      {p.caption && <p className="text-small text-ink-soft">“{p.caption}”</p>}
      {p.people.length > 0 && <p className="text-meta text-ink-muted">Tagged in ScorePlay: {p.people.join(", ")}</p>}
      <p className="text-meta text-ink-muted">{p.matchReason}</p>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <StatusPill status={status} label={`${STATUS[status].label} · ${p.rights.allowedUses} of ${p.rights.totalUses} uses`} />
        <span className="tabular text-meta text-ink-muted">Open in ScorePlay · media {p.scoreplayMediaId}</span>
      </div>
      {p.rights.reason && (
        <details className="group/d min-w-0 text-meta text-ink-muted">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-3.5 transition-transform group-open/d:rotate-90" aria-hidden /> Why
          </summary>
          <div className="mt-2 space-y-1.5 border-l border-line pl-3">
            <p className="text-ink-soft">{calmDemoLabel(p.rights.reason)}</p>
            {p.rights.demoPolicy && <p>Checked under a demo policy — not verified legal clearance.</p>}
          </div>
        </details>
      )}
    </article>
  );
}
