"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilmIcon, GitBranchIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import {
  PublishIntentSchema,
  UsageSchema,
  type Asset,
  type Candidate,
  type EditDecision,
  type EditPlan,
  type Evidence,
  type PublishIntent,
} from "@/lib/contracts";
import { api, isAbort, type AssetDetailResponse, type PoliciesResponse, type ReceiptView } from "@/lib/api-client";
import { AppHeader } from "./app-header";
import { AssetSearch } from "./asset-search";
import { ComplianceTimeline, type TimelineLane } from "./compliance-timeline";
import { ObservationForm, SegmentEditor } from "./edit-controls";
import { IntentForm, type IntentDraft } from "./intent-form";
import { ReceiptPanel } from "./receipt-panel";
import { ReviewerControl, ReviewerSignInDialog, useReviewerSession } from "./reviewer";
import { ResolvePanel, type ResolveState } from "./resolve-panel";
import { ErrorState, OriginBadge, Panel, PanelTitle, VerdictBadge, tc } from "./shared";
import { VerdictCard, type AccessState } from "./verdict-card";

const DEFAULT_CUT: readonly [number, number][] = [
  [0, 4],
  [4, 9],
  [9, 15],
];
const DECIDE_DEBOUNCE_MS = 200;

/** The producer's default 15 s cut of an asset: 0–4 / 4–9 / 9–15 s, clamped to a known duration. */
function defaultEdit(asset: Asset): EditPlan {
  const max = asset.durationSec;
  const segments = DEFAULT_CUT.filter(([s]) => max === undefined || s < max).map(([start, end]) => ({
    scoreplayMediaId: asset.id,
    start,
    end: max === undefined ? end : Math.min(end, max),
  }));
  return { id: `edit-${asset.id}`, title: `${asset.title} · 15 s cut`, segments, derived: false };
}

function editProblem(edit: EditPlan, maxSec?: number): string | null {
  for (const [i, s] of edit.segments.entries()) {
    if (!(s.start >= 0) || !(s.end > s.start)) return `Segment #${i + 1}: end must be after start.`;
    if (maxSec !== undefined && s.end > maxSec) return `Segment #${i + 1} ends after the asset (${tc(maxSec)}).`;
  }
  return null;
}

type Decisions = { original: EditDecision | null; proposed: EditDecision | null };
type Detail = { status: "loading" } | { status: "done"; res: AssetDetailResponse } | { status: "error"; error: unknown };

export function RerouteApp() {
  const [policies, setPolicies] = useState<PoliciesResponse | null>(null);
  const [policiesError, setPoliciesError] = useState<unknown>(null);

  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<{ mediaId: string; t: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);

  const [original, setOriginal] = useState<EditPlan | null>(null);
  const [proposed, setProposed] = useState<EditPlan | null>(null);
  // Tottenham footage is the flagship dataset: default to the club's home market and organic social use.
  const [intent, setIntent] = useState<IntentDraft>({
    club: "tottenham",
    territory: "GB",
    platform: "instagram",
    usage: "ORGANIC",
    competition: "",
    publishAt: "",
  });
  const [decisions, setDecisions] = useState<Decisions>({ original: null, proposed: null });
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<unknown>(null);
  const [decideNonce, setDecideNonce] = useState(0);
  const [access, setAccess] = useState<AccessState>({ status: "idle" });
  const [resolve, setResolve] = useState<ResolveState>({ status: "idle" });
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const { session, setSession } = useReviewerSession();
  const [signInOpen, setSignInOpen] = useState(false);

  const selected = selectedId ? assets[selectedId] : undefined;
  const playerAsset = playerId ? assets[playerId] : undefined;
  const activeEdit = proposed ?? original;
  const activeDecision = proposed ? decisions.proposed : decisions.original;

  const validIntent: PublishIntent | null = useMemo(() => {
    const r = PublishIntentSchema.safeParse({ ...intent, club: intent.club || undefined });
    return r.success ? r.data : null;
  }, [intent]);
  const originalProblem = original ? editProblem(original, selected?.durationSec) : null;

  const incompleteReason = !selected
    ? "Search ScorePlay and select an asset to evaluate the producer’s cut."
    : originalProblem
      ? originalProblem
      : !validIntent
        ? "Complete the publish intent (competition and publish time are required)."
        : null;

  // Policy banner source.
  useEffect(() => {
    const ac = new AbortController();
    api.policies({ signal: ac.signal }).then(setPolicies, (err) => {
      if (!isAbort(err)) setPoliciesError(err);
    });
    return () => ac.abort();
  }, []);

  // Deep link from the studio's diagnostics (`/desk?asset=&start=&end=&territory=&platform=&usage=&competition=&club=`):
  // preload that asset, cut and intent. The desk decides exactly as for a manually selected asset.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const id = p.get("asset");
    if (!id) return;
    api.asset(id).then(
      ({ asset }) => {
        selectAsset(asset);
        const start = Number(p.get("start"));
        const end = Number(p.get("end"));
        if (p.has("start") && p.has("end") && end > start) {
          setOriginal({
            id: `edit-${asset.id}`,
            title: `${asset.title} · studio cut`,
            segments: [{ scoreplayMediaId: asset.id, start, end, label: "studio cut" }],
            derived: false,
          });
        }
        const usage = UsageSchema.safeParse(p.get("usage"));
        setIntent((i) => ({
          club: p.get("club") ?? i.club,
          territory: p.get("territory") || i.territory,
          platform: p.get("platform") || i.platform,
          usage: usage.success ? usage.data : i.usage,
          competition: p.get("competition") || i.competition,
          publishAt: p.get("publishAt") || i.publishAt,
        }));
        toast.info(`Opened ScorePlay asset ${asset.id} from the studio`);
      },
      () => toast.error(`Could not load ScorePlay asset ${id}`),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the deep link once on mount
  }, []);

  // Debounced decision for the original (and proposed) edit on every edit/intent change.
  useEffect(() => {
    if (!original || !validIntent || originalProblem) return;
    const ac = new AbortController();
    const timer = setTimeout(async () => {
      setDeciding(true);
      try {
        const [o, p] = await Promise.all([
          api.decide({ edit: original, intent: validIntent }, { signal: ac.signal }),
          proposed ? api.decide({ edit: proposed, intent: validIntent }, { signal: ac.signal }) : Promise.resolve(null),
        ]);
        setDecisions({ original: o, proposed: p });
        setDecideError(null);
        const active = p ?? o;
        // The gate is always asked server-side; NEEDS_REVIEW waits for an explicit review request
        // so that intent tweaking does not spam review receipts.
        if (active.decision.verdict !== "NEEDS_REVIEW") {
          setAccess({ status: "loading" });
          const res = await api.access({ edit: active.edit, intent: validIntent, action: "EXPORT" }, { signal: ac.signal });
          setAccess({ status: "done", res });
        } else {
          setAccess({ status: "idle" });
        }
      } catch (err) {
        if (isAbort(err)) return;
        setDecideError(err);
        setAccess({ status: "idle" });
      } finally {
        if (!ac.signal.aborted) setDeciding(false);
      }
    }, DECIDE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [original, proposed, validIntent, originalProblem, decideNonce]);

  async function loadDetail(id: string) {
    setDetails((d) => ({ ...d, [id]: { status: "loading" } }));
    try {
      const res = await api.asset(id);
      setAssets((a) => ({ ...a, [id]: res.asset }));
      setDetails((d) => ({ ...d, [id]: { status: "done", res } }));
      return res.asset;
    } catch (err) {
      setDetails((d) => ({ ...d, [id]: { status: "error", error: err } }));
      return undefined;
    }
  }

  function selectAsset(a: Asset) {
    setAssets((m) => ({ ...m, [a.id]: a }));
    setSelectedId(a.id);
    setPlayerId(a.id);
    setPlayhead(null);
    setOriginal(defaultEdit(a));
    setProposed(null);
    setDecisions({ original: null, proposed: null });
    setDecideError(null);
    setAccess({ status: "idle" });
    setResolve({ status: "idle" });
    setReceipt(null);
    setIntent((i) => ({
      ...i,
      competition: a.facts.competition ?? "",
      publishAt: i.publishAt || new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3_600_000).toISOString(),
    }));
    void loadDetail(a.id);
  }

  function invalidate() {
    setAccess({ status: "idle" });
  }

  function patchIntent(patch: Partial<IntentDraft>) {
    invalidate();
    setIntent((i) => ({ ...i, ...patch }));
  }

  function patchSegment(index: number, patch: { start?: number; end?: number }) {
    if (!original) return;
    invalidate();
    setProposed(null);
    setResolve({ status: "idle" });
    setDecisions((d) => ({ ...d, proposed: null }));
    setOriginal({
      ...original,
      segments: original.segments.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  }

  async function seek(mediaId: string, t: number) {
    if (mediaId === playerId) {
      if (videoRef.current) videoRef.current.currentTime = t;
      setPlayhead({ mediaId, t });
      return;
    }
    pendingSeek.current = t;
    const known = assets[mediaId] ?? (await loadDetail(mediaId));
    if (!known) {
      toast.error(`Could not load ScorePlay asset ${mediaId} for preview`);
      return;
    }
    setPlayerId(mediaId);
    setPlayhead({ mediaId, t });
  }

  async function checkAccess() {
    if (!activeEdit || !validIntent) return;
    setAccess({ status: "loading" });
    try {
      const res = await api.access({ edit: activeEdit, intent: validIntent, action: "EXPORT" });
      setAccess({ status: "done", res });
      if (res.receiptId) setReceipt(await api.receipt(res.receiptId));
    } catch (err) {
      setAccess({ status: "error", error: err });
    }
  }

  async function use() {
    if (!activeEdit || !validIntent) return;
    setAccess({ status: "loading" });
    try {
      // Re-ask the gate at the moment of use; a previously shown "Use" is never trusted on its own.
      const res = await api.access({ edit: activeEdit, intent: validIntent, action: "EXPORT" });
      setAccess({ status: "done", res });
      if (!res.granted) {
        toast.error("Access gate no longer grants export for this intent.");
        return;
      }
      const r = await api.createReceipt({ edit: activeEdit, intent: validIntent });
      setReceipt(r);
      toast.success(`Export cleared by the access gate · receipt ${r.id}`);
    } catch (err) {
      setAccess({ status: "error", error: err });
    }
  }

  async function runResolve(segmentIndex: number) {
    if (!activeEdit || !validIntent) return;
    setResolve({ status: "loading", segmentIndex });
    try {
      const res = await api.resolve({ edit: activeEdit, intent: validIntent, segmentIndex, limit: 3 });
      setResolve({ status: "done", segmentIndex, res });
    } catch (err) {
      setResolve({ status: "error", error: err });
    }
  }

  function applyCandidate(c: Candidate) {
    invalidate();
    setProposed(c.proposedEdit);
    setDecisions((d) => ({ ...d, proposed: c.editDecision }));
    toast.info("Proposed edit is a derived asset: it needs its own decision and human review.");
  }

  function revert() {
    invalidate();
    setProposed(null);
    setDecisions((d) => ({ ...d, proposed: null }));
  }

  const lanes: TimelineLane[] = [];
  if (original) {
    lanes.push({
      key: "original",
      label: proposed ? "ORIGINAL" : "EDIT",
      edit: original,
      decision: decisions.original,
      pending: deciding,
    });
  }
  if (proposed) {
    lanes.push({ key: "proposed", label: "PROPOSED", edit: proposed, decision: decisions.proposed, pending: deciding });
  }

  const observationsByMedia: Record<string, Evidence[]> = {};
  for (const [id, d] of Object.entries(details)) {
    if (d.status === "done") observationsByMedia[id] = d.res.observations;
  }

  const blockedIndex = activeDecision ? activeDecision.segments.findIndex((s) => s.decision.verdict !== "ALLOWED") : -1;
  const selectedDetail = selectedId ? details[selectedId] : undefined;
  const playerDetail = playerId ? details[playerId] : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.06),transparent_60%)]">
      <AppHeader
        policies={policies}
        policiesError={policiesError}
        reviewer={<ReviewerControl session={session} onSignIn={() => setSignInOpen(true)} onSignedOut={setSession} />}
      />

      <main className="grid flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* LEFT: find + player + timeline */}
        <div className="flex min-w-0 flex-col gap-3">
          <Panel aria-labelledby="p-find">
            <PanelTitle step="01">
              <span id="p-find">Find · ScorePlay</span>
            </PanelTitle>
            <div className="p-3">
              <AssetSearch selectedId={selectedId ?? undefined} onSelect={selectAsset} />
            </div>
          </Panel>

          <Panel aria-labelledby="p-player" className="flex-1">
            <PanelTitle
              step="02"
              right={
                playerAsset && (
                  <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                    <span className="max-w-56 truncate text-zinc-300">{playerAsset.title}</span>
                    <span>{playerAsset.id}</span>
                    <OriginBadge origin={playerAsset.origin} className="h-4 px-1 text-[9px]" />
                  </div>
                )
              }
            >
              <span id="p-player">Player · compliance timeline</span>
            </PanelTitle>
            <div className="space-y-3 p-3">
              <div className="relative flex h-[34vh] min-h-48 w-full items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black">
                {playerAsset?.previewUrl ? (
                  <video
                    key={playerAsset.id}
                    ref={videoRef}
                    src={playerAsset.previewUrl}
                    poster={playerAsset.thumbnailUrl}
                    controls
                    preload="metadata"
                    className="size-full object-contain"
                    aria-label={`Preview of ${playerAsset.title}`}
                    onLoadedMetadata={(e) => {
                      if (pendingSeek.current !== null) {
                        e.currentTarget.currentTime = pendingSeek.current;
                        pendingSeek.current = null;
                      }
                    }}
                    onTimeUpdate={(e) => setPlayhead({ mediaId: playerAsset.id, t: e.currentTarget.currentTime })}
                  />
                ) : playerAsset?.thumbnailUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- remote ScorePlay thumbnail */}
                    <img src={playerAsset.thumbnailUrl} alt={playerAsset.title} className="size-full object-contain" />
                    <span className="absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-zinc-300">
                      No authorized preview stream from ScorePlay — thumbnail only
                    </span>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-zinc-600">
                    {playerDetail?.status === "loading" ? (
                      <Loader2Icon className="size-6 animate-spin" />
                    ) : (
                      <FilmIcon className="size-8" aria-hidden />
                    )}
                    <span className="text-xs">{playerAsset ? "No preview or thumbnail for this asset" : "No asset selected"}</span>
                  </div>
                )}
                <div className="pointer-events-none absolute top-2 left-2 font-mono text-[10px] text-red-400/80">
                  {playerAsset ? "● PGM" : ""}
                </div>
              </div>

              {selectedDetail?.status === "error" && <ErrorState error={selectedDetail.error} service="ScorePlay" />}
              {selectedDetail?.status === "done" && selectedDetail.res.analysis !== "AVAILABLE" && (
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200"
                >
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <div>
                    <div className="font-medium">
                      {selectedDetail.res.analysis === "NOT_CONFIGURED"
                        ? "TwelveLabs key not configured — no automated observations"
                        : selectedDetail.res.analysis === "UNLINKABLE"
                          ? "This ScorePlay asset has no proven TwelveLabs match — no automated observations attached"
                          : "TwelveLabs analysis failed — no automated observations"}
                    </div>
                    <div className="opacity-80">
                      {selectedDetail.res.analysisDetail ? `${selectedDetail.res.analysisDetail} · ` : ""}
                      Rights facts and human evidence still apply; unknown facts stay NEEDS_REVIEW.
                    </div>
                  </div>
                </div>
              )}

              {proposed && (
                <div className="flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] text-sky-200">
                  <GitBranchIcon className="size-3.5" aria-hidden />
                  <span>
                    <strong>Derived edit</strong> {proposed.id} — a new asset distinct from the original; it needs its own decision and human review.
                  </span>
                  {decisions.proposed && <VerdictBadge verdict={decisions.proposed.decision.verdict} className="ml-auto" />}
                </div>
              )}

              {lanes.length > 0 ? (
                <ComplianceTimeline lanes={lanes} observations={observationsByMedia} playhead={playhead} onSeek={seek} />
              ) : (
                <p className="text-xs text-zinc-500">The timecoded compliance timeline appears once an asset is selected.</p>
              )}

              {original && selected && (
                <div className="grid gap-4 border-t border-white/5 pt-3 md:grid-cols-2">
                  <SegmentEditor
                    edit={original}
                    maxSec={selected.durationSec}
                    onChange={patchSegment}
                    onReset={() => {
                      invalidate();
                      setProposed(null);
                      setResolve({ status: "idle" });
                      setDecisions({ original: null, proposed: null });
                      setOriginal(defaultEdit(selected));
                    }}
                  />
                  <ObservationForm
                    mediaId={selected.id}
                    onAdded={(e) => {
                      toast.success(`Human observation recorded on ${e.scoreplayMediaId} · re-deciding`);
                      invalidate();
                      void loadDetail(selected.id).then(() => setDecideNonce((n) => n + 1));
                    }}
                  />
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* RIGHT: intent, verdict, reroute */}
        <div className="flex min-w-0 flex-col gap-3">
          <Panel aria-labelledby="p-target">
            <PanelTitle step="03">
              <span id="p-target">Target · publish intent</span>
            </PanelTitle>
            <div className="p-3">
              <IntentForm value={intent} onChange={patchIntent} competitionFromAsset={selected?.facts.competition} />
            </div>
          </Panel>

          <Panel aria-labelledby="p-verdict">
            <PanelTitle step="04">
              <span id="p-verdict">Verdict · access gate</span>
            </PanelTitle>
            <VerdictCard
              decision={activeDecision}
              pending={deciding}
              error={decideError}
              incompleteReason={incompleteReason}
              access={access}
              onCheckAccess={checkAccess}
              onUse={use}
            />
          </Panel>

          <Panel aria-labelledby="p-reroute">
            <PanelTitle step="05">
              <span id="p-reroute">Reroute · Marengo alternatives</span>
            </PanelTitle>
            <ResolvePanel
              blockedIndex={blockedIndex >= 0 && !deciding ? blockedIndex : null}
              state={resolve}
              appliedEditId={proposed?.id ?? null}
              onResolve={runResolve}
              onApply={applyCandidate}
              onRevert={revert}
            />
          </Panel>
        </div>

        {/* FINAL: receipt, review, writeback, render */}
        <Panel aria-labelledby="p-record" className="lg:col-span-2">
          <PanelTitle step="06">
            <span id="p-record">Record · rights receipt, review, ScorePlay writeback</span>
          </PanelTitle>
          <ReceiptPanel
            edit={incompleteReason ? null : activeEdit}
            intent={validIntent}
            receipt={receipt}
            session={session}
            onSignIn={() => setSignInOpen(true)}
            onReceipt={(r) => {
              setReceipt(r);
              if (r.writeback.some((w) => w.status === "VERIFIED")) toast.success("ScorePlay writeback verified by read-back");
            }}
          />
        </Panel>
      </main>
      <footer className="px-4 pb-3 font-mono text-[9px] text-zinc-600">
        Decisions come from verified rules and metadata only — logo detection, similarity or absence of a deny rule is never permission.
        In-app access gating does not change ScorePlay ACLs.
      </footer>
      <ReviewerSignInDialog open={signInOpen} onOpenChange={setSignInOpen} onSignedIn={setSession} />
    </div>
  );
}
