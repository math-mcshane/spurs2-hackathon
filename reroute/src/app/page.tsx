import { RerouteApp } from "@/components/reroute/reroute-app";
import { isPulseEnabled } from "@/features/pulse/flags";

export default function Home() {
  return <RerouteApp pulseEnabled={isPulseEnabled()} />;
}
