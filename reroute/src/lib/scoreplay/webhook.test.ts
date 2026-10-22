import { describe, expect, it, afterEach } from "vitest";
import {
  assertWebhookAuthorized,
  eventIdFor,
  extractDeclaredEvent,
  extractMediaId,
  routeEventForPath,
} from "./webhook";
import { AppError } from "@/lib/errors";

describe("scoreplay webhook helpers", () => {
  afterEach(() => {
    delete process.env.SCOREPLAY_WEBHOOK_SECRET;
  });

  it("maps path kinds to ScorePlay event names", () => {
    expect(routeEventForPath("media-create")).toBe("media.create");
    expect(routeEventForPath("media-update")).toBe("media.update");
  });

  it("extracts media id from nested shapes", () => {
    expect(extractMediaId({ media_id: 46000204 })).toBe("46000204");
    expect(extractMediaId({ media: { ID: 99 } })).toBe("99");
    expect(extractMediaId({ data: { media_id: "12" } })).toBe("12");
    expect(extractMediaId({ id: 7 })).toBe("7");
    expect(extractMediaId({})).toBeUndefined();
  });

  it("reads declared event fields", () => {
    expect(extractDeclaredEvent({ event: "media.create" })).toBe("media.create");
    expect(extractDeclaredEvent({ event_type: "media.update" })).toBe("media.update");
  });

  it("prefers event_id for idempotency", () => {
    expect(eventIdFor({ event_id: "evt-1", media_id: 1 }, "{}", "media.create")).toBe("evt-1");
    expect(eventIdFor({ media_id: 1 }, '{"media_id":1}', "media.create")).toMatch(/^media\.create:1:/);
  });

  it("allows open mode when secret unset", () => {
    expect(assertWebhookAuthorized(new Request("http://x", { method: "POST" }))).toEqual({ mode: "open" });
  });

  it("accepts Bearer secret", () => {
    process.env.SCOREPLAY_WEBHOOK_SECRET = "s3cret";
    const req = new Request("http://x", {
      method: "POST",
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(assertWebhookAuthorized(req)).toEqual({ mode: "secret" });
  });

  it("rejects bad secret", () => {
    process.env.SCOREPLAY_WEBHOOK_SECRET = "s3cret";
    const req = new Request("http://x", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    });
    expect(() => assertWebhookAuthorized(req)).toThrow(AppError);
  });
});
