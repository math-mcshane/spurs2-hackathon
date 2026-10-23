import type { Metadata } from "next";
import { PolicyCenter } from "@/features/policies/PolicyCenter";

export const metadata: Metadata = { title: "PULSE · Policy Center" };

/** Which rule packages campaigns are evaluated against: library, overview, plain-language rules, upload (`?package=<id>`). */
export default function PoliciesPage() {
  return <PolicyCenter />;
}
