import { AppError } from "@/lib/errors";

/**
 * Per-client-IP fixed-window rate limits for expensive or abusable API routes, applied in `src/proxy.ts`.
 *
 * BEST-EFFORT ONLY: counters live in this server instance's memory. On Vercel/serverless every instance (and
 * every cold start) has its own counters, so the effective limit is "N per instance per window". It blunts a
 * single client hammering the demo; it is not a distributed quota. The real control in production is a Vercel
 * Firewall rate-limit rule on `/api/*`. (A shared store would need a new table on the shared database, which
 * needs approval.) Used by the Node-runtime proxy, so it stays free of `server-only`.
 */

export type RateLimitRule = { name: string; limit: number; windowMs: number };

const MINUTE = 60_000;

export const RATE_LIMITS = {
  goalRun: { name: "pulse-goal-run", limit: 10, windowMs: MINUTE },
  goalAction: { name: "pulse-goal-action", limit: 60, windowMs: MINUTE },
  rights: { name: "rights", limit: 20, windowMs: MINUTE },
  assetDetail: { name: "asset-detail", limit: 30, windowMs: MINUTE },
  signIn: { name: "sign-in", limit: 5, windowMs: MINUTE },
} as const satisfies Record<string, RateLimitRule>;

/** Bound on tracked (rule, address) windows so a spray of addresses cannot grow memory without limit. */
const MAX_TRACKED = 20_000;

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

/**
 * Client address: first hop of `x-real-ip`, else of `x-forwarded-for`. Vercel sets both from the TCP peer, so
 * they cannot be spoofed there; behind any other proxy they are only as trustworthy as that proxy. Requests
 * without either (local dev, tests) share the "unknown" bucket.
 */
export function clientAddress(req: Request): string {
  return (
    req.headers.get("x-real-ip")?.split(",")[0]?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function evict(now: number): void {
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  // Still full: forget the oldest-tracked window (Map iterates in insertion order).
  while (windows.size >= MAX_TRACKED) windows.delete(windows.keys().next().value!);
}

/** Counts one request against `rule` for `address`; throws RATE_LIMITED (429 + Retry-After) once over the limit. */
export function consumeRateLimit(rule: RateLimitRule, address: string, now: number = Date.now()): void {
  const key = `${rule.name}\u0000${address}`;
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (!w && windows.size >= MAX_TRACKED) evict(now);
    w = { count: 0, resetAt: now + rule.windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  if (w.count > rule.limit) {
    const retryAfter = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
    throw new AppError("RATE_LIMITED", "Too many requests; try again shortly", {
      headers: { "Retry-After": String(retryAfter) },
    });
  }
}

/** Reads the JSON `action` of a POST /api/pulse/goal without consuming the request body the route will parse. */
async function goalAction(req: Request): Promise<string | undefined> {
  try {
    const body: unknown = await req.clone().json();
    return body && typeof body === "object" && "action" in body && typeof body.action === "string" ? body.action : undefined;
  } catch {
    return undefined; // malformed: the route answers BAD_REQUEST; still counted as an ordinary action
  }
}

/** The limit that applies to this request, or null when the route is not rate-limited. */
export async function rateLimitRuleFor(req: Request, pathname: string): Promise<RateLimitRule | null> {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (req.method === "POST") {
    if (path === "/api/pulse/goal") return (await goalAction(req)) === "run" ? RATE_LIMITS.goalRun : RATE_LIMITS.goalAction;
    if (path === "/api/resolve" || path === "/api/decide" || path === "/api/access") return RATE_LIMITS.rights;
    if (path === "/api/auth/session") return RATE_LIMITS.signIn;
  }
  // GET /api/assets/[id] fetches the asset and triggers TwelveLabs analysis.
  if ((req.method === "GET" || req.method === "HEAD") && /^\/api\/assets\/[^/]+(\/.*)?$/.test(path)) return RATE_LIMITS.assetDetail;
  return null;
}

/** Applies the route's limit (if any) to the request's client address; throws RATE_LIMITED when exceeded. */
export async function enforceRateLimit(req: Request, pathname: string, now: number = Date.now()): Promise<void> {
  const rule = await rateLimitRuleFor(req, pathname);
  if (rule) consumeRateLimit(rule, clientAddress(req), now);
}

export function resetRateLimitsForTests(): void {
  windows.clear();
}
