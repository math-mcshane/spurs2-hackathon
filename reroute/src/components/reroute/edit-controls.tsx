"use client";

import { useState } from "react";
import { Loader2Icon, PlusIcon, RotateCcwIcon } from "lucide-react";
import type { EditPlan, Evidence } from "@/lib/contracts";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState } from "./shared";

/** Editable start/end of every segment of the producer's original cut. */
export function SegmentEditor({
  edit,
  maxSec,
  onChange,
  onReset,
}: {
  edit: EditPlan;
  maxSec?: number;
  onChange: (index: number, patch: { start?: number; end?: number }) => void;
  onReset: () => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="flex w-full items-center justify-between text-[10px] tracking-widest text-zinc-500 uppercase">
        Producer cut · segments (seconds)
      </legend>
      <div className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-x-2 gap-y-1">
        {edit.segments.map((s, i) => {
          const invalid = !(s.end > s.start) || (maxSec !== undefined && s.end > maxSec);
          return (
            <div key={i} className="contents">
              <span className="font-mono text-[10px] text-zinc-500">#{i + 1}</span>
              <Input
                type="number"
                step={0.1}
                min={0}
                value={s.start}
                aria-label={`Segment ${i + 1} start (seconds)`}
                aria-invalid={invalid}
                onChange={(e) => onChange(i, { start: Number(e.target.value) })}
                className="h-7 font-mono text-xs"
              />
              <Input
                type="number"
                step={0.1}
                min={0}
                max={maxSec}
                value={s.end}
                aria-label={`Segment ${i + 1} end (seconds)`}
                aria-invalid={invalid}
                onChange={(e) => onChange(i, { end: Number(e.target.value) })}
                className="h-7 font-mono text-xs"
              />
              <span className="w-24 truncate font-mono text-[10px] text-zinc-500">{s.label ?? ""}</span>
            </div>
          );
        })}
      </div>
      <Button type="button" size="xs" variant="ghost" onClick={onReset} className="text-zinc-400">
        <RotateCcwIcon /> Reset to 0–4 / 4–9 / 9–15 s
      </Button>
    </fieldset>
  );
}

/** Records a timecoded HUMAN observation (POST /api/observations); parent re-decides on success. */
export function ObservationForm({ mediaId, onAdded }: { mediaId: string; onAdded: (e: Evidence) => void }) {
  const [start, setStart] = useState("4");
  const [end, setEnd] = useState("9");
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.addObservation({
        scoreplayMediaId: mediaId,
        start: Number(start),
        end: Number(end),
        observation: text.trim(),
        label: label.trim() || undefined,
      });
      setText("");
      setLabel("");
      onAdded(res.evidence);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const valid = text.trim().length > 0 && Number(end) > Number(start) && Number(start) >= 0;

  return (
    <form onSubmit={submit} className="space-y-1.5" aria-label="Add human observation">
      <div className="text-[10px] tracking-widest text-zinc-500 uppercase">Add observation (HUMAN evidence)</div>
      <div className="grid grid-cols-[4rem_4rem_1fr] gap-2">
        <div className="space-y-0.5">
          <Label htmlFor="obs-start" className="text-[10px] text-zinc-500">Start s</Label>
          <Input id="obs-start" type="number" step={0.1} min={0} value={start} onChange={(e) => setStart(e.target.value)} className="h-7 font-mono text-xs" />
        </div>
        <div className="space-y-0.5">
          <Label htmlFor="obs-end" className="text-[10px] text-zinc-500">End s</Label>
          <Input id="obs-end" type="number" step={0.1} min={0} value={end} onChange={(e) => setEnd(e.target.value)} className="h-7 font-mono text-xs" />
        </div>
        <div className="space-y-0.5">
          <Label htmlFor="obs-label" className="text-[10px] text-zinc-500">Label (policy tag)</Label>
          <Input id="obs-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="brand:…" className="h-7 font-mono text-xs" />
        </div>
      </div>
      <div className="flex gap-2">
        <Label htmlFor="obs-text" className="sr-only">Observation</Label>
        <Input
          id="obs-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What is visible in this range?"
          className="h-7 text-xs"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!valid || busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
          Add
        </Button>
      </div>
      {error !== null && <ErrorState error={error} />}
    </form>
  );
}
