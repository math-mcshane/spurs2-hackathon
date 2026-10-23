import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPulseBoardEnabled } from "@/features/pulse/flags";
import { OpportunityDetail } from "@/features/pulse/OpportunityDetail";

export const metadata: Metadata = { title: "PULSE · Opportunity (SIMULATED)" };

export default function OpportunityPage({ params }: PageProps<"/pulse/opportunity/[id]">) {
  if (!isPulseBoardEnabled()) notFound();
  return <Suspense>{params.then(({ id }) => <OpportunityDetail id={id} />)}</Suspense>;
}
