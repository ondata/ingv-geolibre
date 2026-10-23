import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorText, fetchEvents, normalizeEvents } from "../src/ingv/events";
import type { IngvHost } from "../src/ingv/host";
import { addToProject, DEPTH_CLASSES, eventsStyle } from "../src/ingv/layer";
import { ResultsLayer } from "../src/ingv/results-layer";
import type { MapLike } from "../src/ingv/host";
import { buildQueryUrl, fdsnTime } from "../src/ingv/query";
import { COUNTRIES, matchCountries } from "../src/ingv/countries";
import { defaultSearch, eventsBbox, filterOf, sortEvents } from "../src/ingv/controller";
import { depthColor } from "../src/ingv/layer";
import { formatDelay, parseHistory } from "../src/ingv/products";
import { toCsv } from "../src/ingv/format";
import { snap } from "../src/ingv/range-slider";

/** Three events of 2026-10-20..22, M >= 2, captured live on 2026-10-23. */
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/events-3.json"), "utf8"));

const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe("query", () => {
  it("formats times as the service wants them", () => {
    expect(fdsnTime(new Date("2026-10-23T17:05:09.123Z"))).toBe("2026-10-23T17:05:09");
  });

  it("builds the default search", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    const url = buildQueryUrl(filterOf(defaultSearch(now), now, [6, 36, 19, 47.5]));
    expect(url.startsWith("https://webservices.ingv.it/fdsnws/event/1/query?")).toBe(true);
    expect(params(url)).toEqual({
      format: "geojson",
      starttime: "2026-10-16T12:00:00",
      minmagnitude: "2",
      minlatitude: "36",
      maxlatitude: "47.5",
      minlongitude: "6",
      maxlongitude: "19",
      orderby: "time",
      limit: "1000",
    });
  });

  it("reads the panel state into a filter", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    const base = defaultSearch(now);
    // Handles at the ends of their scales set no limit.
    const open = filterOf({ ...base, magnitude: [0, 8], depth: [0, 700], area: "world" }, now, [0, 0, 1, 1]);
    expect(open).toMatchObject({ orderBy: "time", limit: 1000 });
    expect(open.minMagnitude ?? open.maxMagnitude ?? open.minDepth ?? open.maxDepth ?? open.bbox ?? open.circle).toBeUndefined();
    const italy = COUNTRIES.find((c) => c.code === "IT")!;
    const narrow = filterOf({ ...base, magnitude: [3, 5.5], depth: [10, 100], area: "country", country: italy }, now, null);
    expect(narrow).toMatchObject({ minMagnitude: 3, maxMagnitude: 5.5, minDepth: 10, maxDepth: 100, bbox: [6.75, 36.62, 18.48, 47.12] });
    const around = filterOf({ ...base, area: "around", centre: { lat: 38.2, lon: 15.6 }, radiusKm: 30 }, now, null);
    expect(params(buildQueryUrl(around))).toMatchObject({ latitude: "38.2", longitude: "15.6", maxradiuskm: "30" });
    const custom = filterOf({ ...base, time: "custom", from: "2026-10-01", to: "2026-10-23" }, now, null);
    expect(params(buildQueryUrl(custom))).toMatchObject({ starttime: "2026-10-01T00:00:00", endtime: "2026-10-24T00:00:00" });
  });

  it("sends every filter it is given", () => {
    const url = buildQueryUrl({
      start: new Date("2026-01-01T00:00:00Z"),
      end: new Date("2026-02-01T00:00:00Z"),
      minMagnitude: 3,
      maxMagnitude: 5.5,
      minDepth: 0,
      maxDepth: 30,
      orderBy: "magnitude",
      limit: 100,
    });
    expect(params(url)).toMatchObject({
      endtime: "2026-02-01T00:00:00",
      maxmagnitude: "5.5",
      mindepth: "0",
      maxdepth: "30",
      orderby: "magnitude",
      limit: "100",
    });
    expect(params(url).minlatitude).toBeUndefined();
  });

  it("keeps a zoomed-out view inside the world", () => {
    const url = buildQueryUrl({ start: new Date(0), bbox: [-250, -95, 300, 95] });
    expect(params(url)).toMatchObject({ minlongitude: "-180", maxlongitude: "180", minlatitude: "-90", maxlatitude: "90" });
  });
});

describe("events", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("copies the depth into the properties", () => {
    const events = normalizeEvents(fixture);
    expect(events.features).toHaveLength(3);
    const first = events.features[0];
    expect(first.properties.depth).toBe(first.geometry.coordinates[2]);
    expect(first.properties).not.toHaveProperty("geojson_creationTime");
    expect(first.properties).toMatchObject({ eventId: 47600972, mag: 7, place: "China [Land]" });
    expect(first.properties.description).toBe(
      '<a href="https://terremoti.ingv.it/event/47600972">terremoti.ingv.it/event/47600972</a>',
    );
  });

  it("refuses an answer that is not GeoJSON", () => {
    expect(() => normalizeEvents("<html>")).toThrow(/not GeoJSON/);
  });

  it("reads a 204 as no events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(fetchEvents("https://x")).resolves.toEqual({ type: "FeatureCollection", features: [] });
  });

  it("reports the service's error text", async () => {
    // The body of a real 400 of 2026-10-23.
    const body = 'Error 400\n\nBad Request: \n "starttime" must be YYYY-MM-DDThh:mm:ss (your value=bad)\n\nRequest: \n http://webservices.ingv.it//query?starttime=bad\n';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 400 })));
    await expect(fetchEvents("https://x")).rejects.toThrow(
      'The INGV service answered 400: Bad Request: "starttime" must be YYYY-MM-DDThh:mm:ss (your value=bad)',
    );
    expect(errorText("Error 500 Oops")).toBe("Oops");
  });
});

describe("layer", () => {
  it("colours by depth class and sizes by magnitude", () => {
    const paint = JSON.parse(eventsStyle()).layers[0].paint;
    expect(paint["circle-color"]).toEqual([
      "step", ["to-number", ["get", "depth"], 0], "#dc2626",
      10, "#f59e0b", 30, "#60a5fa", 100, "#1d4ed8",
    ]);
    expect(paint["circle-color"].length).toBe(3 + 2 * (DEPTH_CLASSES.length - 1));
    expect(paint["circle-radius"]).toEqual(["interpolate", ["linear"], ["to-number", ["get", "mag"], 2], 2, 3, 6, 18]);
  });

  it("keeps a search in the project as a styled layer", () => {
    const events = normalizeEvents(fixture);
    const app = {
      addGeoJsonLayer: vi.fn(() => "layer-1"),
      importLayerStyle: vi.fn(() => ({ ok: true, warnings: [] })),
    } as unknown as IngvHost;
    expect(addToProject(app, events, "INGV earthquakes, 7 days, M 2-8")).toBe("layer-1");
    const added = vi.mocked(app.addGeoJsonLayer!).mock.calls[0];
    expect(added[0]).toBe("INGV earthquakes, 7 days, M 2-8");
    const mags = (added[1] as typeof events).features.map((f) => f.properties.mag);
    expect(mags).toEqual([...mags].sort((a, b) => b - a));
    expect(app.importLayerStyle).toHaveBeenCalledWith("layer-1", eventsStyle());
  });
});

describe("detail", () => {
  /** The QuakeML of event 47612622 (M 4.1, 2026-10-23), captured live and trimmed to the fields read. */
  const quakeMl = readFileSync(join(__dirname, "fixtures/quakeml-47612622.xml"), "utf8");

  it("reads the magnitudes over time", () => {
    const rows = parseHistory(quakeMl);
    expect(rows.map((r) => [formatDelay(r.delay), r.automatic, r.preferred, r.magnitude, r.magType, r.depth])).toEqual([
      ["+1:12", true, false, 4.8, "ML", 23.35],
      ["+1:51", true, false, 4.7, "ML", 22.73],
      ["+3:41", true, false, 4.2, "ML", 7.44],
      ["+14:27", false, true, 4.1, "ML", 7.4],
    ]);
  });

  it("formats delays past an hour", () => {
    expect(formatDelay(3725)).toBe("+1:02:05");
  });
});

describe("helpers", () => {
  it("colours depth classes", () => {
    expect([0, 9.9, 10, 29, 30, 99, 100, 600].map(depthColor)).toEqual([
      "#dc2626", "#dc2626", "#f59e0b", "#f59e0b", "#60a5fa", "#60a5fa", "#1d4ed8", "#1d4ed8",
    ]);
  });

  it("snaps slider values", () => {
    const scale = { min: 0, max: 8, step: 0.5 };
    expect([snap(2.26, scale), snap(-1, scale), snap(9, scale)]).toEqual([2.5, 0, 8]);
  });

  it("boxes the events for Zoom to results", () => {
    const features = normalizeEvents(fixture).features;
    const lons = features.map((f) => f.geometry.coordinates[0]);
    const lats = features.map((f) => f.geometry.coordinates[1]);
    expect(eventsBbox(features)).toEqual([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);
    expect(eventsBbox([])).toBeNull();
  });

  it("sorts the table", () => {
    const features = normalizeEvents(fixture).features;
    expect(sortEvents(features, { key: "mag", dir: -1 }).map((f) => f.properties.mag)).toEqual([7, 3.1, 2.4]);
    expect(sortEvents(features, { key: "time", dir: 1 }).map((f) => f.properties.time)).toEqual(
      features.map((f) => f.properties.time).sort(),
    );
  });

  it("writes CSV with times in UTC and Italy", () => {
    const csv = toCsv(normalizeEvents(fixture).features.slice(0, 1)).split("\n");
    expect(csv[0]).toBe("eventId,time_utc,time_italy,magnitude,magType,depth_km,latitude,longitude,place,url");
    expect(csv[1]).toBe(
      "47600972,2026-10-22 14:33:40,2026-10-22 16:33:40,7,Mwp,5.5,32.3367,93.8768,China [Land],https://terremoti.ingv.it/event/47600972",
    );
  });
});

describe("countries", () => {
  it("finds countries by name, accents and case aside, or by code", () => {
    expect(COUNTRIES).toHaveLength(173);
    expect(matchCountries("ital").map((c) => c.code)).toEqual(["IT"]);
    expect(matchCountries("gr")[0].name).toBe("Greece");
    expect(matchCountries("jp").map((c) => c.name)).toEqual(["Japan"]);
    expect(matchCountries("zzz")).toEqual([]);
  });
});

describe("results layer", () => {
  /** A MapLibre map reduced to what the layer calls. */
  function fakeMap() {
    const sources = new Map<string, { data: unknown; setData(d: unknown): void }>();
    const layers = new Map<string, { filter?: unknown }>();
    const handlers: [string, ...unknown[]][] = [];
    const map = {
      sources,
      layers,
      handlers,
      on: (...args: [string, ...unknown[]]) => handlers.push(args),
      off: vi.fn(),
      getCanvas: () => document.createElement("canvas"),
      addSource: (id: string, s: { data: unknown }) =>
        sources.set(id, { data: s.data, setData(d) { this.data = d; } }),
      getSource: (id: string) => sources.get(id),
      addLayer: (l: { id: string; filter?: unknown }) => layers.set(l.id, { filter: l.filter }),
      getLayer: (id: string) => layers.get(id),
      getLayersOrder: () => [...layers.keys()],
      moveLayer: vi.fn(),
      setFilter: (id: string, f: unknown) => (layers.get(id)!.filter = f),
      removeLayer: (id: string) => layers.delete(id),
      removeSource: (id: string) => sources.delete(id),
    };
    return map;
  }

  it("replaces the points on every search instead of adding layers", () => {
    const map = fakeMap();
    const layer = new ResultsLayer(map as unknown as MapLike, () => {}, () => false);
    const events = normalizeEvents(fixture);
    layer.setData(events);
    layer.setData({ ...events, features: events.features.slice(0, 1) });
    expect([...map.layers.keys()]).toEqual(["ingq-results-points", "ingq-results-ring"]);
    expect((map.sources.get("ingq-results")!.data as typeof events).features).toHaveLength(1);
  });

  it("rings one event and comes back after a basemap change", () => {
    const map = fakeMap();
    const layer = new ResultsLayer(map as unknown as MapLike, () => {}, () => false);
    layer.setData(normalizeEvents(fixture));
    layer.setRing(47600972);
    expect(map.layers.get("ingq-results-ring")!.filter).toEqual(["==", ["get", "eventId"], 47600972]);
    // A new basemap drops the plugin's layers; `styledata` adds them back.
    map.layers.clear();
    map.sources.clear();
    (map.handlers.find((h) => h[0] === "styledata")![1] as () => void)();
    expect(map.layers.size).toBe(2);
    layer.dispose();
    expect(map.layers.size).toBe(0);
  });

  it("opens the clicked event, unless a host tool owns the clicks", () => {
    const map = fakeMap();
    const onSelect = vi.fn();
    let tool = false;
    const layer = new ResultsLayer(map as unknown as MapLike, onSelect, () => tool);
    layer.setData(normalizeEvents(fixture));
    const click = map.handlers.find((h) => h[0] === "click")![2] as (e: unknown) => void;
    click({ features: [{ properties: { eventId: 47600972 } }] });
    expect(onSelect).toHaveBeenCalledTimes(1);
    tool = true;
    click({ features: [{ properties: { eventId: 47600972 } }] });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
