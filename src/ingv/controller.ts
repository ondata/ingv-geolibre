import type { Country } from "./countries";
import { fetchEvents, type EventCollection, type EventFeature } from "./events";
import type { IngvHost, Padding } from "./host";
import { addToProject, DEPTH_CLASSES, LAYER_NAME } from "./layer";
import { ResultsLayer } from "./results-layer";
import {
  buildQueryUrl,
  DEFAULT_LIMIT,
  DEFAULT_MAGNITUDE,
  DEFAULT_TIME,
  DEPTH_SCALE,
  MAGNITUDE_SCALE,
  presetStart,
  TIME_PRESETS,
  type Bbox,
  type EventFilter,
  type OrderBy,
  type TimePresetId,
} from "./query";

export type Area = "view" | "around" | "world" | "country";
export type SortKey = "time" | "mag" | "depth";

export interface SearchState {
  time: TimePresetId;
  /** `YYYY-MM-DDThh:mm` in local time, for the custom period. */
  from: string;
  to: string;
  magnitude: [number, number];
  depth: [number, number];
  /** One flag per depth class of the legend: false hides the class. */
  depthOn: boolean[];
  area: Area;
  centre: { lat: number; lon: number } | null;
  country: Country | null;
  radiusKm: number;
  order: OrderBy;
  limit: number;
}

export interface ViewState {
  status: "idle" | "loading" | "done" | "error";
  message: string;
  events: EventCollection | null;
  view: "search" | "detail";
  selected: EventFeature | null;
  hover: number | null;
  /** Events of the search in the depth classes turned off, null when all are on; capped at the limit. */
  hiddenCount: number | null;
  tableOpen: boolean;
  /** Fit the map to the results after every search. */
  liveZoom: boolean;
  sort: { key: SortKey; dir: 1 | -1 };
}

/** `YYYY-MM-DDThh:mm` of a date in local time, the value of a datetime-local field. */
export function localMinute(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The filter of the panel state without depth; `now` and the view bounds come from outside. */
export function filterOf(s: SearchState, now: Date, viewBounds: [number, number, number, number] | null): EventFilter {
  // A datetime-local value has no zone and is read as local time; the query is in UTC.
  const filter: EventFilter = s.time === "custom" ? { start: new Date(s.from), end: new Date(s.to) } : { start: presetStart(s.time, now) };
  // A handle at the end of its scale means no limit on that side.
  if (s.magnitude[0] > MAGNITUDE_SCALE.min) filter.minMagnitude = s.magnitude[0];
  if (s.magnitude[1] < MAGNITUDE_SCALE.max) filter.maxMagnitude = s.magnitude[1];
  if (s.area === "view" && viewBounds) filter.bbox = viewBounds;
  // A country across the 180° meridian has a box of every longitude: its latitude band.
  if (s.area === "country" && s.country) filter.bbox = s.country.bbox;
  if (s.area === "around" && s.centre) filter.circle = { ...s.centre, radiusKm: s.radiusKm };
  filter.orderBy = s.order;
  filter.limit = s.limit;
  return filter;
}

/** The depth bounds of the slider; an end of the scale is no bound. */
function sliderBounds(s: SearchState): [number, number] {
  return [s.depth[0] > DEPTH_SCALE.min ? s.depth[0] : -Infinity, s.depth[1] < DEPTH_SCALE.max ? s.depth[1] : Infinity];
}

/** Bounds of each legend class: the first takes the depths above sea level too, the last has no floor. */
function classBounds(i: number): [number, number] {
  return [i === 0 ? -Infinity : DEPTH_CLASSES[i].from, DEPTH_CLASSES[i + 1]?.from ?? Infinity];
}

/**
 * The depth ranges to query: the service takes one range per request, so the
 * shown classes are joined into contiguous runs, each cut to the slider.
 * "0-10" and ">100" without the classes between are two requests.
 */
export function depthRanges(s: SearchState): [number, number][] {
  const [lo, hi] = sliderBounds(s);
  const runs: [number, number][] = [];
  DEPTH_CLASSES.forEach((_, i) => {
    if (!s.depthOn[i]) return;
    const [from, to] = classBounds(i);
    const last = runs[runs.length - 1];
    if (last && s.depthOn[i - 1]) last[1] = to;
    else runs.push([from, to]);
  });
  return runs.map(([from, to]): [number, number] => [Math.max(from, lo), Math.min(to, hi)]).filter(([from, to]) => from <= to);
}

/** The requests of a search: one per depth range, none when every class is hidden. */
export function filtersOf(s: SearchState, now: Date, viewBounds: [number, number, number, number] | null): EventFilter[] {
  const base = filterOf(s, now, viewBounds);
  return depthRanges(s).map(([from, to]) => ({
    ...base,
    ...(Number.isFinite(from) ? { minDepth: from } : {}),
    ...(Number.isFinite(to) ? { maxDepth: to } : {}),
  }));
}

/**
 * Whether an event belongs to the search's depth: the service's bounds are
 * inclusive, so an event at exactly 10 km comes back from the "0-10" request
 * too, though the legend puts it in "10-30".
 */
export function depthShown(s: SearchState, depth: number): boolean {
  const [lo, hi] = sliderBounds(s);
  const i = DEPTH_CLASSES.findIndex((_, k) => {
    const [from, to] = classBounds(k);
    return depth >= from && depth < to;
  });
  return s.depthOn[i] && depth >= lo && depth <= hi;
}

/** Order merged results as the service would have. */
export function orderEvents(features: EventFeature[], order: OrderBy): EventFeature[] {
  const key = (f: EventFeature) => (order.startsWith("time") ? Date.parse(f.properties.time) : f.properties.mag);
  const dir = order.endsWith("-asc") ? 1 : -1;
  return [...features].sort((a, b) => (key(a) - key(b)) * dir);
}

export function defaultSearch(now: Date): SearchState {
  return {
    time: DEFAULT_TIME,
    from: `${localMinute(new Date(now.getTime() - 30 * 86_400_000)).slice(0, 10)}T00:00`,
    to: localMinute(now),
    magnitude: [...DEFAULT_MAGNITUDE],
    depth: [DEPTH_SCALE.min, DEPTH_SCALE.max],
    depthOn: DEPTH_CLASSES.map(() => true),
    area: "view",
    centre: null,
    country: null,
    radiusKm: 30,
    order: "time",
    limit: DEFAULT_LIMIT,
  };
}

/** Two view boxes equal up to rounding. */
export const sameBox = (a: Bbox, b: Bbox) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

/** The box around the events, or null when there are none. */
export function eventsBbox(features: EventFeature[]): [number, number, number, number] | null {
  if (!features.length) return null;
  const lons = features.map((f) => f.geometry.coordinates[0]);
  const lats = features.map((f) => f.geometry.coordinates[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/** Sort the events for the table. */
export function sortEvents(features: EventFeature[], sort: ViewState["sort"]): EventFeature[] {
  const key = (f: EventFeature) =>
    sort.key === "time" ? Date.parse(f.properties.time) : sort.key === "mag" ? f.properties.mag : f.properties.depth;
  return [...features].sort((a, b) => (key(a) - key(b)) * sort.dir);
}

/**
 * The plugin's state, shared by the right panel and the results table: the
 * search, its result, the selected event. Views subscribe and re-render.
 */
export class Controller {
  search: SearchState = defaultSearch(new Date());
  state: ViewState = {
    status: "idle",
    message: "",
    events: null,
    view: "search",
    selected: null,
    hover: null,
    hiddenCount: null,
    tableOpen: false,
    liveZoom: true,
    sort: { key: "time", dir: -1 },
  };
  private listeners = new Set<() => void>();
  private results: ResultsLayer | null = null;
  /** The map view a live zoom left, and the box searched before it. */
  private liveFit: { view: Bbox; searched: Bbox | null } | null = null;
  private running: AbortController | null = null;
  /** The panel's root, set by `renderPanel`: on a phone it covers part of the map. */
  panelElement: HTMLElement | null = null;
  /** The centre the last "Around" search used; the panel shows it. */
  usedCentre: SearchState["centre"] = null;
  /** Opens the results table; set by the plugin entry, which owns the floating panel. */
  openTable: () => void = () => {};
  closeTable: () => void = () => {};

  constructor(readonly app: IngvHost) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  update(patch: Partial<ViewState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** Change the search and run it. */
  set(patch: Partial<SearchState>, run = true) {
    this.search = { ...this.search, ...patch };
    if (run) void this.run();
    else this.emit();
  }

  async run() {
    if (!this.app.addGeoJsonLayer) {
      this.update({ status: "error", message: "This version of GeoLibre cannot add layers from plugins." });
      return;
    }
    this.running?.abort();
    const controller = new AbortController();
    this.running = controller;
    this.update({ status: "loading", message: "Searching…" });
    try {
      const view = this.searchedView();
      const now = new Date();
      const shown = { ...this.search, centre: this.aroundCentre() };
      // The hidden classes are asked too, so an empty result can say what the legend hides.
      const hidden = shown.depthOn.some((on) => !on) ? { ...shown, depthOn: shown.depthOn.map((on) => !on) } : null;
      const [events, hiddenEvents] = await Promise.all([
        this.fetchAll(shown, filtersOf(shown, now, view), controller.signal),
        hidden ? this.fetchAll(hidden, filtersOf(hidden, now, view), controller.signal) : null,
      ]);
      this.state = { ...this.state, hiddenCount: hiddenEvents ? hiddenEvents.features.length : null };
      this.resultsLayer()?.setData(events);
      this.update({ status: "done", message: "", events });
      if (this.state.liveZoom) this.fitLive(view);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message =
        error instanceof DOMException && error.name === "TimeoutError"
          ? "The INGV service did not answer in time."
          : error instanceof Error
            ? error.message
            : String(error);
      this.update({ status: "error", message });
    } finally {
      if (this.running === controller) this.running = null;
    }
  }

  /** Run the requests of a search and merge them: no repeats, the legend's classes, the order and the limit. */
  private async fetchAll(search: SearchState, filters: EventFilter[], signal: AbortSignal): Promise<EventCollection> {
    const parts = await Promise.all(filters.map((f) => fetchEvents(buildQueryUrl(f), signal)));
    const seen = new Set<number>();
    const merged = parts
      .flatMap((p) => p.features)
      .filter((f) => !seen.has(f.properties.eventId) && seen.add(f.properties.eventId) && depthShown(search, f.properties.depth));
    const features = parts.length > 1 ? orderEvents(merged, search.order).slice(0, search.limit) : merged;
    return { type: "FeatureCollection", features };
  }

  /** The layer of the current search, created on first use: the map may not exist at activation (globe view). */
  private resultsLayer(): ResultsLayer | null {
    if (this.results) return this.results;
    const map = this.app.getMap?.();
    if (!map) return null;
    this.results = new ResultsLayer(map, (f) => this.select(f), () => !!this.app.getActiveMapTool?.());
    return this.results;
  }

  /** Open an event: the map flies to it and the panel shows its detail. */
  select(feature: EventFeature) {
    const [lon, lat] = feature.geometry.coordinates;
    const map = this.app.getMap?.();
    map?.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 8), offset: [0, -this.mapPadding().bottom / 2] });
    this.results?.setRing(feature.properties.eventId);
    this.update({ view: "detail", selected: feature });
  }

  backToSearch() {
    this.results?.setRing(null);
    this.update({ view: "search", selected: null });
  }

  hover(feature: EventFeature | null) {
    const shown = feature ?? (this.state.view === "detail" ? this.state.selected : null);
    this.results?.setRing(shown?.properties.eventId ?? null);
    this.update({ hover: feature?.properties.eventId ?? null });
  }

  /** "5 in hidden depth classes", or "" when no class is off or the hidden ones are empty. */
  hiddenNote(): string {
    const n = this.state.hiddenCount;
    if (!n) return "";
    return `${n.toLocaleString("en")}${n >= this.search.limit ? "+" : ""} in hidden depth classes`;
  }

  /** Name of the search, for the table and a saved layer: "7 days, M 2-8". */
  describe(): string {
    const s = this.search;
    const period = s.time === "custom" ? `${s.from.replace("T", " ")} to ${s.to.replace("T", " ")}` : TIME_PRESETS.find((p) => p.id === s.time)!.label;
    return `${period}, M ${s.magnitude[0]}-${s.magnitude[1]}`;
  }

  /**
   * The view box a "Map view" search uses. After a live zoom the view is the
   * results' own box: searching it would shrink the area at every filter
   * change, so until the user moves the map the previous box is kept.
   */
  private searchedView(): Bbox | null {
    const view = this.app.getViewBounds?.() ?? null;
    if (this.state.liveZoom && this.liveFit && view && sameBox(view, this.liveFit.view)) return this.liveFit.searched;
    this.liveFit = null;
    return view;
  }

  /**
   * The centre of "Around": the clicked point, else the map centre. After a
   * live zoom the map centre is the results' own, so until the user moves the
   * map the previous centre is kept. Call after `searchedView`.
   */
  private aroundCentre(): SearchState["centre"] {
    if (this.search.area !== "around") return this.search.centre;
    if (this.search.centre) return (this.usedCentre = this.search.centre);
    if (this.liveFit && this.usedCentre) return this.usedCentre;
    const c = this.app.getMap?.()?.getCenter();
    return (this.usedCentre = c ? { lat: c.lat, lon: c.lng } : null);
  }

  /** Live zoom: fit to the results, then note the view it left. */
  private fitLive(searched: Bbox | null) {
    const map = this.app.getMap?.();
    if (!map || !this.state.events?.features.length) return;
    map.once("moveend", () => {
      const view = this.app.getViewBounds?.();
      if (view) this.liveFit = { view, searched };
    });
    this.zoomToResults();
  }

  setLiveZoom(on: boolean) {
    this.liveFit = null;
    this.update({ liveZoom: on });
    if (on) this.fitLive(this.app.getViewBounds?.() ?? null);
  }

  /** Fit the map to the events of the search; one event alone is shown at zoom 8. */
  zoomToResults() {
    const box = eventsBbox(this.state.events?.features ?? []);
    if (!box) return;
    const map = this.app.getMap?.();
    const padding = this.mapPadding();
    if (box[0] === box[2] && box[1] === box[3]) return map?.flyTo({ center: [box[0], box[1]], zoom: 8, offset: [0, -padding.bottom / 2] });
    // Not fitBounds with padding: in GeoLibre web (MapLibre 6.15) it left the
    // top of the map unpainted until a reload (2026-10-23). The camera is
    // computed with the padding and then reached without it.
    const camera = padding.bottom ? map?.cameraForBounds([[box[0], box[1]], [box[2], box[3]]], { padding }) : undefined;
    if (map && camera) map.easeTo({ center: camera.center, zoom: camera.zoom });
    else this.app.fitBounds?.(box);
  }

  /**
   * The map padding that keeps the results off the panel. On a phone GeoLibre
   * lays the panel over the bottom of the map, so a plain fit puts part of the
   * points under it; beside the map (desktop) the padding is zero.
   */
  private mapPadding(): Padding {
    const padding = { top: 40, bottom: 0, left: 40, right: 40 };
    const map = this.app.getMap?.();
    if (!map?.getContainer || !this.panelElement?.isConnected) return { ...padding, top: 0, left: 0, right: 0 };
    const m = map.getContainer().getBoundingClientRect();
    const p = this.panelElement.getBoundingClientRect();
    const covers = p.left <= m.left + 1 && p.right >= m.right - 1 && p.top > m.top && p.top < m.bottom;
    return covers ? { ...padding, bottom: m.bottom - p.top + 40 } : { ...padding, top: 0, left: 0, right: 0 };
  }

  /** Keep the current search in the project as a layer of the Layers panel. */
  saveToProject() {
    if (this.state.events && this.app.addGeoJsonLayer) addToProject(this.app, this.state.events, `${LAYER_NAME}, ${this.describe()}`);
  }

  /** The search of the detail's "Seismicity around": a year, any magnitude, 30 km. */
  searchAround(feature: EventFeature) {
    const [lon, lat] = feature.geometry.coordinates;
    this.results?.setRing(null);
    this.state = { ...this.state, view: "search", selected: null };
    this.set({ area: "around", centre: { lat, lon }, radiusKm: 30, time: "1y", magnitude: [MAGNITUDE_SCALE.min, MAGNITUDE_SCALE.max] });
  }

  dispose() {
    this.running?.abort();
    this.results?.dispose();
    this.results = null;
    this.listeners.clear();
  }
}
