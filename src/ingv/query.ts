import { FDSN_EVENT_URL } from "./constants";

/** West, south, east, north in degrees (WGS84). */
export type Bbox = [number, number, number, number];

/** A circle: centre and radius in kilometres. */
export interface Circle {
  lat: number;
  lon: number;
  radiusKm: number;
}

/** A search of the INGV event service. Every field but `start` is optional. */
export interface EventFilter {
  start: Date;
  end?: Date;
  minMagnitude?: number;
  maxMagnitude?: number;
  /** Kilometres. */
  minDepth?: number;
  maxDepth?: number;
  bbox?: Bbox;
  circle?: Circle;
  orderBy?: OrderBy;
  limit?: number;
}

export type OrderBy = "time" | "time-asc" | "magnitude" | "magnitude-asc";

/** Steps back from now offered as chips; `custom` takes two dates. */
export const TIME_PRESETS = [
  { id: "1h", label: "1 h", hours: 1 },
  { id: "24h", label: "24 h", hours: 24 },
  { id: "3d", label: "3 days", hours: 72 },
  { id: "7d", label: "7 days", hours: 168 },
  { id: "30d", label: "30 days", hours: 720 },
  { id: "1y", label: "1 year", hours: 8760 },
] as const;

export type TimePresetId = (typeof TIME_PRESETS)[number]["id"] | "custom";

/** Scale of the magnitude and depth sliders. */
export const MAGNITUDE_SCALE = { min: 0, max: 8, step: 0.5 };
export const DEPTH_SCALE = { min: 0, max: 700, step: 10 };

export const DEFAULT_TIME: TimePresetId = "7d";
export const DEFAULT_MAGNITUDE: [number, number] = [2, 8];
export const DEFAULT_LIMIT = 1000;

/** The start of a time preset, counted back from `now`. */
export function presetStart(id: Exclude<TimePresetId, "custom">, now: Date): Date {
  const preset = TIME_PRESETS.find((p) => p.id === id)!;
  return new Date(now.getTime() - preset.hours * 3_600_000);
}

/** The service takes `YYYY-MM-DDThh:mm:ss` in UTC and refuses milliseconds. */
export function fdsnTime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The GeoJSON query URL of a filter. */
export function buildQueryUrl(filter: EventFilter): string {
  const params = new URLSearchParams({ format: "geojson", starttime: fdsnTime(filter.start) });
  if (filter.end) params.set("endtime", fdsnTime(filter.end));
  if (filter.minMagnitude !== undefined) params.set("minmagnitude", String(filter.minMagnitude));
  if (filter.maxMagnitude !== undefined) params.set("maxmagnitude", String(filter.maxMagnitude));
  if (filter.minDepth !== undefined) params.set("mindepth", String(filter.minDepth));
  if (filter.maxDepth !== undefined) params.set("maxdepth", String(filter.maxDepth));
  if (filter.circle) {
    params.set("latitude", String(filter.circle.lat));
    params.set("longitude", String(filter.circle.lon));
    params.set("maxradiuskm", String(filter.circle.radiusKm));
  } else if (filter.bbox) {
    // A zoomed-out view reaches past the world's edges, which the service refuses.
    const [west, south, east, north] = filter.bbox;
    params.set("minlatitude", String(clamp(south, -90, 90)));
    params.set("maxlatitude", String(clamp(north, -90, 90)));
    params.set("minlongitude", String(clamp(west, -180, 180)));
    params.set("maxlongitude", String(clamp(east, -180, 180)));
  }
  params.set("orderby", filter.orderBy ?? "time");
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  return `${FDSN_EVENT_URL}?${params}`;
}

/** The GeoJSON query URL of one event. */
export const eventQueryUrl = (eventId: number) => `${FDSN_EVENT_URL}?${new URLSearchParams({ format: "geojson", eventid: String(eventId) })}`;
