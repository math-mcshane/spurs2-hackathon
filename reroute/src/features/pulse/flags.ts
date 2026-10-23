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
 * `MEDIA_PREVIEW_ENABLED=true` (exactly) allows URLs derived from footage — ScorePlay proxies/streams,
 * TwelveLabs HLS, thumbnails — in API responses, and then only to a reviewer session. Off by default:
 * the organizers have not confirmed playback rights for the hackathon footage.
 */
export const isMediaPreviewEnabled = (): boolean => process.env.MEDIA_PREVIEW_ENABLED === "true";

/** Shown instead of a player while `MEDIA_PREVIEW_ENABLED` is off. */
export const MEDIA_PREVIEW_DISABLED_NOTE = "Video preview disabled until the organizers confirm playback rights. The moment and its timestamps are real.";

/** Shown instead of a player when previews are enabled but the viewer is not a signed-in reviewer. */
export const MEDIA_PREVIEW_REVIEWER_ONLY_NOTE = "Video preview is available to signed-in reviewers only. The moment and its timestamps are real.";
