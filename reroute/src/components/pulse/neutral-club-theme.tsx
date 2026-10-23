"use client";

import { useEffect } from "react";

/**
 * The Studio leaves the selected club's theme on <html> so an in-app visit to the Policy Center keeps it. Surfaces
 * not built on the club tokens (the advanced desk) mount this to return to the neutral PULSE palette.
 */
export function NeutralClubTheme() {
  useEffect(() => {
    delete document.documentElement.dataset.club;
  }, []);
  return null;
}
