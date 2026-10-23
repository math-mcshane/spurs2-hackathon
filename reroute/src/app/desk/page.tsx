import type { Metadata } from "next";
import { NeutralClubTheme } from "@/components/pulse/neutral-club-theme";
import { RerouteApp } from "@/components/reroute/reroute-app";

export const metadata: Metadata = { title: "PULSE · Rights desk" };

/** Advanced tool behind the studio's diagnostics: segment-level decisions, evidence, receipts. */
export default function DeskPage() {
  return (
    <>
      <NeutralClubTheme />
      <RerouteApp />
    </>
  );
}
