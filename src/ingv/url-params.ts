import { localMinute, type Area, type SearchState, defaultSearch } from "./controller";
import { COUNTRIES } from "./countries";
import { DEPTH_CLASSES } from "./layer";
import { DEPTH_SCALE, MAGNITUDE_SCALE, TIME_PRESETS, type Bbox, type OrderBy } from "./query";

/**
 * The query parameters the plugin owns in a GeoLibre link, e.g.
 * `…/?plugin=ingv-geolibre&ingvTime=24h&ingvMag=3,8&ingvArea=world`. GeoLibre
 * activates the plugin when one is in the address and hands them to
 * `handleUrlParameters`. Names are case-sensitive and public once a link is
 * shared: do not rename them. A field at its default is not written.
 */
const TIME = "ingvTime";
const FROM = "ingvFrom";
const TO = "ingvTo";
const MAG = "ingvMag";
const DEPTH = "ingvDepth";
/** The depth classes turned off, by the top of their range: `0,100`. */
const DEPTH_OFF = "ingvDepthOff";
const AREA = "ingvArea";
const COUNTRY = "ingvCountry";
const CENTRE = "ingvCentre";
const RADIUS = "ingvRadius";
const ORDER = "ingvOrder";
const LIMIT = "ingvLimit";
/** The box a "Map view" search used, `west,south,east,north`: searched as it is, whatever the screen. */
const BOX = "ingvBox";
/** The event open in the detail. */
const EVENT = "ingvEvent";
/** `0`: live zoom off, so the map stays on GeoLibre's own `lat`, `lon`, `zoom`. */
const LIVE = "ingvLive";
/** The Minimap's zoom relative to the map (`-8` wider, `-3` closer), or `off`. */
const MINIMAP = "ingvMinimap";

export const URL_PARAMETER_NAMES = [TIME, FROM, TO, MAG, DEPTH, DEPTH_OFF, AREA, COUNTRY, CENTRE, RADIUS, ORDER, LIMIT, BOX, EVENT, LIVE, MINIMAP];

/** The Minimap's zoom relative to the map when the plugin opens it; GeoLibre's own is -4. */
export const DEFAULT_MINIMAP = -6;
export type Minimap = number | "off";

/** Where a shared link opens: GeoLibre web, the one address every recipient can open. */
const SHARE_BASE_URL = "https://web.geolibre.app/";
/** The registry id `?plugin=` installs; the development copy is not in the registry, so it shares this too. */
export const SHARE_PLUGIN_ID = "ingv-geolibre";

const AREAS: Area[] = ["view", "around", "world", "country"];
const ORDERS: OrderBy[] = ["time", "time-asc", "magnitude", "magnitude-asc"];

/** What a link asks for. */
export interface Link {
  search: SearchState;
  box: Bbox | null;
  eventId: number | null;
  liveZoom: boolean | null;
  minimap: Minimap | null;
}

/** What a shared link gives: the search, the box or centre it used, the event open, the map view. */
export interface Shared {
  search: SearchState;
  /** The box a "Map view" search would use now. */
  box: Bbox | null;
  /** The centre the last "Around" search used. */
  centre: SearchState["centre"];
  eventId: number | null;
  liveZoom: boolean;
  minimap: Minimap;
  view: { lon: number; lat: number; zoom: number } | null;
}

const numbers = (raw: string) => raw.split(",").map((v) => Number(v.trim()));
const round = (v: number, digits: number) => String(Number(v.toFixed(digits)));

/** Two numbers inside a scale, the first not above the second. */
function pair(raw: string, scale: { min: number; max: number }): [number, number] | null {
  const [a, b, ...rest] = numbers(raw);
  if (rest.length || !Number.isFinite(a) || !Number.isFinite(b) || a > b || a < scale.min || b > scale.max) return null;
  return [a, b];
}

function box(raw: string): Bbox | null {
  const b = numbers(raw);
  if (b.length !== 4 || !b.every(Number.isFinite) || b[0] >= b[2] || b[1] >= b[3] || b[1] < -90 || b[3] > 90) return null;
  return b as Bbox;
}

/** A UTC minute, `2026-10-23T12:00Z`, into the panel's local `YYYY-MM-DDThh:mm`. */
function utcMinute(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : localMinute(date);
}

/**
 * Read the search a link asks for, or null when it asks for nothing. The
 * search starts from the defaults, so the same link gives the same search to
 * everyone. Anyone can write a link: a value that is not valid is left out
 * with a warning, the rest is still searched.
 */
export function linkFrom(params: URLSearchParams, now: Date): Link | null {
  const s = defaultSearch(now);
  const link: Link = { search: s, box: null, eventId: null, liveZoom: null, minimap: null };
  let asked = false;
  /** Apply a parameter's value when it parses; a value that does not is left out with a warning. */
  const take = <T>(name: string, parse: (raw: string) => T | null, apply: (value: T) => void) => {
    const raw = (params.get(name) ?? "").trim();
    if (!raw) return;
    asked = true;
    const value = parse(raw);
    if (value === null) console.warn(`[ingv-geolibre] Ignoring ${name}=${raw} in the link.`);
    else apply(value);
  };
  const oneOf = <T extends string>(values: readonly T[]) => (raw: string) => (values.includes(raw as T) ? (raw as T) : null);
  const positive = (integer: boolean) => (raw: string) => {
    const v = Number(raw);
    return v > 0 && (!integer || Number.isInteger(v)) ? v : null;
  };
  take(TIME, oneOf<SearchState["time"]>([...TIME_PRESETS.map((p) => p.id), "custom"]), (v) => (s.time = v));
  take(FROM, utcMinute, (v) => (s.from = v));
  take(TO, utcMinute, (v) => (s.to = v));
  take(MAG, (raw) => pair(raw, MAGNITUDE_SCALE), (v) => (s.magnitude = v));
  take(DEPTH, (raw) => pair(raw, DEPTH_SCALE), (v) => (s.depth = v));
  take(
    DEPTH_OFF,
    (raw) => {
      const off = numbers(raw);
      return off.every((v) => DEPTH_CLASSES.some((c) => c.from === v)) ? off : null;
    },
    (off) => (s.depthOn = DEPTH_CLASSES.map((c) => !off.includes(c.from))),
  );
  take(AREA, oneOf(AREAS), (v) => (s.area = v));
  take(COUNTRY, (raw) => COUNTRIES.find((c) => c.code.toLowerCase() === raw.toLowerCase()) ?? null, (v) => (s.country = v));
  take(
    CENTRE,
    (raw) => {
      const [lat, lon, ...rest] = numbers(raw);
      return !rest.length && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
    },
    (v) => (s.centre = v),
  );
  take(RADIUS, positive(false), (v) => (s.radiusKm = v));
  take(ORDER, oneOf(ORDERS), (v) => (s.order = v));
  take(LIMIT, positive(true), (v) => (s.limit = v));
  take(BOX, box, (v) => (link.box = v));
  take(EVENT, positive(true), (v) => (link.eventId = v));
  take(LIVE, oneOf(["0", "1"]), (v) => (link.liveZoom = v === "1"));
  take(
    MINIMAP,
    (raw) => (raw === "off" ? raw : raw !== "" && Number(raw) >= -12 && Number(raw) <= 4 ? Number(raw) : null),
    (v) => (link.minimap = v),
  );
  // A country or a centre counts only with its area.
  if (s.area !== "country") s.country = null;
  if (s.area === "country" && !s.country) s.area = "view";
  if (s.area !== "around") s.centre = null;
  if (s.area !== "view") link.box = null;
  return asked ? link : null;
}

/** The link parameters of a shared search: one per field that is not at its default, in a fixed order. */
export function shareParams(shared: Shared): URLSearchParams {
  const s = shared.search;
  const d = defaultSearch(new Date());
  const params = new URLSearchParams();
  const set = (name: string, value: string, fallback: string) => value !== fallback && params.set(name, value);
  set(TIME, s.time, d.time);
  if (s.time === "custom") {
    params.set(FROM, `${new Date(s.from).toISOString().slice(0, 16)}Z`);
    params.set(TO, `${new Date(s.to).toISOString().slice(0, 16)}Z`);
  }
  set(MAG, s.magnitude.join(","), d.magnitude.join(","));
  set(DEPTH, s.depth.join(","), d.depth.join(","));
  set(DEPTH_OFF, DEPTH_CLASSES.filter((_, i) => !s.depthOn[i]).map((c) => c.from).join(","), "");
  set(AREA, s.area, d.area);
  if (s.area === "country" && s.country) params.set(COUNTRY, s.country.code);
  const centre = s.centre ?? shared.centre;
  if (s.area === "around" && centre) {
    params.set(CENTRE, `${round(centre.lat, 4)},${round(centre.lon, 4)}`);
    set(RADIUS, String(s.radiusKm), String(d.radiusKm));
  }
  set(ORDER, s.order, d.order);
  set(LIMIT, String(s.limit), String(d.limit));
  if (s.area === "view" && shared.box) params.set(BOX, shared.box.map((v) => round(v, 4)).join(","));
  if (shared.eventId) params.set(EVENT, String(shared.eventId));
  if (!shared.liveZoom) params.set(LIVE, "0");
  if (shared.minimap !== DEFAULT_MINIMAP) params.set(MINIMAP, String(shared.minimap));
  return params;
}

/**
 * The link that gives someone else this search: GeoLibre web with `?plugin=`
 * (it installs the plugin where it is missing, after the trust prompt) and the
 * search's parameters. With live zoom off and no box, GeoLibre's own `lat`,
 * `lon`, `zoom` carry the map view.
 */
export function shareUrl(shared: Shared): string {
  const query = new URLSearchParams({ plugin: SHARE_PLUGIN_ID });
  for (const [name, value] of shareParams(shared)) query.set(name, value);
  const { view } = shared;
  if (view && !shared.liveZoom && !query.has(BOX)) {
    query.set("lat", round(view.lat, 5));
    query.set("lon", round(view.lon, 5));
    query.set("zoom", round(view.zoom, 2));
  }
  // Commas are valid in a query string: `ingvMag=3,8` reads better than `3%2C8`.
  return `${SHARE_BASE_URL}?${String(query).replace(/%2C/g, ",")}`;
}
