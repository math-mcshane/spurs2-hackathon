import { describe, expect, it } from "vitest";
import { nextWeekendPublishAt, parseDiscoveryQuery } from "./parse";

describe("parseDiscoveryQuery", () => {
  it("parses Nike last-night weekend photo intent for Spurs", () => {
    const d = parseDiscoveryQuery(
      "photos for our Nike partner from last nights game we can post this weekend",
      "SAS",
    );
    expect(d.clubCode).toBe("SAS");
    expect(d.partnerSlug).toBe("nike");
    expect(d.lastNight).toBe(true);
    expect(d.weekendPublish).toBe(true);
    expect(d.mediaKind).toBe("photo");
    expect(d.eventLabel).toBe("last_night_game");
  });

  it("infers Tottenham from query text", () => {
    const d = parseDiscoveryQuery("Tottenham Nike partner clip from last game");
    expect(d.clubCode).toBe("TOT");
    expect(d.partnerSlug).toBe("nike");
  });
});

describe("nextWeekendPublishAt", () => {
  it("returns an ISO timestamp", () => {
    expect(nextWeekendPublishAt(new Date("2026-10-22T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
