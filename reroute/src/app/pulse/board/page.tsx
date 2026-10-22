import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPulseEnabled } from "@/features/pulse/flags";
import { PulseDashboard } from "@/features/pulse/PulseDashboard";

export const metadata: Metadata = { title: "PULSE · Signal board" };

export default function PulseBoardPage() {
  if (!isPulseEnabled()) notFound();
  return <PulseDashboard />;
}
