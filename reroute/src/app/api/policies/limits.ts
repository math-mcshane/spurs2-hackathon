import type { RateLimitRule } from "@/lib/server/rate-limit";

/** Policy uploads and workspace-default changes (reviewer-only), per client address. */
export const POLICY_WRITE_LIMIT: RateLimitRule = { name: "policy-write", limit: 10, windowMs: 60_000 };
