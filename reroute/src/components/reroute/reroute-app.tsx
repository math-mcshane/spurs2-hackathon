"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilmIcon, GitBranchIcon, LogInIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  PublishIntentSchema,
  UsageSchema,
  type Asset,
  type ClubCode,
  type EditDecision,
  type EditPlan,
  type Evidence,
  type LakeDecideBadge,
  type PublishIntent,
} from "@/lib/contracts";
import { nextWeekendPublishAt } from "@/lib/discover/parse";
import { MEDIA_PREVIEW_DISABLED_NOTE, MEDIA_PREVIEW_REVIEWER_ONLY_NOTE } from "@/features/pulse/flags";
import { segmentLabel } from "@/features/pulse/studio/MomentPreview";
import { EDL_EXECUTION_LABEL } from "@/lib/rights/recovery/edl";
import type { Club, RecoveryOption } from "@/features/pulse/types";
import { CLUBS } from "@/features/pulse/clubs";
import { sameClub } from "@/lib/rights/club";
import { api, isAbort, type AssetDetailResponse, type PoliciesResponse, type ReceiptView } from "@/lib/api-client";
import { RightsPassport } from "./rights-passport";
import { AppHeader } from "./app-header";
import { AssetSearch } from "./asset-search";
import { ComplianceTimeline, type TimelineLane } from "./compliance-timeline";
import { ObservationForm, SegmentEditor } from "./edit-controls";
import { IntentForm, type IntentDraft } from "./intent-form";
import { ReceiptPanel } from "./receipt-panel";
import { ReviewerControl, ReviewerSignInDialog, useReviewerSession } from "./reviewer";
import { RecoveryPanel, deskAction, type AppliedRecovery, type RecoveryState } from "./recovery-panel";
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

/** The publishing club an asset belongs to, when exactly one known club is among its ScorePlay teams. */
function assetClub(asset: Asset): Club | undefined {
  const teams = asset.facts.teams ?? [];
  const found = (Object.keys(CLUBS) as Club[]).filter((club) => teams.some((t) => sameClub(t, CLUBS[club].label)));
  return found.length === 1 ? found[0] : undefined;
}

function editProblem(edit: EditPlan, maxSec?: number): string | null {
  for (const [i, s] of edit.segments.entries()) {
    if (!(s.start >= 0) || !(s.end > s.start)) return `Segment #${i + 1}: end must be after start.`;
    if (maxSec !== undefined && s.end > maxSec) return `Segment #${i + 1} ends after the asset (${tc(maxSec)}).`;
  }
  return null;
}

/** What "Undo" restores after a recovery option was applied. */
type Snapshot = { asset: Asset; detail: Detail | undefined; edit: EditPlan; intent: IntentDraft };
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
  // Tottenham footage is the flagship dataset: default to the club's home market and organic social use.
  const [intent, setIntent] = useState<IntentDraft>({
    club: "tottenham",
    territory: "GB",
    platform: "instagram",
    usage: "ORGANIC",
    competition: "",
    publishAt: "",
  });
  const [decision, setDecision] = useState<EditDecision | null>(null);
  /** Secondary Databricks lake status from /api/decide; never gates the verdict. */
  const [lake, setLake] = useState<LakeDecideBadge | null>(null);
  /** Club scope for partner discover (CDM mirror), kept in step with the intent's publishing club. */
  const [discoverClub, setDiscoverClub] = useState<ClubCode>("TOT");
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<unknown>(null);
  const [decideNonce, setDecideNonce] = useState(0);
  const [access, setAccess] = useState<AccessState>({ status: "idle" });
  const [recovery, setRecovery] = useState<RecoveryState>({ status: "idle" });
  const recoverySeq = useRef(0);
  const [applied, setApplied] = useState<(AppliedRecovery & { undo: Snapshot }) | null>(null);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  /** Selected asset whose full ScorePlay facts have not yet prefilled the intent. */
  const prefillFor = useRef<string | null>(null);
  const { session, setSession } = useReviewerSession();
  const [signInOpen, setSignInOpen] = useState(false);

  const selected = selectedId ? assets[selectedId] : undefined;
  const playerAsset = playerId ? assets[playerId] : undefined;
  const activeEdit = original;
  const activeDecision = decision;

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
      (res) => {
        const { asset } = res;
        selectAsset(asset, res);
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

  // Debounced decision for the edit on every edit/intent change.
  useEffect(() => {
    if (!original || !validIntent || originalProblem) return;
    const ac = new AbortController();
    const timer = setTimeout(async () => {
      setDeciding(true);
      try {
        const d = await api.decide({ edit: original, intent: validIntent }, { signal: ac.signal });
        setDecision(d);
        setLake(d.lake ?? null);
        setDecideError(null);
        // The gate is always asked server-side; NEEDS_REVIEW waits for an explicit review request
        // so that intent tweaking does not spam review receipts.
        if (d.decision.verdict !== "NEEDS_REVIEW") {
          setAccess({ status: "loading" });
          const res = await api.access({ edit: d.edit, intent: validIntent, action: "EXPORT" }, { signal: ac.signal });
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
  }, [original, validIntent, originalProblem, decideNonce]);

  async function loadDetail(id: string) {
    setDetails((d) => ({ ...d, [id]: { status: "loading" } }));
    try {
      const res = await api.asset(id);
      setAssets((a) => ({ ...a, [id]: res.asset }));
      setDetails((d) => ({ ...d, [id]: { status: "done", res } }));
      if (prefillFor.current === id) {
        prefillFor.current = null;
        const club = assetClub(res.asset);
        setIntent((i) => ({ ...i, ...(club ? { club } : {}), competition: i.competition || (res.asset.facts.competition ?? "") }));
      }
      return res.asset;
    } catch (err) {
      setDetails((d) => ({ ...d, [id]: { status: "error", error: err } }));
      return undefined;
    }
  }

  function selectAsset(a: Asset, detail?: AssetDetailResponse) {
    setAssets((m) => ({ ...m, [a.id]: a }));
    setSelectedId(a.id);
    setPlayerId(a.id);
    setPlayhead(null);
    setOriginal(defaultEdit(a));
    setDecision(null);
    setLake(null);
    setDecideError(null);
    setAccess({ status: "idle" });
    resetRecovery();
    setApplied(null);
    setReceipt(null);
    // The intent follows the new asset's ScorePlay facts (editable). A search result may lack them; the asset
    // detail fills what is still missing when it arrives.
    const facts = detail?.asset ?? a;
    const club = assetClub(facts);
    prefillFor.current = detail ? null : a.id;
    setIntent((i) => ({
      ...i,
      ...(club ? { club } : {}),
      competition: facts.facts.competition ?? "",
      publishAt: i.publishAt || new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3_600_000).toISOString(),
    }));
    if (detail) setDetails((d) => ({ ...d, [a.id]: { status: "done", res: detail } }));
    else void loadDetail(a.id);
  }

  function invalidate() {
    setAccess({ status: "idle" });
  }

  function patchIntent(patch: Partial<IntentDraft>) {
    prefillFor.current = null; // the producer's own value wins over a late ScorePlay fact
    invalidate();
    resetRecovery();
    setApplied(null);
    setIntent((i) => ({ ...i, ...patch }));
  }

  function patchSegment(index: number, patch: { start?: number; end?: number }) {
    if (!original) return;
    invalidate();
    resetRecovery();
    setApplied(null);
    setOriginal({
      ...original,
      segments: original.segments.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  }

  function removeSegment(index: number) {
    if (!original || original.segments.length < 2) return;
    invalidate();
    resetRecovery();
    setApplied(null);
    setOriginal({ ...original, segments: original.segments.filter((_, i) => i !== index) });
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

  /** Drops a recovery plan (it was computed for an edit + intent that no longer exist) and any in-flight one. */
  function resetRecovery() {
    recoverySeq.current += 1;
    setRecovery({ status: "idle" });
  }

  /** "Find a way to use it" for one segment of the desk's edit, for the desk's single intent (read-only). */
  async function findWay(segmentIndex: number) {
    if (!original || !validIntent) return;
    const s = original.segments[segmentIndex];
    // No label: the replacement search uses the ScorePlay title of the footage.
    const segment = { scoreplayMediaId: s.scoreplayMediaId, start: s.start, end: s.end };
    const seq = ++recoverySeq.current;
    setRecovery({ status: "loading", segmentIndex });
    try {
      const res = await api.recover({
        edit: { id: `${original.id}:seg${segmentIndex + 1}`, title: original.title, segments: [segment], derived: original.derived },
        intents: [validIntent],
      });
      if (seq === recoverySeq.current) setRecovery({ status: "done", segmentIndex, segment, res });
    } catch (err) {
      if (seq === recoverySeq.current) setRecovery({ status: "error", error: err });
    }
  }

  /**
   * Applies a recovery option to the desk: a cut replaces the segment with the kept intervals, a replacement
   * switches the desk to that moment, an intent change edits the (single) intent. The desk then decides again on
   * its own (/api/decide) — the plan's re-check is never shown as the desk's verdict.
   */
  async function applyOption(o: RecoveryOption) {
    if (!original || !selected || recovery.status !== "done") return;
    const action = deskAction(o);
    if (!action) return;
    const undo = { asset: selected, detail: details[selected.id], edit: original, intent };
    const base = original.derivedFrom ?? original.id;
    if (action === "CUT") {
      const t = o.timeline!;
      const pieces = t.retained.map((r) => ({ scoreplayMediaId: t.sourceAssetId, start: r.start, end: r.end }));
      invalidate();
      setOriginal({
        id: `${base}~${o.kind.toLowerCase()}`,
        title: `${selected.title} · ${o.title}`,
        segments: original.segments.flatMap((s, i) => (i === recovery.segmentIndex ? pieces : [s])),
        derived: true,
        derivedFrom: base,
      });
    } else if (action === "REPLACE") {
      const r = o.replacement!;
      let res: AssetDetailResponse;
      try {
        res = await api.asset(r.scoreplayMediaId);
      } catch {
        toast.error(`Could not load ScorePlay asset ${r.scoreplayMediaId}`);
        return;
      }
      selectAsset(res.asset, res);
      setOriginal({
        id: `${base}~replace`,
        title: `${res.asset.title} · replacement`,
        segments: [{ scoreplayMediaId: r.scoreplayMediaId, start: r.start, end: r.end }],
        derived: true,
        derivedFrom: base,
      });
      setIntent(intent); // same use; only the footage changed
    } else {
      const ch = o.campaignChange!;
      const patch: Partial<IntentDraft> = {};
      if (ch.territories?.length && !ch.territories.includes(intent.territory)) patch.territory = ch.territories[0];
      if (ch.platforms?.length && !ch.platforms.includes(intent.platform)) patch.platform = ch.platforms[0];
      if (ch.usage) patch.usage = ch.usage;
      invalidate();
      setIntent((i) => ({ ...i, ...patch }));
    }
    resetRecovery();
    setApplied({ title: o.title, kind: o.kind, undo });
    toast.info(`Applied “${o.title}” — the desk is deciding again.`);
  }

  function undoApplied() {
    if (!applied) return;
    const { asset, detail, edit, intent: before } = applied.undo;
    if (asset.id !== selectedId) selectAsset(asset, detail?.status === "done" ? detail.res : undefined);
    invalidate();
    resetRecovery();
    setApplied(null);
    setOriginal(edit);
    setIntent(before);
  }

  const lanes: TimelineLane[] = original ? [{ key: "edit", label: "EDIT", edit: original, decision: activeDecision, pending: deciding }] : [];

  const observationsByMedia: Record<string, Evidence[]> = {};
  for (const [id, d] of Object.entries(details)) {
    if (d.status === "done") observationsByMedia[id] = d.res.observations;
  }

  const blockedIndex = activeDecision ? activeDecision.segments.findIndex((s) => s.decision.verdict !== "ALLOWED") : -1;
  const selectedDetail = selectedId ? details[selectedId] : undefined;
  const playerDetail = playerId ? details[playerId] : undefined;

  return (
    <div className="flex min-h-screen flex-col">
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
              <AssetSearch
                selectedId={selectedId ?? undefined}
                clubCode={discoverClub}
                onClubChange={(c) => {
                  setDiscoverClub(c);
                  setIntent((i) => ({ ...i, club: c === "TOT" ? "tottenham" : "spurs" }));
                }}
                onSelect={selectAsset}
                onDiscoverMeta={(meta) => {
                  if (meta.weekendPublish) setIntent((i) => ({ ...i, publishAt: nextWeekendPublishAt() }));
                }}
              />
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
                ) : playerAsset ? (
                  <div role="note" className="flex max-w-md flex-col items-center gap-2 px-4 text-center text-xs text-zinc-300">
                    {(() => {
                      const seg = activeEdit?.segments.find((s) => s.scoreplayMediaId === playerAsset.id);
                      return (
                        <span className="font-mono text-sm text-zinc-100">
                          {seg ? segmentLabel(seg.start, seg.end, playerAsset.durationSec) : segmentLabel(0, playerAsset.durationSec, playerAsset.durationSec)}
                        </span>
                      );
                    })()}
                    <span className="font-medium text-zinc-200">{playerAsset.title}</span>
                    <span className="font-mono text-[10px] text-zinc-500">ScorePlay asset {playerAsset.id}</span>
                    {!session?.mediaPreview ? (
                      <span className="text-zinc-400">{MEDIA_PREVIEW_DISABLED_NOTE}</span>
                    ) : !session.reviewer ? (
                      <>
                        <span className="text-zinc-400">{MEDIA_PREVIEW_REVIEWER_ONLY_NOTE}</span>
                        <Button size="sm" variant="outline" disabled={!session.enabled} onClick={() => setSignInOpen(true)}>
                          <LogInIcon /> {session.enabled ? "Sign in as reviewer to preview" : "Reviewer sign-in not configured"}
                        </Button>
                      </>
                    ) : (
                      <span className="text-zinc-400">No authorized preview stream from ScorePlay for this asset. The moment and its timestamps are real.</span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-zinc-600">
                    <FilmIcon className="size-8" aria-hidden />
                    <span className="text-xs">{playerDetail?.status === "loading" ? "Loading asset…" : "No asset selected"}</span>
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

              {original?.derived && (
                <div className="flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] text-sky-200">
                  <GitBranchIcon className="size-3.5 shrink-0" aria-hidden />
                  <span>
                    <strong>Derived edit</strong> {original.id} — produced by “Find a way to use it” from {original.derivedFrom ?? "the original"}; a new asset
                    that needs its own decision and human review · {EDL_EXECUTION_LABEL}
                  </span>
                  {activeDecision && <VerdictBadge verdict={activeDecision.decision.verdict} clearance={activeDecision.decision.clearance} className="ml-auto" />}
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
                    onRemove={removeSegment}
                    onReset={() => {
                      invalidate();
                      resetRecovery();
                      setApplied(null);
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
            {lake && lake.status !== "unavailable" && (
              <p className="border-t border-white/5 px-3 py-2 font-mono text-[10px] text-zinc-500">
                Lake (Databricks L2): {lake.status} · secondary — the app verdict above is primary
                {lake.passports.length > 0 &&
                  ` · ${lake.passports.map((p) => `${p.mediaId}: ${p.verdict ?? "pending"}`).join(", ")}`}
              </p>
            )}
            {selected && (
              <div className="border-t border-white/5 p-3">
                <RightsPassport mediaId={selected.id} />
              </div>
            )}
          </Panel>

          <Panel aria-labelledby="p-reroute">
            <PanelTitle step="05">
              <span id="p-reroute">Find a way to use it · recovery</span>
            </PanelTitle>
            <RecoveryPanel
              target={blockedIndex >= 0 && !deciding ? blockedIndex : null}
              state={recovery}
              applied={applied}
              decision={activeDecision}
              deciding={deciding}
              onFind={findWay}
              onApply={(o) => void applyOption(o)}
              onUndo={undoApplied}
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
      <footer className="px-5 pb-4 text-meta text-ink-muted">
        Decisions come from verified rules and metadata only — logo detection, similarity or absence of a deny rule is never permission.
        In-app access gating does not change ScorePlay ACLs.
      </footer>
      <ReviewerSignInDialog
        open={signInOpen}
        onOpenChange={setSignInOpen}
        onSignedIn={(s) => {
          setSession(s);
          // Preview URLs are only returned to reviewers: re-read the asset on screen.
          if (playerId) void loadDetail(playerId);
        }}
      />
    </div>
  );
}
