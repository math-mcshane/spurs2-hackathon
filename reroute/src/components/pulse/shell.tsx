import Link from "next/link";
import { cn } from "@/lib/utils";

/** The one product mark. REROUTE (rights engine) and CLEAR are capabilities inside PULSE, not brands. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink", className)}>
      <span className="size-2.5 rounded-[3px] bg-signal" aria-hidden />
      PULSE
    </span>
  );
}

export const CONTAINER = "mx-auto w-full max-w-[1320px] px-5 sm:px-8";

/**
 * Sticky product header shared by every PULSE surface. `nav` sits beside the mark on wide screens and drops
 * to its own row on phones; `actions` stay on the right.
 */
export function PulseHeader({ nav, actions, className }: { nav?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("sticky top-0 z-40 border-b border-line bg-obsidian/90 backdrop-blur-md", className)}>
      <div className={cn(CONTAINER, "flex h-14 items-center gap-8")}>
        <Link href="/" className="shrink-0 rounded-sm" aria-label="PULSE — new goal">
          <Wordmark />
        </Link>
        {nav && <div className="hidden min-w-0 md:block">{nav}</div>}
        <div className="ml-auto flex min-w-0 items-center gap-2">{actions}</div>
      </div>
      {nav && <div className={cn(CONTAINER, "border-t border-line md:hidden")}>{nav}</div>}
    </header>
  );
}

export function PulseFooter({ children }: { children: React.ReactNode }) {
  return (
    <footer className="mt-auto border-t border-line">
      <div className={cn(CONTAINER, "py-6 text-meta text-ink-muted")}>{children}</div>
    </footer>
  );
}
