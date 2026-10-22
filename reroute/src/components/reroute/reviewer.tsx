"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2Icon, LogInIcon, LogOutIcon, UserCheckIcon } from "lucide-react";
import { z } from "zod";
import { ApiErrorSchema, WritebackResponseSchema } from "@/lib/contracts";
import { ApiClientError, ReceiptViewSchema } from "@/lib/api-client";
import { WritebackPreviewSchema } from "@/lib/scoreplay/writeback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState } from "./shared";

/** `GET/POST/DELETE /api/auth/session`. `enabled=false` = reviewer sign-in is not configured on the server. */
const SessionSchema = z.object({
  enabled: z.boolean(),
  reviewer: z.object({ name: z.string(), expiresAt: z.string() }).nullable(),
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
  signIn: (passcode: string, name: string) => call(SessionSchema, "/api/auth/session", "POST", { passcode, name }),
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

/** Passcode + name sign-in. The server sets an HttpOnly cookie; the name becomes the reviewer on every review it records. */
export function ReviewerSignInDialog({
  open,
  onOpenChange,
  onSignedIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignedIn: (s: ReviewerSession) => void;
}) {
  const [name, setName] = useState("");
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
              const s = await reviewApi.signIn(passcode, name.trim());
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
            <DialogDescription>Only a signed-in rights reviewer can approve or reject. Your name is recorded on the audit receipt.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reviewer-name">Your name</Label>
            <Input id="reviewer-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reviewer-passcode">Reviewer passcode</Label>
            <Input id="reviewer-passcode" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="current-password" required />
          </div>
          {error !== null && <ErrorState error={error} />}
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim() || !passcode}>
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
  if (!session.enabled) return <span className="text-[11px] text-zinc-500">Reviewer sign-in not configured</span>;
  if (!session.reviewer)
    return (
      <Button size="sm" variant="outline" onClick={onSignIn}>
        <LogInIcon /> Reviewer sign-in
      </Button>
    );
  return (
    <span className="inline-flex items-center gap-2 text-xs text-zinc-300">
      <UserCheckIcon className="size-3.5 text-sky-300" aria-hidden />
      <span>
        Reviewer: <strong className="text-zinc-100">{session.reviewer.name}</strong>
      </span>
      <Button
        size="xs"
        variant="ghost"
        disabled={busy}
        aria-label="Sign out"
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
