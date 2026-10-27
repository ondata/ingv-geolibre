import type { Country } from "./countries";
import { scrollParent } from "./dom";
import { fetchEvents, type EventCollection, type EventFeature } from "./events";
import type { IngvHost, MapLike, Padding } from "./host";
import { addToProject, DEPTH_CLASSES, LAYER_NAME } from "./layer";
import { ResultsLayer } from "./results-layer";
import { fetchFaults, FaultsLayer } from "./faults";
import { DissLayer, fetchDiss } from "./diss";
import type { MapOverlay } from "./overlay";
import { highlighted, timeStats, type Highlight, type TimeStats } from "./stats";
import { dateLocale, presetLabel, tr } from "./i18n";
import { DEFAULT_MINIMAP, type Link, type Minimap, type Shared } from "./url-params";
import {
  buildQueryUrl,
  eventQueryUrl,
  DEFAULT_LIMIT,
  DEFAULT_MAGNITUDE,
  DEFAULT_TIME,
  DEPTH_SCALE,
  MAGNITUDE_SCALE,
  presetStart,
  type Bbox,
  type EventFilter,
  type OrderBy,
  type TimePresetId,
} from "./query";

export type Area = "view" | "around" | "world" | "country";
export type SortKey = "time" | "mag" | "depth";
export type ResultsTab = "table" | "time" | "mag" | "energy";
type OverlayName = "faults" | "diss";
type OverlayState = "off" | "loading" | "on" | "error";

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
  /** The bar or class of a chart under the pointer, lit up on the map. */
  lit: Highlight | null;
  /** Tab of the results panel. */
  resultsTab: ResultsTab;
  /** Events of the search in the depth classes turned off, null when all are on; capped at the limit. */
  hiddenCount: number | null;
  tableOpen: boolean;
  /** Fit the map to the results after every search. */
  liveZoom: boolean;
  /** Draw the results on the map; off hides them and keeps the search (issue #1). */
  showOnMap: boolean;
  /** ISPRA's capable faults on the map; "loading" while the catalogue downloads. */
  faults: OverlayState;
  /** INGV's seismogenic sources (DISS) on the map. */
  diss: OverlayState;
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
    lit: null,
    resultsTab: "table",
    hiddenCount: null,
    tableOpen: false,
    liveZoom: true,
    showOnMap: true,
    faults: "off",
    diss: "off",
    sort: { key: "time", dir: -1 },
  };
  private listeners = new Set<() => void>();
  private results: ResultsLayer | null = null;
  /** The map view a live zoom or a link left, and the box searched before it; no view: the next move sets it. */
  private liveFit: { view: Bbox | null; searched: Bbox | null } | null = null;
  private running: AbortController | null = null;
  /** The panel's root, set by `renderPanel`: on a phone it covers part of the map. */
  panelElement: HTMLElement | null = null;
  /** The centre the last "Around" search used; the panel shows it. */
  usedCentre: SearchState["centre"] = null;
  /** The Minimap the plugin asks for; a link can change it. */
  minimap: Minimap = DEFAULT_MINIMAP;
  /** The plugin opened the Minimap, so it closes it when turned off. */
  private openedMinimap = false;
  /** Opens the results table; set by the plugin entry, which owns the floating panel. */
  openTable: () => void = () => {};
  closeTable: () => void = () => {};
  private stats: { events: EventCollection | null; time: TimeStats | null } = { events: null, time: null };

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
      this.update({ status: "error", message: tr("error.noLayers", "This version of GeoLibre cannot add layers from plugins.") });
      return;
    }
    this.running?.abort();
    const controller = new AbortController();
    this.running = controller;
    this.update({ status: "loading", message: tr("status.searching", "Searching…") });
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
      this.update({ status: "done", message: "", events, lit: null });
      if (this.state.liveZoom) this.fitLive(view);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message =
        error instanceof DOMException && error.name === "TimeoutError"
          ? tr("error.timeout", "The INGV service did not answer in time.")
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
    this.keepBoxAfterMove(this.nextBox());
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

  /** Bars of time of the current events, computed once per search. */
  timeStats(): TimeStats | null {
    const events = this.state.events;
    if (this.stats.events !== events) this.stats = { events, time: timeStats(events?.features ?? []) };
    return this.stats.time;
  }

  /** Light up on the map the events of a chart's bar or class; null clears. */
  highlight(hl: Highlight | null) {
    if (JSON.stringify(hl) === JSON.stringify(this.state.lit)) return;
    const lit = hl ? highlighted(this.state.events?.features ?? [], this.timeStats(), hl) : null;
    this.results?.setLit(lit ? lit.map((f) => f.properties.eventId) : null);
    this.update({ lit: hl });
  }

  /** Open the results panel on a tab. */
  openResults(tab: ResultsTab) {
    this.update({ resultsTab: tab });
    this.openTable();
  }

  /** A period dragged on the time chart becomes the custom period, searched at once. */
  pickPeriod(from: number, to: number) {
    const minute = 60e3;
    this.set({ time: "custom", from: localMinute(new Date(Math.floor(from / minute) * minute)), to: localMinute(new Date(Math.ceil(to / minute) * minute)) });
  }

  /** "5 in hidden depth classes", or "" when no class is off or the hidden ones are empty. */
  hiddenNote(): string {
    const n = this.state.hiddenCount;
    if (!n) return "";
    return tr("result.hidden", "{{n}} in hidden depth classes", { n: `${n.toLocaleString(dateLocale())}${n >= this.search.limit ? "+" : ""}` });
  }

  /** Name of the search, for the table and a saved layer: "7 days, M 2-8". */
  describe(): string {
    const s = this.search;
    const period =
      s.time === "custom"
        ? tr("describe.range", "{{from}} to {{to}}", { from: s.from.replace("T", " "), to: s.to.replace("T", " ") })
        : presetLabel(s.time);
    return `${period}, M ${s.magnitude[0]}-${s.magnitude[1]}`;
  }

  /**
   * The view box a "Map view" search uses. After a live zoom the view is the
   * results' own box: searching it would shrink the area at every filter
   * change, so until the user moves the map the previous box is kept.
   */
  private searchedView(): Bbox | null {
    const box = this.nextBox();
    if (!this.liveFit || box !== this.liveFit.searched) this.liveFit = null;
    return box;
  }

  /** The box the next "Map view" search would use: the previous one while the map stays where live zoom left it. */
  private nextBox(): Bbox | null {
    const view = this.app.getViewBounds?.() ?? null;
    if (this.liveFit && (!this.liveFit.view || (view && sameBox(view, this.liveFit.view)))) return this.liveFit.searched;
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
    if (!this.app.getMap?.() || !this.state.events?.features.length) return;
    this.keepBoxAfterMove(searched);
    this.fitResults();
  }

  /**
   * A move the plugin makes (live zoom, opening an event, Zoom to results)
   * keeps the box searched: only a move of the user changes the area of "Map
   * view". Else opening an event at zoom 8 would shrink the next search to it.
   */
  private keepBoxAfterMove(searched: Bbox | null) {
    this.app.getMap?.()?.once("moveend", () => {
      const view = this.app.getViewBounds?.();
      if (view) this.liveFit = { view, searched };
    });
  }

  /**
   * Follow a shared link: its search instead of the one on screen, its box
   * searched as it is until the map moves (a screen of another shape shows
   * more around it), then its event.
   */
  async followLink(link: Link) {
    this.search = link.search;
    this.state = { ...this.state, view: "search", selected: null, liveZoom: link.liveZoom ?? this.state.liveZoom };
    if (link.minimap !== null) {
      this.minimap = link.minimap;
      this.showMinimap();
    }
    this.liveFit = link.box ? { view: null, searched: link.box } : null;
    if (link.faults) void this.setFaults(true);
    if (link.diss) void this.setDiss(true);
    await this.run();
    // Live zoom has moved the map to the results; else the map goes to the box.
    if (link.box && !(this.state.liveZoom && this.state.events?.features.length)) {
      this.app.getMap?.()?.once("moveend", () => {
        if (this.liveFit) this.liveFit.view = this.app.getViewBounds?.() ?? null;
      });
      this.app.fitBounds?.(link.box);
    }
    if (link.eventId) await this.openEvent(link.eventId);
  }

  /** Open an event by id: from the search when it is there, else from the service. */
  async openEvent(eventId: number) {
    let feature = this.state.events?.features.find((f) => f.properties.eventId === eventId);
    if (!feature) {
      try {
        feature = (await fetchEvents(eventQueryUrl(eventId))).features[0];
      } catch {
        // Not found or no answer: the search stays on screen.
      }
    }
    if (feature) this.select(feature);
    else this.update({ message: tr("error.eventNotFound", "Event {{id}} not found in the INGV catalogue.", { id: eventId }) });
  }

  /**
   * Open GeoLibre's Minimap with a wider overview than its own: a sequence is
   * often seen at zoom 10-11, and the overview shows the region around it. Not
   * on a phone, where the panel already covers the bottom of the map.
   */
  showMinimap() {
    if (window.innerWidth < 768) return;
    if (this.minimap === "off") {
      if (this.openedMinimap) this.app.closeControlPanel?.("minimap");
      this.openedMinimap = false;
      return;
    }
    if (this.app.isControlPanelVisible?.("minimap") === false) this.openedMinimap = true;
    this.app.openControlPanel?.("minimap", { zoomOffset: this.minimap });
  }

  /** Close the Minimap when the results panel opens: both sit over the bottom of the map (user, 2026-10-27). */
  hideMinimap() {
    if (this.app.isControlPanelVisible?.("minimap") === false) return;
    this.app.closeControlPanel?.("minimap");
    this.openedMinimap = false;
  }

  /** What a shared link gives of the panel and the map now. */
  shared(): Shared {
    const map = this.app.getMap?.();
    const centre = map?.getCenter();
    return {
      search: this.search,
      // What a search would cover now: after the map is moved, the view on screen.
      box: this.search.area === "view" ? this.nextBox() : null,
      centre: this.usedCentre,
      eventId: this.state.view === "detail" ? (this.state.selected?.properties.eventId ?? null) : null,
      liveZoom: this.state.liveZoom,
      faults: this.state.faults === "on" || this.state.faults === "loading",
      diss: this.state.diss === "on" || this.state.diss === "loading",
      // A Minimap closed by the user on a wide screen travels as "off".
      minimap: window.innerWidth >= 768 && this.app.isControlPanelVisible?.("minimap") === false ? "off" : this.minimap,
      view: map && centre ? { lon: centre.lng, lat: centre.lat, zoom: map.getZoom() } : null,
    };
  }

  /** Reference layers drawn under the earthquakes: the data downloaded once, at the first "on". */
  private overlays: { [K in OverlayName]: { layer: MapOverlay | null; data: unknown } } = {
    faults: { layer: null, data: null },
    diss: { layer: null, data: null },
  };

  /** Show or hide ISPRA's capable faults. */
  setFaults(on: boolean) {
    return this.setOverlay("faults", on, fetchFaults, (map, data, tool) => new FaultsLayer(map, data, tool));
  }

  /** Show or hide INGV's seismogenic sources (DISS). */
  setDiss(on: boolean) {
    return this.setOverlay("diss", on, fetchDiss, (map, data, tool) => new DissLayer(map, data, tool));
  }

  private async setOverlay<T>(name: OverlayName, on: boolean, fetchData: () => Promise<T>, make: (map: MapLike, data: T, toolActive: () => boolean) => MapOverlay) {
    const o = this.overlays[name];
    if (!on) {
      o.layer?.dispose();
      o.layer = null;
      return this.update({ [name]: "off" });
    }
    const map = this.app.getMap?.();
    if (!map || o.layer) return;
    this.update({ [name]: "loading" });
    try {
      o.data ??= await fetchData();
      if (this.state[name] !== "loading") return;
      o.layer = make(map, o.data as T, () => !!this.app.getActiveMapTool?.());
      this.update({ [name]: "on" });
    } catch (error) {
      this.update({ [name]: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  setShowOnMap(on: boolean) {
    this.resultsLayer()?.setVisible(on);
    this.update({ showOnMap: on });
  }

  setLiveZoom(on: boolean) {
    this.liveFit = null;
    this.update({ liveZoom: on });
    if (on) this.fitLive(this.app.getViewBounds?.() ?? null);
  }

  /** "Zoom to results": fit the map to the events, keeping the box searched. */
  zoomToResults() {
    if (!eventsBbox(this.state.events?.features ?? [])) return;
    this.keepBoxAfterMove(this.nextBox());
    this.fitResults();
  }

  /** Fit the map to the events of the search; one event alone is shown at zoom 8. */
  private fitResults() {
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
    // The visible part of the panel: on a phone it is taller than GeoLibre's container and scrolls inside it.
    const p = (scrollParent(this.panelElement) ?? this.panelElement).getBoundingClientRect();
    const covers = p.left <= m.left + 1 && p.right >= m.right - 1 && p.top > m.top && p.top < m.bottom;
    return covers ? { ...padding, bottom: m.bottom - p.top + 40 } : { ...padding, top: 0, left: 0, right: 0 };
  }

  /** Keep the current search in the project as a layer of the Layers panel. */
  saveToProject() {
    if (this.state.events && this.app.addGeoJsonLayer) addToProject(this.app, this.state.events, `${tr("layer.name", LAYER_NAME)}, ${this.describe()}`);
  }

  /** The search of the detail's "Seismicity around": a year, any magnitude, 30 km. */
  searchAround(feature: EventFeature) {
    const [lon, lat] = feature.geometry.coordinates;
    this.results?.setRing(null);
    this.state = { ...this.state, view: "search", selected: null };
    this.set({ area: "around", centre: { lat, lon }, radiusKm: 30, time: "1y", magnitude: [MAGNITUDE_SCALE.min, MAGNITUDE_SCALE.max] });
  }

  dispose() {
    if (this.openedMinimap) this.app.closeControlPanel?.("minimap");
    this.running?.abort();
    this.results?.dispose();
    this.results = null;
    for (const o of Object.values(this.overlays)) {
      o.layer?.dispose();
      o.layer = null;
    }
    this.listeners.clear();
  }
}
