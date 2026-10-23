import { FDSN_EVENT_URL } from "./constants";

/**
 * Links to INGV's products for one event, the ones its event page shows.
 * Checked on 2026-10-23: a small event has no ShakeMap (404), so the panel
 * shows a product only once its image has loaded.
 */
export const shakeMapBase = (id: number) => `https://shakemap.ingv.it/data/${id}/current/products`;

export const SHAKEMAP_IMAGES = [
  { file: "intensity.jpg", label: "Intensity" },
  { file: "pga.jpg", label: "Acceleration" },
  { file: "pgv.jpg", label: "Velocity" },
];

/** ShakeMap GeoJSON products. Served without CORS: the web version cannot read them. */
export const SHAKEMAP_LAYERS = [
  { file: "cont_mi.json", label: "Add intensity contours to map", name: "ShakeMap intensity" },
  { file: "stationlist.json", label: "Add stations to map", name: "ShakeMap stations" },
];

export const feltMapUrl = (id: number) => `https://e.hsit.it/${id}/${id}_mcs_municipality.jpg`;

export const feltQuestionnaireUrl = (id: number) =>
  `https://www.haisentitoilterremoto.it/xml-server.php?item=quest&action=compile&event_id=${id}&output=int`;

export const SEISMICITY_MAPS = [
  { map: "map_seismicity_3d", label: "Last 3 days" },
  { map: "map_seismicity_90d", label: "Last 90 days" },
  { map: "map_seismicity_1985", label: "Since 1985" },
  { map: "map_historical", label: "Historical" },
];

export const seismicityMapUrl = (id: number, map: string) =>
  `https://terremoti.ingv.it/ws/geoserver/1/query?map=${map}&eventid=${id}`;

export const quakeMlUrl = (id: number) =>
  `${FDSN_EVENT_URL}?eventid=${id}&includeallorigins=true&includeallmagnitudes=true&format=xml`;

/** One computed magnitude, with the location it was computed on. */
export interface HistoryRow {
  /** Seconds from the origin time to the publication. */
  delay: number;
  automatic: boolean;
  preferred: boolean;
  magnitude: number;
  magType: string;
  /** Kilometres; null when the origin has no depth. */
  depth: number | null;
}

const ln = (el: Element) => el.localName;
const child = (el: Element | undefined, name: string) => (el ? [...el.children].find((c) => ln(c) === name) : undefined);
const path = (el: Element | undefined, ...names: string[]) => names.reduce(child, el)?.textContent?.trim();
/** QuakeML times are UTC without a zone. */
const utc = (text: string | undefined) => (text ? Date.parse(`${text.replace(/Z$/, "")}Z`) : NaN);

/**
 * The magnitudes of an event over time, from its QuakeML with all origins and
 * magnitudes: the table "Cronologia delle localizzazioni" of the event page.
 */
export function parseHistory(xml: string): HistoryRow[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const event = [...doc.getElementsByTagNameNS("*", "event")][0];
  if (!event) return [];
  const preferredOrigin = path(event, "preferredOriginID");
  const preferredMagnitude = path(event, "preferredMagnitudeID");
  const origins = new Map(
    [...event.children].filter((c) => ln(c) === "origin").map((o) => [o.getAttribute("publicID") ?? "", o]),
  );
  const eventTime = utc(path(origins.get(preferredOrigin ?? ""), "time", "value"));
  return [...event.children]
    .filter((c) => ln(c) === "magnitude")
    .map((m) => {
      const origin = origins.get(path(m, "originID") ?? "");
      const depth = Number(path(origin, "depth", "value"));
      return {
        delay: (utc(path(m, "creationInfo", "creationTime")) - eventTime) / 1000,
        automatic: (path(origin, "evaluationMode") ?? path(m, "evaluationMode")) === "automatic",
        preferred: m.getAttribute("publicID") === preferredMagnitude,
        magnitude: Number(path(m, "mag", "value")),
        magType: path(m, "type") ?? "",
        depth: Number.isFinite(depth) && path(origin, "depth", "value") ? depth / 1000 : null,
      };
    })
    .filter((row) => Number.isFinite(row.delay) && Number.isFinite(row.magnitude))
    .sort((a, b) => a.delay - b.delay);
}

/** `+m:ss`, or `+h:mm:ss` past an hour. */
export function formatDelay(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `+${h}:${pad(m)}:${pad(s % 60)}` : `+${m}:${pad(s % 60)}`;
}
