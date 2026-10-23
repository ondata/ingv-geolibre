import type { Country } from "./countries";
import { fetchEvents, type EventCollection, type EventFeature } from "./events";
import type { IngvHost } from "./host";
import { addToProject, LAYER_NAME } from "./layer";
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
  type EventFilter,
  type OrderBy,
  type TimePresetId,
} from "./query";

export type Area = "view" | "around" | "world" | "country";
export type SortKey = "time" | "mag" | "depth";

export interface SearchState {
  time: TimePresetId;
  /** `YYYY-MM-DD`, for the custom period, read as UTC days. */
  from: string;
  to: string;
  magnitude: [number, number];
  depth: [number, number];
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
  tableOpen: boolean;
  sort: { key: SortKey; dir: 1 | -1 };
}

const day = (date: Date) => date.toISOString().slice(0, 10);

/** The filter of the panel state; `now` and the view bounds come from outside. */
export function filterOf(s: SearchState, now: Date, viewBounds: [number, number, number, number] | null): EventFilter {
  const filter: EventFilter =
    s.time === "custom"
      ? { start: new Date(`${s.from}T00:00:00Z`), end: new Date(Date.parse(`${s.to}T00:00:00Z`) + 86_400_000) }
      : { start: presetStart(s.time, now) };
  // A handle at the end of its scale means no limit on that side.
  if (s.magnitude[0] > MAGNITUDE_SCALE.min) filter.minMagnitude = s.magnitude[0];
  if (s.magnitude[1] < MAGNITUDE_SCALE.max) filter.maxMagnitude = s.magnitude[1];
  if (s.depth[0] > DEPTH_SCALE.min) filter.minDepth = s.depth[0];
  if (s.depth[1] < DEPTH_SCALE.max) filter.maxDepth = s.depth[1];
  if (s.area === "view" && viewBounds) filter.bbox = viewBounds;
  // A country across the 180° meridian has a box of every longitude: its latitude band.
  if (s.area === "country" && s.country) filter.bbox = s.country.bbox;
  if (s.area === "around" && s.centre) filter.circle = { ...s.centre, radiusKm: s.radiusKm };
  filter.orderBy = s.order;
  filter.limit = s.limit;
  return filter;
}

export function defaultSearch(now: Date): SearchState {
  return {
    time: DEFAULT_TIME,
    from: day(new Date(now.getTime() - 30 * 86_400_000)),
    to: day(now),
    magnitude: [...DEFAULT_MAGNITUDE],
    depth: [DEPTH_SCALE.min, DEPTH_SCALE.max],
    area: "view",
    centre: null,
    country: null,
    radiusKm: 30,
    order: "time",
    limit: DEFAULT_LIMIT,
  };
}

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
    tableOpen: false,
    sort: { key: "time", dir: -1 },
  };
  private listeners = new Set<() => void>();
  private results: ResultsLayer | null = null;
  private running: AbortController | null = null;
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
    if (this.search.area === "around" && !this.search.centre) {
      const c = this.app.getMap?.()?.getCenter();
      if (c) this.search = { ...this.search, centre: { lat: c.lat, lon: c.lng } };
    }
    this.running?.abort();
    const controller = new AbortController();
    this.running = controller;
    this.update({ status: "loading", message: "Searching…" });
    try {
      const url = buildQueryUrl(filterOf(this.search, new Date(), this.app.getViewBounds?.() ?? null));
      const events = await fetchEvents(url, controller.signal);
      this.resultsLayer()?.setData(events);
      this.update({ status: "done", message: "", events });
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
    map?.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 8) });
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

  /** Name of the search, for the table and a saved layer: "7 days, M 2-8". */
  describe(): string {
    const s = this.search;
    const period = s.time === "custom" ? `${s.from} to ${s.to}` : TIME_PRESETS.find((p) => p.id === s.time)!.label;
    return `${period}, M ${s.magnitude[0]}-${s.magnitude[1]}`;
  }

  /** Fit the map to the events of the search; one event alone is shown at zoom 8. */
  zoomToResults() {
    const box = eventsBbox(this.state.events?.features ?? []);
    if (!box) return;
    if (box[0] === box[2] && box[1] === box[3]) this.app.getMap?.()?.flyTo({ center: [box[0], box[1]], zoom: 8 });
    else this.app.fitBounds?.(box);
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
