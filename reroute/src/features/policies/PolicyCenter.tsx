"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, Loader2Icon, LockIcon, RefreshCwIcon } from "lucide-react";
import { CONTAINER, PulseFooter, PulseHeader } from "@/components/pulse/shell";
import { ReviewerControl, ReviewerSignInDialog, useReviewerSession } from "@/components/reroute/reviewer";
import { ErrorState } from "@/components/reroute/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/features/pulse/studio/parts";
import { pulseApi } from "@/features/pulse/client";
import { authenticity, clubLabel, policiesApi, type Library, type PackageSummary } from "./api";
import { PackageDetail } from "./PackageDetail";
import { UploadPanel } from "./UploadPanel";

/** Tottenham first (the football demo), then the other clubs in library order. */
const CLUB_ORDER = ["tottenham", "spurs"];

function groupByClub(packages: readonly PackageSummary[]): [string, PackageSummary[]][] {
  const clubs = [...new Set(packages.map((p) => p.club))].sort(
    (a, b) => (CLUB_ORDER.indexOf(a) + 1 || 99) - (CLUB_ORDER.indexOf(b) + 1 || 99),
  );
  return clubs.map((club) => [club, packages.filter((p) => p.club === club)]);
}

/** Studio ↔ Policy Center, styled like the Studio's step nav. */
function CenterNav() {
  return (
    <nav aria-label="PULSE">
      <ul className="flex items-center gap-1 py-1 md:py-0">
        <li>
          <Link href="/" className="flex h-10 items-center rounded-md px-2.5 text-small text-ink-muted transition-colors hover:text-ink md:h-14">
            Campaign studio
          </Link>
        </li>
        <li>
          <span aria-current="page" className="relative flex h-10 items-center rounded-md px-2.5 text-small text-ink md:h-14">
            Policy Center
            <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-signal" aria-hidden />
          </span>
        </li>
      </ul>
    </nav>
  );
}

/**
 * The Policy Center. `?package=<id>` opens that package; `?run=<goal id>` (from a campaign) lets an imported
 * package be applied to that campaign, then returns to it for a fresh rights check.
 */
export function PolicyCenter() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryError, setLibraryError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const { session, setSession } = useReviewerSession();
  const router = useRouter();

  const loadLibrary = useCallback(
    (signal?: AbortSignal) =>
      policiesApi.library(undefined, signal).then(
        (lib) => {
          setLibrary(lib);
          setLibraryError(null);
          const params = new URLSearchParams(window.location.search);
          setSelectedId((current) => current ?? params.get("package"));
          setRunId(params.get("run"));
        },
        (err: unknown) => {
          if (!signal?.aborted) setLibraryError(err);
        },
      ),
    [],
  );

  useEffect(() => {
    const ac = new AbortController();
    void loadLibrary(ac.signal);
    return () => ac.abort();
  }, [loadLibrary]);

  const groups = library ? groupByClub(library.policies) : [];
  const fallbackId = library ? (library.defaults[groups[0]?.[0] ?? ""] ?? library.policies[0]?.id ?? null) : null;
  const shownId = selectedId && library?.policies.some((p) => p.id === selectedId) ? selectedId : fallbackId;

  const choose = (id: string) => {
    setSelectedId(id);
    window.history.replaceState(null, "", `/policies?${new URLSearchParams({ package: id, ...(runId ? { run: runId } : {}) })}`);
    // Below lg the package sits under the library: bring it into view.
    if (window.matchMedia("(max-width: 1023px)").matches) document.getElementById("package-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const reviewer = session?.reviewer ?? null;

  /** Selects the package for the campaign the presenter came from (its own versioned action), then goes back to it. */
  const applyToCampaign = async (packageId: string) => {
    if (!runId) return;
    const goal = await pulseApi.goal(runId);
    if (!goal) throw new Error("That campaign no longer exists");
    if (goal.policy?.packageId !== packageId) await pulseApi.goalAction({ action: "setPolicy", id: runId, expectedVersion: goal.version, packageId });
    router.push(`/?${new URLSearchParams({ run: runId, step: "opportunities" })}`);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <PulseHeader nav={<CenterNav />} actions={<ReviewerControl session={session} onSignIn={() => setSignInOpen(true)} onSignedOut={setSession} />} />

      <main className="flex-1">
        <section className={cn(CONTAINER, "py-8 sm:py-10")}>
          {runId && (
            <Link
              href={`/?${new URLSearchParams({ run: runId, step: "opportunities" })}`}
              className="mb-5 inline-flex items-center gap-1.5 text-small text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              <ArrowLeftIcon className="size-3.5" aria-hidden /> Back to your campaign
            </Link>
          )}
          <Eyebrow>Policy Center</Eyebrow>
          <h1 className="mt-2 max-w-3xl font-display text-title font-medium text-ink">What rules is PULSE checking your campaigns against?</h1>
          <p className="mt-3 max-w-2xl text-body text-ink-soft">
            Every rights check runs against one rule package per club: the workspace default, unless a campaign picks another. The packages here are
            illustrative presets, a sample mapping and uploaded rules — none is a verified club agreement.
          </p>
          <p role="note" className="mt-5 flex max-w-2xl items-start gap-2.5 rounded-lg border border-line-strong px-4 py-3 text-small text-ink-soft">
            <LockIcon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
            <span>No package in this library can authorize publication. Publishing needs a verified agreement and human approval.</span>
          </p>
          <div className="mt-8">
            <UploadPanel
              reviewer={reviewer}
              signInEnabled={session?.enabled ?? false}
              uploadsAvailable={library?.uploadsAvailable ?? true}
              campaignRunId={runId}
              onSignIn={() => setSignInOpen(true)}
              onUploaded={async (id) => {
                await loadLibrary();
                choose(id);
              }}
              onApplyToCampaign={applyToCampaign}
            />
          </div>
        </section>

        <div className={cn(CONTAINER, "grid gap-10 border-t border-line pt-8 pb-16 lg:grid-cols-12 lg:gap-12")}>
          <aside className="space-y-10 lg:col-span-4" aria-label="Rule package library">
            {libraryError !== null && !library ? (
              <div className="space-y-3">
                <ErrorState error={libraryError} service="Policy" />
                <Button size="sm" variant="outline" onClick={() => void loadLibrary()}>
                  <RefreshCwIcon /> Retry
                </Button>
              </div>
            ) : !library ? (
              <p role="status" className="flex items-center gap-2 text-small text-ink-muted">
                <Loader2Icon className="size-4 animate-spin" aria-hidden /> Loading the library…
              </p>
            ) : (
              groups.map(([club, packages]) => (
                <section key={club} aria-labelledby={`club-${club}`}>
                  <h2 id={`club-${club}`} className="text-eyebrow font-medium text-ink-muted uppercase">
                    {clubLabel(club)}
                  </h2>
                  <ul className="mt-3 divide-y divide-line border-y border-line">
                    {packages.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => choose(p.id)}
                          aria-current={p.id === shownId ? "true" : undefined}
                          className={cn(
                            "relative flex w-full flex-col items-start gap-1 py-3 pr-2 pl-4 text-left transition-colors",
                            p.id === shownId ? "bg-surface" : "hover:bg-surface/60",
                          )}
                        >
                          {p.id === shownId && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-signal" aria-hidden />}
                          <span className="text-small font-medium text-ink">{p.title}</span>
                          <span className="flex flex-wrap items-center gap-x-2 text-meta text-ink-muted">
                            <span className={p.sourceType !== "PRESET" ? "text-status-review" : undefined}>{authenticity(p)}</span>
                            <span aria-hidden>·</span>
                            <span className="font-mono">v{p.version}</span>
                            {p.isDefault && (
                              <>
                                <span aria-hidden>·</span>
                                <span className="text-ink">Workspace default</span>
                              </>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}

          </aside>

          <section id="package-detail" className="min-w-0 scroll-mt-28 lg:col-span-8" aria-label="Selected rule package">
            {shownId && (
              <PackageDetail
                key={shownId}
                id={shownId}
                reviewer={reviewer}
                uploadsAvailable={library?.uploadsAvailable ?? true}
                onSignIn={() => setSignInOpen(true)}
                onDefaultChanged={() => void loadLibrary()}
              />
            )}
          </section>
        </div>
      </main>

      <PulseFooter>
        Rule packages are evaluated by REROUTE, the deterministic rights engine. A demo-policy “allowed” is never legal clearance.
      </PulseFooter>

      <ReviewerSignInDialog open={signInOpen} onOpenChange={setSignInOpen} onSignedIn={setSession} />
    </div>
  );
}
