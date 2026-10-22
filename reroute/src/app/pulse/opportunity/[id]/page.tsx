import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPulseEnabled } from "@/features/pulse/flags";
import { OpportunityDetail } from "@/features/pulse/OpportunityDetail";

export const metadata: Metadata = { title: "PULSE · Opportunity" };

export default function OpportunityPage({ params }: PageProps<"/pulse/opportunity/[id]">) {
  if (!isPulseEnabled()) notFound();
  return <Suspense>{params.then(({ id }) => <OpportunityDetail id={id} />)}</Suspense>;
}
