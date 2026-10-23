import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { assertTestAccess } from "./test-auth";

describe("assertTestAccess", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows all requests when secret unset", () => {
    vi.stubEnv("REROUTE_TEST_SECRET", "");
    expect(() => assertTestAccess(new Request("http://localhost/api/test"))).not.toThrow();
  });

  it("rejects missing token when secret set", () => {
    vi.stubEnv("REROUTE_TEST_SECRET", "s3cret");
    expect(() => assertTestAccess(new Request("http://localhost/api/test"))).toThrow(AppError);
  });

  it("accepts Bearer, header, or query token", () => {
    vi.stubEnv("REROUTE_TEST_SECRET", "s3cret");
    expect(() =>
      assertTestAccess(
        new Request("http://localhost/api/test", {
          headers: { Authorization: "Bearer s3cret" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertTestAccess(
        new Request("http://localhost/api/test", {
          headers: { "X-Reroute-Test-Secret": "s3cret" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertTestAccess(new Request("http://localhost/api/test?token=s3cret")),
    ).not.toThrow();
  });
});
