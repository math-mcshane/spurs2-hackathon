import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPulseEnabled } from "@/features/pulse/flags";
import { PulseStudio } from "@/features/pulse/studio/PulseStudio";

export const metadata: Metadata = { title: "PULSE · Campaign studio" };

export default function PulsePage() {
  if (!isPulseEnabled()) notFound();
  return <PulseStudio />;
}
