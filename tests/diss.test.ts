import { describe, expect, it, vi } from "vitest";
import { DissLayer } from "../src/ingv/diss";
import type { MapLike } from "../src/ingv/host";

/** A map with the earthquakes' layer and, optionally, ISPRA's faults; `hits` answers queryRenderedFeatures by layer. */
function fakeMap(hits: Record<string, { properties: Record<string, unknown> }[]>, withFaults = false) {
  const layers: { id: string; before?: string }[] = [];
  const handlers = new Map<string, (e: unknown) => void>();
  const container = document.createElement("div");
  const present = new Set(["ingq-results-points", ...(withFaults ? ["ingq-faults-lines", "ingq-faults-hit"] : [])]);
  return {
    layers,
    container,
    handlers,
    on: (type: string, fn: (e: unknown) => void) => handlers.set(type, fn),
    off: vi.fn(),
    getSource: () => undefined,
    addSource: vi.fn(),
    getLayer: (id: string) => (present.has(id) || layers.some((l) => l.id === id) ? {} : undefined),
    addLayer: (l: { id: string }, before?: string) => layers.push({ id: l.id, before }),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    getContainer: () => container,
    queryRenderedFeatures: (_: number[], o: { layers: string[] }) => o.layers.flatMap((id) => hits[id] ?? []),
  };
}
const empty = { type: "FeatureCollection" as const, features: [] };
const data = { iss: empty, cssPlanes: empty, cssTop: empty };
const iss = {
  properties: { idsource: "ITIS050", sourcename: "Colfiorito", mindepth: 1, maxdepth: 6.5, srmin: 0.1, srmax: 1, maxmag: 6, latesteq: "26 Sep 1997", linktoinfo: "https://diss.ingv.it/diss331/sources.php?ITIS050" },
};

describe("DISS seismogenic sources", () => {
  it("draws under the faults when they are on, else under the earthquakes", () => {
    const withFaults = fakeMap({}, true);
    new DissLayer(withFaults as unknown as MapLike, data, () => false);
    expect(new Set(withFaults.layers.map((l) => l.before))).toEqual(new Set(["ingq-faults-lines"]));
    const alone = fakeMap({});
    new DissLayer(alone as unknown as MapLike, data, () => false);
    expect(new Set(alone.layers.map((l) => l.before))).toEqual(new Set(["ingq-results-points"]));
  });

  it("shows a source on click, with its numbers and page", () => {
    const map = fakeMap({ "ingq-diss-iss-fill": [iss] });
    new DissLayer(map as unknown as MapLike, data, () => false);
    map.handlers.get("click")!({ point: { x: 5, y: 5 } });
    const text = map.container.textContent!;
    for (const part of ["Colfiorito", "Individual source · ITIS050", "Max magnitude 6.0", "Depth 1-6.5 km", "Slip rate 0.1-1 mm/yr", "26 Sep 1997"]) expect(text).toContain(part);
    expect(map.container.querySelector("a")!.getAttribute("href")).toBe("https://diss.ingv.it/diss331/sources.php?ITIS050");
  });

  it("leaves the click to a fault or an earthquake drawn above", () => {
    const map = fakeMap({ "ingq-diss-iss-fill": [iss], "ingq-faults-hit": [{ properties: {} }] }, true);
    new DissLayer(map as unknown as MapLike, data, () => false);
    map.handlers.get("click")!({ point: { x: 5, y: 5 } });
    expect(map.container.children.length).toBe(0);
  });
});
