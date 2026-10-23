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
 * Club-library photos PULSE matched on ScorePlay captions and tags (not visually analysed), each with REROUTE's
 * verdict for the goal's planned uses. The ScorePlay thumbnail appears only when the server sent one (signed-in
 * reviewer, previews enabled); otherwise an orientation glyph. Below the video opportunities they are a collapsed
 * secondary section; `standalone` (no video moment for the goal) makes them the page's content.
 */
export function PhotoSuggestions({ photos, note, standalone = false }: { photos: readonly PhotoSuggestion[]; note?: string; standalone?: boolean }) {
  if (!photos.length && !note) return null;
  const intro = (
    <span className="block max-w-2xl text-meta text-ink-muted">
      Matched on ScorePlay captions and tags, not visually analysed.
      {photos.some((p) => p.thumbnailUrl) ? " Thumbnails shown to signed-in reviewers only." : ""}
    </span>
  );
  const body = photos.length ? (
    <ul className="mt-6 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {photos.map((p) => (
        <li key={p.scoreplayMediaId}>
          <Photo photo={p} />
        </li>
      ))}
    </ul>
  ) : (
    <p className="mt-4 text-small text-ink-soft">{note}</p>
  );
  if (standalone)
    return (
      <section aria-labelledby="photos-title" className="space-y-2 pt-2">
        <h2 id="photos-title">
          <Eyebrow>Club photos for this goal</Eyebrow>
        </h2>
        {intro}
        {body}
      </section>
    );
  return (
    <details className="group/ph mt-14 border-t border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-5 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-small font-medium text-ink">Club photos for this goal{photos.length ? ` · ${photos.length}` : ""}</span>
          {intro}
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-ink-muted transition-transform group-open/ph:rotate-90" aria-hidden />
      </summary>
      <div className="pb-4">{body}</div>
    </details>
  );
}

function Photo({ photo: p }: { photo: PhotoSuggestion }) {
  const o = ORIENTATION[p.orientation];
  const status = rightsStatus(p.rights.verdict, p.rights.clearance);
  return (
    <article aria-label={`Photo ${p.caption ?? p.filename}`} className="flex min-w-0 flex-col gap-3">
      {p.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- authorized ScorePlay thumbnail (reviewer session only)
        <img src={p.thumbnailUrl} alt={p.caption ?? p.filename} loading="lazy" className="aspect-[4/3] w-full rounded-lg bg-surface object-cover object-top ring-1 ring-line ring-inset" />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-surface text-ink-muted ring-1 ring-line ring-inset" role="img" aria-label={`${o.word} photo, not displayed`}>
          <o.Icon className="size-6" strokeWidth={1.5} aria-hidden />
        </div>
      )}
      <p className="line-clamp-2 text-small text-ink">{p.caption ? `“${p.caption}”` : [o.word, p.event].filter(Boolean).join(" · ")}</p>
      <StatusPill status={status} label={`${STATUS[status].label} · ${p.rights.allowedUses} of ${p.rights.totalUses} uses`} />
      <details className="group/d min-w-0 text-meta text-ink-muted">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon className="size-3.5 transition-transform group-open/d:rotate-90" aria-hidden /> Why?
        </summary>
        <div className="mt-2 space-y-1.5 border-l border-line pl-3">
          <p>
            <span className="text-ink-soft">Why PULSE suggests it: </span>
            {p.matchReason}
          </p>
          {p.people.length > 0 && <p>Tagged in ScorePlay: {p.people.join(", ")}</p>}
          {p.rights.reason && <p className="text-ink-soft">{calmDemoLabel(p.rights.reason)}</p>}
          <p className="tabular break-all">
            {[o.word, p.event].filter(Boolean).join(" · ")} · {p.filename} · ScorePlay media {p.scoreplayMediaId}
          </p>
        </div>
      </details>
    </article>
  );
}
