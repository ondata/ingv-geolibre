import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_GUIDANCE, italyToUtc, parseSearchInput, registerAssistantTools } from "../src/ingv/assistant";
import { Controller } from "../src/ingv/controller";
import type { AssistantToolSpec, IngvHost } from "../src/ingv/host";

/** Three events of 2026-10-20..22, M >= 2, captured live on 2026-10-23. */
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/events-3.json"), "utf8"));
const now = new Date("2026-10-24T10:30:00Z");

describe("assistant input", () => {
  it("reads Italy time across summer and winter time", () => {
    expect(italyToUtc("2026-10-24 08:00")).toBe("2026-10-24T06:00Z");
    expect(italyToUtc("2026-12-01T08:00")).toBe("2026-12-01T07:00Z");
    expect(italyToUtc("24/10/2026")).toBeNull();
  });

  it("turns the input into the search of a link", () => {
    const today = parseSearchInput({ time: "today", minMagnitude: 0 }, now).link.search;
    expect([today.time, today.magnitude]).toEqual(["custom", [0, 8]]);
    expect(new Date(today.from).toISOString()).toBe("2026-10-23T22:00:00.000Z");

    const around = parseSearchInput({ area: { lat: 40.85, lon: 14.27, radiusKm: 50 }, order: "magnitude" }, now).link.search;
    expect([around.area, around.centre, around.radiusKm, around.order]).toEqual(["around", { lat: 40.85, lon: 14.27 }, 50, "magnitude"]);

    expect(parseSearchInput({ area: { country: "gr" }, time: "30d" }, now).link.search.country?.name).toBe("Greece");

    const box = parseSearchInput({ area: [12, 36, 16, 39] }, now).link;
    expect([box.search.area, box.box]).toEqual(["view", [12, 36, 16, 39]]);

    const days = parseSearchInput({ from: "2026-10-01", to: "2026-10-02" }, now).link.search;
    expect(new Date(days.to).toISOString()).toBe("2026-10-02T21:59:00.000Z");
  });

  it("refuses input the model can correct", () => {
    expect(() => parseSearchInput({ place: "Napoli" }, now)).toThrow(/Unknown field place/);
    expect(() => parseSearchInput({ minMagnitude: 5, maxMagnitude: 3 }, now)).toThrow(/Not valid: ingvMag=5,3/);
    expect(() => parseSearchInput({ area: "Italy" }, now)).toThrow(/area:/);
    expect(() => parseSearchInput({ area: { country: "XX" } }, now)).toThrow(/ingvCountry=XX/);
    expect(() => parseSearchInput({ time: "7d", from: "2026-10-01" }, now)).toThrow(/time:/);
  });

  it("keeps the guidance short", () => {
    expect(ASSISTANT_GUIDANCE.length).toBeLessThan(4000);
  });
});

describe("assistant tools", () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })));
    const tools = new Map<string, AssistantToolSpec>();
    const map = { once: vi.fn(), flyTo: vi.fn(), getZoom: () => 6, getCenter: () => ({ lng: 12, lat: 42 }) };
    const app = {
      addGeoJsonLayer: vi.fn(),
      getViewBounds: () => [6, 36, 19, 47.5],
      getMap: () => map,
      fitBounds: vi.fn(),
      registerAssistantToolSpec: (spec: AssistantToolSpec) => (tools.set(spec.name, spec), () => tools.delete(spec.name)),
      registerAssistantGuidance: vi.fn(() => () => {}),
    } as unknown as IngvHost;
    const ctl = new Controller(app);
    (ctl as unknown as { resultsLayer: () => null }).resultsLayer = () => null;
    return { app, ctl, tools, dispose: registerAssistantTools(app, ctl) };
  }

  it("searches in the panel and returns what it shows", async () => {
    const { ctl, tools, dispose } = setup();
    expect([...tools.keys()]).toEqual(["search_earthquakes", "open_event", "add_to_layers"]);
    const result = (await tools.get("search_earthquakes")!.callback({ area: { country: "IT" }, order: "magnitude" })) as Record<string, unknown>;
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get("orderby")).toBe("magnitude");
    expect(ctl.search.area).toBe("country");
    expect(result.total).toBe(3);
    expect((result.events as unknown[]).length).toBe(3);
    expect(Object.values(result.byDepthKm as Record<string, number>).reduce((a, b) => a + b)).toBe(3);
    dispose();
    expect(tools.size).toBe(0);
  });

  it("ends at once on Stop", async () => {
    const { tools } = setup();
    const stop = new AbortController();
    stop.abort();
    await expect(tools.get("search_earthquakes")!.callback({}, { signal: stop.signal })).rejects.toThrow("Stopped by the user.");
  });

  it("asks for a search before keeping one", () => {
    const { tools } = setup();
    expect(() => tools.get("add_to_layers")!.callback({})).toThrow(/search_earthquakes first/);
  });

  it("registers nothing on a host without the API", () => {
    const ctl = new Controller({} as IngvHost);
    expect(() => registerAssistantTools({} as IngvHost, ctl)()).not.toThrow();
  });
});
