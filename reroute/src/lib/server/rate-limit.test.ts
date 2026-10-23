import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { RATE_LIMITS, clientAddress, consumeRateLimit, enforceRateLimit, rateLimitRuleFor, resetRateLimitsForTests } from "./rate-limit";

afterEach(() => resetRateLimitsForTests());

const req = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new Request(`http://localhost:3000${path}`, {
    method: init.method ?? "POST",
    headers: init.headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });

function limited(fn: () => void): AppError | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
}

describe("consumeRateLimit", () => {
  const rule = { name: "t", limit: 3, windowMs: 60_000 };

  it("allows `limit` requests per window, then RATE_LIMITED with Retry-After, then resets", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(limited(() => consumeRateLimit(rule, "a", t0 + i))).toBeNull();
    const err = limited(() => consumeRateLimit(rule, "a", t0 + 20_000));
    expect(err).toMatchObject({ code: "RATE_LIMITED", headers: { "Retry-After": "40" } });
    // Other addresses and other rules have their own windows.
    expect(limited(() => consumeRateLimit(rule, "b", t0 + 20_000))).toBeNull();
    expect(limited(() => consumeRateLimit({ ...rule, name: "u" }, "a", t0 + 20_000))).toBeNull();
    // The window ends.
    expect(limited(() => consumeRateLimit(rule, "a", t0 + 60_000))).toBeNull();
  });
});

describe("clientAddress", () => {
  it("uses the first hop of x-real-ip, then x-forwarded-for", () => {
    expect(clientAddress(req("/", { headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" } }))).toBe("203.0.113.7");
    expect(clientAddress(req("/", { headers: { "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" } }))).toBe("198.51.100.1");
    expect(clientAddress(req("/"))).toBe("unknown");
  });
});

describe("rateLimitRuleFor", () => {
  it.each([
    ["POST", "/api/pulse/goal", { action: "run", goal: "x" }, RATE_LIMITS.goalRun],
    ["POST", "/api/pulse/goal/", { action: "select", id: "g" }, RATE_LIMITS.goalAction],
    ["POST", "/api/pulse/goal", "{not json", RATE_LIMITS.goalAction],
    ["POST", "/api/resolve", {}, RATE_LIMITS.rights],
    ["POST", "/api/decide", {}, RATE_LIMITS.rights],
    ["POST", "/api/access", {}, RATE_LIMITS.rights],
    ["POST", "/api/auth/session", {}, RATE_LIMITS.signIn],
    ["GET", "/api/assets/101", undefined, RATE_LIMITS.assetDetail],
    ["GET", "/api/assets", undefined, null],
    ["GET", "/api/auth/session", undefined, null],
    ["DELETE", "/api/auth/session", undefined, null],
    ["POST", "/api/receipts", {}, null],
    ["GET", "/api/pulse/goal", undefined, null],
  ])("%s %s → %o", async (method, path, body, rule) => {
    expect(await rateLimitRuleFor(req(path, { method, body }), path)).toEqual(rule);
  });

  it("leaves the body readable for the route", async () => {
    const r = req("/api/pulse/goal", { body: { action: "run", goal: "x" } });
    await rateLimitRuleFor(r, "/api/pulse/goal");
    expect(await r.json()).toEqual({ action: "run", goal: "x" });
  });
});

describe("enforceRateLimit", () => {
  it("limits goal runs at 10/min per address, independently of other goal actions", async () => {
    const run = () => req("/api/pulse/goal", { body: { action: "run", goal: "x" }, headers: { "x-real-ip": "203.0.113.7" } });
    const t0 = 5_000_000;
    for (let i = 0; i < 10; i++) await enforceRateLimit(run(), "/api/pulse/goal", t0);
    await expect(enforceRateLimit(run(), "/api/pulse/goal", t0)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const select = req("/api/pulse/goal", { body: { action: "select" }, headers: { "x-real-ip": "203.0.113.7" } });
    await expect(enforceRateLimit(select, "/api/pulse/goal", t0)).resolves.toBeUndefined();
    await expect(enforceRateLimit(run(), "/api/pulse/goal", t0 + 60_000)).resolves.toBeUndefined();
  });
});
