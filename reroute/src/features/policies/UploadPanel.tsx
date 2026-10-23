"use client";

import { useRef, useState } from "react";
import { ArrowRightIcon, CheckCircle2Icon, DownloadIcon, FileJsonIcon, Loader2Icon, LogInIcon, UploadCloudIcon } from "lucide-react";
import { ErrorState } from "@/components/reroute/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SAMPLE_HREF, authenticity, policiesApi, type UploadResult } from "./api";

/**
 * "Upload policy": drop or choose a JSON rule package (reviewer only), or import the bundled example file. On a
 * deployment that stores uploads the package is saved as unverified demo rules; where it cannot, the example file
 * resolves to its prepared sample mapping (same rules, validated) and any other valid file is refused honestly.
 * PDF/DOCX are refused: there is no rule extraction from legal documents in this build.
 */
export function UploadPanel({
  reviewer,
  signInEnabled,
  uploadsAvailable,
  campaignRunId,
  onSignIn,
  onUploaded,
  onApplyToCampaign,
}: {
  reviewer: { name: string } | null;
  signInEnabled: boolean;
  uploadsAvailable: boolean;
  /** The campaign the presenter came from (`?run=`), if any. */
  campaignRunId: string | null;
  onSignIn: () => void;
  onUploaded: (packageId: string) => Promise<void>;
  onApplyToCampaign: (packageId: string) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"file" | "sample" | "apply" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const enabled = reviewer !== null && busy === null;

  const run = async (kind: "file" | "sample", upload: () => Promise<UploadResult>) => {
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      const res = await upload();
      setResult(res);
      await onUploaded(res.package.id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };
  const send = (file: File | undefined) => file && void run("file", () => policiesApi.upload(file));
  const sample = result?.package.sourceType === "SAMPLE_DOCUMENT_MAPPING";

  return (
    <section aria-labelledby="upload-heading" className="rounded-xl bg-surface p-6 ring-1 ring-line ring-inset sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 id="upload-heading" className="font-display text-headline font-medium text-ink">
            Upload policy
          </h2>
          <p className="mt-1.5 text-small text-ink-soft">
            Import a rule package as JSON and test campaigns against it. Imported rules are illustrative and unverified — they can change a verdict, never
            authorize publication.
          </p>
        </div>
        <a href={SAMPLE_HREF} download className="inline-flex items-center gap-1.5 text-small text-ink-muted underline-offset-4 hover:text-ink hover:underline">
          <DownloadIcon className="size-3.5" aria-hidden /> Download example file
        </a>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (enabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (enabled) send(e.dataTransfer.files[0]);
        }}
        className={cn(
          "mt-5 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-9 text-center transition-colors",
          dragging ? "border-signal bg-signal/5" : "border-line-strong",
          enabled ? "cursor-pointer hover:border-ink-muted" : "opacity-60",
        )}
      >
        <input
          ref={input}
          type="file"
          accept=".json,application/json,.pdf,.docx,.txt"
          disabled={!enabled}
          onChange={(e) => send(e.target.files?.[0])}
          className="sr-only"
        />
        {busy === "file" ? <Loader2Icon className="size-6 animate-spin text-ink-muted" aria-hidden /> : <UploadCloudIcon className="size-6 text-ink-muted" aria-hidden />}
        <span className="text-small text-ink">
          <span className="font-medium underline-offset-4 group-hover:underline">Choose a file</span> or drop it here
        </span>
        <span className="text-meta text-ink-muted">JSON rule package · up to 200 KB · contracts (PDF, Word) are not read</span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="outline" disabled={!enabled} onClick={() => void run("sample", policiesApi.uploadSample)}>
          {busy === "sample" ? <Loader2Icon className="animate-spin" /> : <FileJsonIcon />} Use the example file
        </Button>
        {!reviewer &&
          (signInEnabled ? (
            <Button type="button" size="sm" variant="ghost" className="text-ink-soft" onClick={onSignIn}>
              <LogInIcon /> Sign in as reviewer to upload
            </Button>
          ) : (
            <span className="text-meta text-ink-muted">Uploads need reviewer sign-in, which is not configured here.</span>
          ))}
        {!uploadsAvailable && (
          <span className="text-meta text-ink-muted">This deployment does not store uploads: the example file uses its prepared sample mapping.</span>
        )}
      </div>

      {error !== null && <ErrorState error={error} className="mt-4" />}

      {result && (
        <div role="status" className="mt-5 space-y-3 rounded-lg bg-obsidian p-4 ring-1 ring-line ring-inset">
          <p className="flex items-start gap-2 text-small text-ink">
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-status-clear" aria-hidden />
            <span>
              <span className="font-medium">{result.package.title}</span> is in the library ·{" "}
              <span className="text-status-review">{authenticity(result.package)}</span>
            </span>
          </p>
          <p className="text-meta text-ink-muted">
            {sample
              ? "Sample mapping: the example file's rules were mapped to PULSE's rule format in advance and validated. PULSE does not extract rules from legal documents."
              : "Stored as unverified, illustrative rules."}{" "}
            {result.package.territories.length > 0 && `Licensed markets: ${result.package.territories.join(", ")}.`}
          </p>
          {result.notes.map((n) => (
            <p key={n} className="text-meta text-ink-muted">
              {n}
            </p>
          ))}
          {campaignRunId ? (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={async () => {
                setBusy("apply");
                setError(null);
                try {
                  await onApplyToCampaign(result.package.id);
                } catch (err) {
                  setError(err);
                  setBusy(null);
                }
              }}
            >
              {busy === "apply" ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />} Use for my campaign
            </Button>
          ) : (
            <p className="text-meta text-ink-soft">To use it, open a campaign and choose it under Rights → Change rules.</p>
          )}
        </div>
      )}
    </section>
  );
}
