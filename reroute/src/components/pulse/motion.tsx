"use client";

import { AnimatePresence, MotionConfig, motion, type HTMLMotionProps } from "motion/react";

/**
 * PULSE motion. Every transition communicates a state change (results arrive, a moment is swapped, a
 * decision changes) and is short; `reducedMotion="user"` turns transforms off under prefers-reduced-motion.
 */
export const EASE = [0.22, 1, 0.36, 1] as const;

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.28, ease: EASE }}>
      {children}
    </MotionConfig>
  );
}

/** Fades and rises into place once, optionally after `delay` seconds (staggered lists). */
export function Reveal({ delay = 0, y = 8, ...props }: HTMLMotionProps<"div"> & { delay?: number; y?: number }) {
  return <motion.div initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: EASE, delay }} {...props} />;
}

/**
 * Replaces its content when `id` changes: the old content fades out, the new one fades in. Used where the
 * same slot shows a different thing (the campaign's media, the rights decision).
 */
export function Swap({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        className={className}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.24, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export { AnimatePresence, motion };
