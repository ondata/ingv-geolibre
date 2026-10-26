import { describe, expect, it } from "vitest";
import type { EventFeature } from "../src/ingv/events";
import { barStart, binOf, energyOf, highlighted, italyOffset, magClasses, magClassOf, timeStats } from "../src/ingv/stats";

/** An event at a UTC time (the service's form, no `Z`) and magnitude. */
const ev = (eventId: number, time: string, mag: number): EventFeature =>
  ({ type: "Feature", properties: { eventId, time, mag, magType: "ML", place: "", depth: 10 }, geometry: { type: "Point", coordinates: [14, 38, 10] } }) as unknown as EventFeature;

describe("stats", () => {
  it("knows Italy time in summer and winter", () => {
    expect(italyOffset(new Date("2026-10-20T12:00:00Z"))).toBe(2 * 3600e3);
    expect(italyOffset(new Date("2026-10-26T12:00:00Z"))).toBe(3600e3);
  });

  it("counts per hour over a day, aligned on Italy hours, with the peak", () => {
    const s = timeStats([ev(1, "2026-10-20T08:10:00", 2), ev(2, "2026-10-20T10:05:00", 2), ev(3, "2026-10-20T10:50:00", 3), ev(4, "2026-10-20T20:00:00", 2)])!;
    expect(s.bin).toBe(3600e3);
    expect(new Date(barStart(s, 0)).toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(s.counts).toEqual([1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(s.peak).toBe(2);
  });

  it("takes wider bars for longer spans: at most 60", () => {
    const week = timeStats([ev(1, "2026-10-20T00:00:00", 2), ev(2, "2026-10-26T23:00:00", 2)])!;
    expect(week.bin).toBe(3 * 3600e3);
    expect(week.counts.length).toBeLessThanOrEqual(60);
    const year = timeStats([ev(1, "2025-10-26T00:00:00", 2), ev(2, "2026-10-26T00:00:00", 2)])!;
    expect(year.bin).toBe(168 * 3600e3);
    // Daily bars start at midnight in Italy (22:00 UTC in summer).
    const month = timeStats([ev(1, "2026-09-15T10:00:00", 2), ev(2, "2026-10-20T10:00:00", 2)])!;
    expect(month.bin).toBe(24 * 3600e3);
    expect(new Date(barStart(month, 0)).toISOString()).toBe("2026-09-14T22:00:00.000Z");
  });

  it("keeps bars on Italy's clock across the end of summer time (25 Oct 2026)", () => {
    // 3-hour bars: 12-15 Italy is 10-13 UTC on the 23rd and 11-14 UTC on the 25th.
    const s = timeStats([ev(1, "2026-10-20T00:00:00", 2), ev(2, "2026-10-23T10:30:00", 2), ev(3, "2026-10-25T11:30:00", 2), ev(4, "2026-10-26T23:00:00", 2)])!;
    expect(s.bin).toBe(3 * 3600e3);
    const i23 = binOf(s, "2026-10-23T10:30:00");
    const i25 = binOf(s, "2026-10-25T11:30:00");
    expect(new Date(barStart(s, i23)).toISOString()).toBe("2026-10-23T10:00:00.000Z");
    expect(new Date(barStart(s, i25)).toISOString()).toBe("2026-10-25T11:00:00.000Z");
    expect(binOf(s, "2026-10-25T10:59:00")).toBe(i25 - 1);
  });

  it("puts magnitudes in classes of 0.5", () => {
    expect([2.4, 2.5, 2.9, 3, -0.3].map(magClassOf)).toEqual([2, 2.5, 2.5, 3, -0.5]);
    const c = magClasses([ev(1, "2026-10-20T00:00:00", 2.1), ev(2, "2026-10-20T00:00:00", 2.2), ev(3, "2026-10-20T00:00:00", 4)]);
    expect(c.map((k) => [k.from, k.count])).toEqual([[2, 2], [2.5, 0], [3, 0], [3.5, 0], [4, 1]]);
    expect(c.reduce((s, k) => s + k.energy, 0)).toBeCloseTo(1);
    // One magnitude more is about 32 times the energy.
    expect(energyOf(4) / energyOf(3)).toBeCloseTo(31.62, 1);
    expect(c[4].energy).toBeGreaterThan(0.99);
  });

  it("finds the events of a bar or of a class", () => {
    const f = [ev(1, "2026-10-20T08:10:00", 2.1), ev(2, "2026-10-20T10:05:00", 2.7), ev(3, "2026-10-20T10:50:00", 2.6)];
    const s = timeStats(f);
    expect(highlighted(f, s, { time: 2 }).map((e) => e.properties.eventId)).toEqual([2, 3]);
    expect(highlighted(f, s, { mag: 2.5 }).map((e) => e.properties.eventId)).toEqual([2, 3]);
    expect(timeStats([])).toBeNull();
  });
});
