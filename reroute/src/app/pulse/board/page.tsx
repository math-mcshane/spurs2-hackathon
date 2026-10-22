import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPulseBoardEnabled } from "@/features/pulse/flags";
import { PulseDashboard } from "@/features/pulse/PulseDashboard";

export const metadata: Metadata = { title: "PULSE · Signal board (SIMULATED)" };

export default function PulseBoardPage() {
  if (!isPulseBoardEnabled()) notFound();
  return <PulseDashboard />;
}
