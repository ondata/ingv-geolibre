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
import { Controller, defaultSearch, type SearchState, depthRanges, depthShown, eventsBbox, filterOf, filtersOf, orderEvents, sameBox, sortEvents } from "../src/ingv/controller";
import { depthColor } from "../src/ingv/layer";
import { formatDelay, parseHistory } from "../src/ingv/products";
import { toCsv } from "../src/ingv/format";
import { rangeSlider, snap } from "../src/ingv/range-slider";
import { linkFrom, shareUrl, type Shared } from "../src/ingv/url-params";

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
    expect(open.minMagnitude ?? open.maxMagnitude ?? open.bbox ?? open.circle).toBeUndefined();
    const [one] = filtersOf({ ...base, magnitude: [0, 8], depth: [0, 700], area: "world" }, now, null);
    expect(one.minDepth ?? one.maxDepth).toBeUndefined();
    const italy = COUNTRIES.find((c) => c.code === "IT")!;
    const narrow = filtersOf({ ...base, magnitude: [3, 5.5], depth: [10, 100], area: "country", country: italy }, now, null);
    expect(narrow).toHaveLength(1);
    expect(narrow[0]).toMatchObject({ minMagnitude: 3, maxMagnitude: 5.5, minDepth: 10, maxDepth: 100, bbox: [6.75, 36.62, 18.48, 47.12] });
    const around = filterOf({ ...base, area: "around", centre: { lat: 38.2, lon: 15.6 }, radiusKm: 30 }, now, null);
    expect(params(buildQueryUrl(around))).toMatchObject({ latitude: "38.2", longitude: "15.6", maxradiuskm: "30" });
    // Custom times are local: the query carries them in UTC.
    const custom = filterOf({ ...base, time: "custom", from: "2026-10-01T08:30", to: "2026-10-23T20:34" }, now, null);
    expect(params(buildQueryUrl(custom))).toMatchObject({
      starttime: fdsnTime(new Date(2026, 9, 1, 8, 30)),
      endtime: fdsnTime(new Date(2026, 9, 23, 20, 34)),
    });
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
    expect(addToProject(app, events, "INGV Earthquakes, 7 days, M 2-8")).toBe("layer-1");
    const added = vi.mocked(app.addGeoJsonLayer!).mock.calls[0];
    expect(added[0]).toBe("INGV Earthquakes, 7 days, M 2-8");
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

describe("live zoom", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the searched box while the view is the one live zoom left", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })));
    let view: [number, number, number, number] = [6, 36, 19, 47.5];
    let moveend: (() => void) | null = null;
    const map = { once: (_: string, cb: () => void) => (moveend = cb), flyTo: vi.fn(), getCenter: () => ({ lng: 12, lat: 42 }) };
    const app = {
      addGeoJsonLayer: vi.fn(),
      getViewBounds: () => view,
      getMap: () => map,
      fitBounds: vi.fn((b: [number, number, number, number]) => (view = b)),
    } as unknown as IngvHost;
    const ctl = new Controller(app);
    // No results layer in this test: the map stub has no MapLibre style.
    (ctl as unknown as { resultsLayer: () => null }).resultsLayer = () => null;
    ctl.update({ liveZoom: true });
    await ctl.run();
    expect(app.fitBounds).toHaveBeenCalledTimes(1);
    moveend!();
    await ctl.run();
    const url = String(vi.mocked(fetch).mock.calls[1][0]);
    // The second search uses the first box, not the fitted view.
    expect(new URL(url).searchParams.get("minlongitude")).toBe("6");
    expect(sameBox(view, [6, 36, 19, 47.5])).toBe(false);
  });

  it("lets the centre of Around follow the map until a click fixes it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })));
    let centre = { lng: 15, lat: 38 };
    const map = { once: vi.fn(), flyTo: vi.fn(), getCenter: () => centre };
    const app = { addGeoJsonLayer: vi.fn(), getViewBounds: () => null, getMap: () => map } as unknown as IngvHost;
    const ctl = new Controller(app);
    (ctl as unknown as { resultsLayer: () => null }).resultsLayer = () => null;
    ctl.update({ liveZoom: false });
    const lat = (i: number) => new URL(String(vi.mocked(fetch).mock.calls[i][0])).searchParams.get("latitude");
    ctl.search = { ...ctl.search, area: "around" };
    await ctl.run();
    centre = { lng: 14, lat: 39 };
    await ctl.run();
    ctl.search = { ...ctl.search, centre: { lat: 40, lon: 13 } };
    centre = { lng: 12, lat: 41 };
    await ctl.run();
    expect([lat(0), lat(1), lat(2)]).toEqual(["38", "39", "40"]);
    expect(ctl.search.centre).toEqual({ lat: 40, lon: 13 });
  });
});

describe("depth classes", () => {
  const base = defaultSearch(new Date("2026-10-23T12:00:00Z"));
  const on = (...flags: number[]) => [0, 1, 2, 3].map((i) => flags.includes(i));

  it("joins contiguous classes into one request", () => {
    expect(depthRanges(base)).toEqual([[-Infinity, Infinity]]);
    expect(depthRanges({ ...base, depthOn: on(0, 1) })).toEqual([[-Infinity, 30]]);
    expect(depthRanges({ ...base, depthOn: on(1, 2) })).toEqual([[10, 100]]);
  });

  it("asks one request per run of classes, cut to the slider", () => {
    expect(depthRanges({ ...base, depthOn: on(0, 3) })).toEqual([[-Infinity, 10], [100, Infinity]]);
    expect(depthRanges({ ...base, depthOn: on(0, 3), depth: [5, 300] })).toEqual([[5, 10], [100, 300]]);
    expect(depthRanges({ ...base, depthOn: on(3), depth: [0, 50] })).toEqual([]);
    expect(depthRanges({ ...base, depthOn: on() })).toEqual([]);
  });

  it("keeps an event in its own class only", () => {
    const s = { ...base, depthOn: on(0) };
    expect([depthShown(s, -1), depthShown(s, 9.9), depthShown(s, 10)]).toEqual([true, true, false]);
  });

  it("orders merged results as the service does", () => {
    const features = normalizeEvents(fixture).features;
    expect(orderEvents(features, "magnitude").map((f) => f.properties.mag)).toEqual([7, 3.1, 2.4]);
    expect(orderEvents(features, "magnitude-asc").map((f) => f.properties.mag)).toEqual([2.4, 3.1, 7]);
  });
});

describe("hidden depth classes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("counts what the classes turned off hide", async () => {
    // The fixture's depths are 5.5, 25.4 and 9 km: all in the two shallow classes.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })));
    const app = { addGeoJsonLayer: vi.fn(), getViewBounds: () => null } as unknown as IngvHost;
    const ctl = new Controller(app);
    ctl.search = { ...ctl.search, depthOn: [false, false, true, true] };
    await ctl.run();
    expect(ctl.state.events!.features).toHaveLength(0);
    expect(ctl.hiddenNote()).toBe("3 in hidden depth classes");
    // With every class on there is nothing hidden, and no second request.
    vi.mocked(fetch).mockClear();
    ctl.search = { ...ctl.search, depthOn: [true, true, true, true] };
    await ctl.run();
    expect(ctl.hiddenNote()).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("range slider", () => {
  /** A slider 160 px wide on the 0-8 magnitude scale: 20 px per unit. */
  function slider(initial: [number, number]) {
    const onChange = vi.fn();
    const s = rangeSlider({ min: 0, max: 8, step: 0.5 }, initial, () => {}, onChange);
    s.element.getBoundingClientRect = () => ({ left: 0, width: 160 }) as DOMRect;
    s.element.querySelectorAll<HTMLElement>(".ingq-range-handle").forEach((h) => (h.setPointerCapture = () => {}));
    const press = (x: number) => {
      s.element.dispatchEvent(new MouseEvent("pointerdown", { clientX: x, bubbles: true }));
      s.element.querySelectorAll(".ingq-range-handle").forEach((h) => h.dispatchEvent(new MouseEvent("pointerup")));
    };
    return { s, onChange, press };
  }

  it("moves the nearer handle to a press on the line", () => {
    const { s, onChange, press } = slider([2, 8]);
    press(20); // M 1, below the low handle
    expect(s.get()).toEqual([1, 8]);
    press(100); // M 5: 4 from the low handle, 3 from the high one
    expect(s.get()).toEqual([1, 5]);
    press(60); // M 3, 2 from 1 and 2 from 5: the low handle
    expect(s.get()).toEqual([3, 5]);
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});

describe("share links", () => {
  afterEach(() => vi.unstubAllGlobals());
  const now = new Date("2026-10-23T12:00:00Z");
  const shared = (search: Partial<SearchState>, extra: Partial<Shared> = {}): Shared => ({
    search: { ...defaultSearch(now), ...search },
    box: null,
    centre: null,
    eventId: null,
    liveZoom: true,
    view: null,
    ...extra,
  });

  it("writes only what is not at its default", () => {
    const url = new URL(shareUrl(shared({}, { box: [6, 36, 19, 47.5] })));
    expect(Object.fromEntries(url.searchParams)).toEqual({ plugin: "ingv-geolibre", ingvBox: "6,36,19,47.5" });
  });

  it("reads back the search it wrote", () => {
    const italy = COUNTRIES.find((c) => c.code === "IT")!;
    const cases: [Partial<SearchState>, Partial<Shared>][] = [
      [{ time: "24h", magnitude: [3, 8], depth: [0, 300], depthOn: [true, false, true, false], order: "magnitude", limit: 50, area: "world" }, {}],
      [{ area: "country", country: italy }, {}],
      [{ area: "around", radiusKm: 50 }, { centre: { lat: 38.1234, lon: 15.5 } }],
      [{ time: "custom", from: "2026-10-01T08:30", to: "2026-10-02T20:15" }, { eventId: 47616612, liveZoom: false }],
    ];
    for (const [search, extra] of cases) {
      const s = shared(search, extra);
      const link = linkFrom(new URL(shareUrl(s)).searchParams, now)!;
      expect(link.search).toEqual({ ...s.search, centre: s.search.centre ?? s.centre });
      expect(link.eventId).toBe(s.eventId);
      expect(link.liveZoom).toBe(s.liveZoom ? null : false);
    }
  });

  it("ignores values that are not valid and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const link = linkFrom(new URLSearchParams("ingvTime=2w&ingvMag=5,3&ingvArea=world&ingvLimit=-1&ingvCountry=XX"), now)!;
    expect(link.search).toEqual({ ...defaultSearch(now), area: "world" });
    expect(warn).toHaveBeenCalledTimes(4);
    expect(linkFrom(new URLSearchParams("lat=40&lon=12"), now)).toBeNull();
    warn.mockRestore();
  });

  it("searches the shared box, not the wider screen around it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })));
    const map = { once: vi.fn(), flyTo: vi.fn(), getCenter: () => ({ lng: 12, lat: 42 }), getZoom: () => 5 };
    const app = { addGeoJsonLayer: vi.fn(), getViewBounds: () => [0, 30, 25, 50], getMap: () => map, fitBounds: vi.fn() } as unknown as IngvHost;
    const ctl = new Controller(app);
    (ctl as unknown as { resultsLayer: () => null }).resultsLayer = () => null;
    await ctl.followLink(linkFrom(new URLSearchParams("ingvBox=6,36,19,47.5&ingvLive=0"), now)!);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get("minlongitude")).toBe("6");
    expect(app.fitBounds).toHaveBeenCalledWith([6, 36, 19, 47.5]);
    expect(ctl.shared().box).toEqual([6, 36, 19, 47.5]);
  });
});
