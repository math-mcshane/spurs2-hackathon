import type { Metadata } from "next";
import { RerouteApp } from "@/components/reroute/reroute-app";

export const metadata: Metadata = { title: "REROUTE · Advanced rights desk" };

/** Advanced tool behind the studio's diagnostics: segment-level decisions, evidence, receipts. */
export default function DeskPage() {
  return <RerouteApp />;
}
