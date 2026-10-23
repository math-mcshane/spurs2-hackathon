"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2Icon, LogInIcon, LogOutIcon } from "lucide-react";
import { z } from "zod";
import { ApiErrorSchema, WritebackResponseSchema } from "@/lib/contracts";
import { ApiClientError, ReceiptViewSchema } from "@/lib/api-client";
import { WritebackPreviewSchema } from "@/lib/scoreplay/writeback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState } from "./shared";

/**
 * `GET/POST/DELETE /api/auth/session`. `enabled=false` = reviewer sign-in is not configured on the server.
 * `mediaPreview` mirrors the server's MEDIA_PREVIEW_ENABLED flag (missing = previews disabled).
 */
const SessionSchema = z.object({
  enabled: z.boolean(),
  reviewer: z.object({ id: z.string(), name: z.string(), expiresAt: z.string() }).nullable(),
  mediaPreview: z.boolean().default(false),
});
export type ReviewerSession = z.infer<typeof SessionSchema>;

/** Hash-chained audit events returned by `GET /api/receipts/[id]`. */
const AuditEventSchema = z.object({
  id: z.number(),
  type: z.string(),
  actor: z.string(),
  at: z.string(),
  hash: z.string(),
  prevHash: z.string().nullable(),
  payload: z.unknown(),
});
export const AuditedReceiptSchema = ReceiptViewSchema.extend({ audit: z.array(AuditEventSchema).default([]) });
export type AuditedReceipt = z.infer<typeof AuditedReceiptSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const WritebackViewSchema = WritebackResponseSchema.extend({ receipt: ReceiptViewSchema });
export type WritebackView = z.infer<typeof WritebackViewSchema>;

async function call<S extends z.ZodType>(schema: S, path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: unknown): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError("NETWORK", `Network error calling ${path}`, 0);
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = ApiErrorSchema.safeParse(json);
    if (err.success) throw new ApiClientError(err.data.code, err.data.error, res.status);
    throw new ApiClientError("BAD_RESPONSE", `${path} failed with HTTP ${res.status}`, res.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiClientError("BAD_RESPONSE", `${path} returned a response that violates the contract`, res.status);
  return parsed.data;
}

const receiptPath = (id: string) => `/api/receipts/${encodeURIComponent(id)}`;

/** Reviewer-gated REROUTE calls. The reviewer's identity always comes from the HttpOnly session cookie, never the body. */
export const reviewApi = {
  session: () => call(SessionSchema, "/api/auth/session"),
  signIn: (reviewer: string, passcode: string) => call(SessionSchema, "/api/auth/session", "POST", { reviewer, passcode }),
  signOut: () => call(SessionSchema, "/api/auth/session", "DELETE"),
  receipt: (id: string) => call(AuditedReceiptSchema, receiptPath(id)),
  review: (id: string, status: "APPROVED" | "REJECTED") => call(ReceiptViewSchema, `${receiptPath(id)}/review`, "POST", { status }),
  writeback: (receiptId: string) => call(WritebackViewSchema, "/api/writeback", "POST", { receiptId }),
  /** What POST would do right now (mode, planned calls, target media) — no side effects. */
  writebackPreview: (receiptId: string) => call(WritebackPreviewSchema, `/api/writeback?${new URLSearchParams({ receiptId })}`),
};

/** Current reviewer session; `refresh` after sign-in/out. `null` while loading. */
export function useReviewerSession() {
  const [session, setSession] = useState<ReviewerSession | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refresh = useCallback(() => {
    reviewApi.session().then(
      (s) => {
        setSession(s);
        setError(null);
      },
      (err) => setError(err),
    );
  }, []);
  useEffect(refresh, [refresh]);
  return { session, error, setSession, refresh };
}

/**
 * Named reviewer sign-in: reviewer id (or display name) + personal passcode. The server sets an HttpOnly cookie;
 * the reviewer's configured display name is recorded on every review — nothing typed here becomes the identity.
 */
export function ReviewerSignInDialog({
  open,
  onOpenChange,
  onSignedIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignedIn: (s: ReviewerSession) => void;
}) {
  const [reviewer, setReviewer] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => onOpenChange(o)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const s = await reviewApi.signIn(reviewer.trim(), passcode);
              setPasscode("");
              onSignedIn(s);
              onOpenChange(false);
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Reviewer sign-in</DialogTitle>
            <DialogDescription>
              Only a named rights reviewer can approve or reject. Use the reviewer id and personal passcode issued to you; your
              configured name is recorded on the audit receipt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reviewer-id">Reviewer id</Label>
            <Input
              id="reviewer-id"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              maxLength={80}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reviewer-passcode">Reviewer passcode</Label>
            <Input id="reviewer-passcode" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="current-password" required />
          </div>
          {error !== null && <ErrorState error={error} />}
          <DialogFooter>
            <Button type="submit" disabled={busy || !reviewer.trim() || !passcode}>
              {busy ? <Loader2Icon className="animate-spin" /> : <LogInIcon />} Sign in
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Compact "signed in as" control with sign-in / sign-out. */
export function ReviewerControl({
  session,
  onSignIn,
  onSignedOut,
}: {
  session: ReviewerSession | null;
  onSignIn: () => void;
  onSignedOut: (s: ReviewerSession) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  if (!session.enabled) return <span className="hidden text-meta text-ink-muted sm:inline">Reviewer sign-in not configured</span>;
  if (!session.reviewer)
    return (
      <Button size="sm" variant="ghost" className="text-ink-soft" onClick={onSignIn}>
        <LogInIcon /> <span className="hidden sm:inline">Reviewer sign-in</span>
        <span className="sm:hidden">Sign in</span>
      </Button>
    );
  const name = session.reviewer.name;
  return (
    <span className="inline-flex items-center gap-2 text-small text-ink-soft" title={`Signed in as reviewer: ${name}`}>
      <span className="flex size-6 items-center justify-center rounded-full bg-surface-raised font-display text-meta font-semibold text-ink ring-1 ring-line-strong" aria-hidden>
        {name.trim().charAt(0).toUpperCase()}
      </span>
      <span className="hidden max-w-[14rem] truncate lg:inline">
        <span className="sr-only">Reviewer: </span>
        {name}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-ink-muted"
        disabled={busy}
        aria-label={`Sign out ${name}`}
        onClick={async () => {
          setBusy(true);
          try {
            onSignedOut(await reviewApi.signOut());
          } finally {
            setBusy(false);
          }
        }}
      >
        <LogOutIcon />
      </Button>
    </span>
  );
}
