import { describe, expect, it, vi } from "vitest";
import { faultKind, faultPage, FaultsLayer } from "../src/ingv/faults";
import type { MapLike } from "../src/ingv/host";

describe("capable faults", () => {
  it("groups the catalogue's kinematics", () => {
    const kinds = ["Normal", "Normal Oblique SX", "Oblique Normal DX", "Reverse", "Oblique Reverse DX", "Strike Slip DX", "ND", null].map(faultKind);
    expect(kinds).toEqual(["normal", "normal", "normal", "reverse", "reverse", "strike", "nd", "nd"]);
  });

  it("points the fault page to the host that answers", () => {
    expect(faultPage("http://sgi2.isprambiente.it/ithacaweb/SchedaFaglia.aspx?faultcode=81800")).toBe("https://sgi.isprambiente.it/ithacaweb/SchedaFaglia.aspx?faultcode=81800");
    expect(faultPage(null)).toBeNull();
  });

  function fakeMap(hits: Record<string, { properties: Record<string, unknown> }[]>) {
    const layers: { id: string; before?: string }[] = [];
    const handlers = new Map<string, (e: unknown) => void>();
    const container = document.createElement("div");
    const map = {
      layers,
      container,
      handlers,
      on: (type: string, fn: (e: unknown) => void) => handlers.set(type, fn),
      off: vi.fn(),
      getSource: () => undefined,
      addSource: vi.fn(),
      getLayer: (id: string) => (id === "ingq-results-points" || layers.some((l) => l.id === id) ? {} : undefined),
      addLayer: (l: { id: string }, before?: string) => layers.push({ id: l.id, before }),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      getContainer: () => container,
      queryRenderedFeatures: (_: number[], o: { layers: string[] }) => hits[o.layers[0]] ?? [],
    };
    return map;
  }
  const data = { type: "FeatureCollection" as const, features: [] };
  const fault = { properties: { faultname: "Mt. Lomasone", kind: "reverse", kinematics: "Reverse", rank: "Primary", regionname: "Trentino Alto Adige", url: "http://sgi2.isprambiente.it/ithacaweb/SchedaFaglia.aspx?faultcode=81800" } };

  it("draws under the earthquakes and opens a fault on click", () => {
    const map = fakeMap({ "ingq-faults-hit": [fault] });
    new FaultsLayer(map as unknown as MapLike, data, () => false);
    expect(map.layers.map((l) => l.before)).toEqual(["ingq-results-points", "ingq-results-points"]);
    map.handlers.get("click")!({ point: { x: 10, y: 20 } });
    expect(map.container.textContent).toContain("Mt. Lomasone");
    expect(map.container.querySelector("a")!.getAttribute("href")).toBe("https://sgi.isprambiente.it/ithacaweb/SchedaFaglia.aspx?faultcode=81800");
    map.handlers.get("movestart")!({});
    expect(map.container.children.length).toBe(0);
  });

  it("leaves the click to an earthquake under the pointer", () => {
    const map = fakeMap({ "ingq-faults-hit": [fault], "ingq-results-points": [{ properties: { eventId: 1 } }] });
    new FaultsLayer(map as unknown as MapLike, data, () => false);
    map.handlers.get("click")!({ point: { x: 10, y: 20 } });
    expect(map.container.children.length).toBe(0);
  });
});
