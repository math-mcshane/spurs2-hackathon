/**
 * PULSE feature flags. The Studio goal flow is the product and is always on. The SIMULATED fan-signal
 * board is optional: its pages and API routes check `isPulseBoardEnabled()` themselves (server-side,
 * authoritative); hiding the nav link is presentation only. Missing = disabled.
 */
export const isPulseBoardEnabled = (): boolean => process.env.PULSE_BOARD_ENABLED === "true";

export type SignalSourceSetting = "fixture" | "manual";

/** `PULSE_SIGNAL_SOURCE`: `fixture` (default; labeled demo replay) or `manual` (producer triggers only). */
export function pulseSignalSource(): SignalSourceSetting | { unsupported: string } {
  const raw = process.env.PULSE_SIGNAL_SOURCE || "fixture";
  return raw === "fixture" || raw === "manual" ? raw : { unsupported: raw };
}

/**
 * `PULSE_VIDEO_PREVIEW=off` hides in-app players (ScorePlay proxy / TwelveLabs stream references)
 * if organizers do not permit embedding; recommendations then show asset metadata and timecodes.
 */
export const isVideoPreviewEnabled = (): boolean => process.env.PULSE_VIDEO_PREVIEW !== "off";
