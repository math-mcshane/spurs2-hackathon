"use client";

import { useRef, useState } from "react";
import { DownloadIcon, FileJsonIcon, Loader2Icon, LogInIcon, UploadIcon } from "lucide-react";
import { ErrorState } from "@/components/reroute/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/features/pulse/studio/parts";
import { SAMPLE_HREF, policiesApi } from "./api";

/**
 * Import a JSON rule package (reviewer only). The server stores it as an unverified DEMO package; PDF/DOCX/TXT
 * are refused honestly (no rule extraction in this build).
 */
export function UploadPanel({
  reviewer,
  signInEnabled,
  uploadsAvailable,
  onSignIn,
  onUploaded,
}: {
  reviewer: { name: string } | null;
  signInEnabled: boolean;
  uploadsAvailable: boolean;
  onSignIn: () => void;
  onUploaded: (packageId: string) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ title: string; notes: string[] } | null>(null);
  const canUpload = reviewer !== null && uploadsAvailable;

  return (
    <section aria-labelledby="upload-heading" className="space-y-4 border-t border-line pt-8">
      <div>
        <Eyebrow>
          <span id="upload-heading">Add a rule package</span>
        </Eyebrow>
        <p className="mt-2 text-small text-ink-soft">
          Import rules as JSON. An upload is stored as unverified demo rules: it can test a campaign, never clear one.
        </p>
      </div>

      {!uploadsAvailable ? (
        <p className="text-small text-ink-muted">Policy uploads are not set up on this deployment.</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file) return;
            setBusy(true);
            setError(null);
            setResult(null);
            try {
              const res = await policiesApi.upload(file);
              setResult({ title: res.package.title, notes: res.notes });
              setFile(null);
              if (input.current) input.current.value = "";
              await onUploaded(res.package.id);
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className={cn("flex items-center gap-3 rounded-lg border border-dashed border-line-strong px-3 py-2.5", canUpload && !busy ? "cursor-pointer hover:border-ink-muted" : "opacity-50")}>
            <input
              ref={input}
              type="file"
              accept=".json,application/json,.pdf,.docx,.txt"
              disabled={!canUpload || busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
              className="sr-only"
            />
            <FileJsonIcon className="size-4 shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-small text-ink-soft">{file ? file.name : "Choose a rule package file"}</span>
            {file && <span className="shrink-0 font-mono text-meta text-ink-muted">{Math.ceil(file.size / 1024)} KB</span>}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" disabled={!canUpload || !file || busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Upload
            </Button>
            {!reviewer &&
              (signInEnabled ? (
                <Button type="button" size="sm" variant="ghost" className="text-ink-soft" onClick={onSignIn}>
                  <LogInIcon /> Sign in as a reviewer to upload
                </Button>
              ) : (
                <span className="text-meta text-ink-muted">Uploads need a reviewer sign-in, which is not configured here.</span>
              ))}
          </div>
          <p className="text-meta text-ink-muted">JSON only, up to 200 KB. Contracts (PDF, Word) can’t be read in this build.</p>
        </form>
      )}

      {error !== null && <ErrorState error={error} />}
      {result && (
        <div role="status" className="space-y-1 text-small text-ink-soft">
          <p>
            Added <span className="text-ink">{result.title}</span> as uploaded, unverified rules.
          </p>
          {result.notes.map((n) => (
            <p key={n} className="text-meta text-ink-muted">
              {n}
            </p>
          ))}
        </div>
      )}

      <a href={SAMPLE_HREF} download className="inline-flex items-center gap-1.5 text-small text-ink-muted underline-offset-4 hover:text-ink hover:underline">
        <DownloadIcon className="size-3.5" aria-hidden /> Download sample
      </a>
    </section>
  );
}
