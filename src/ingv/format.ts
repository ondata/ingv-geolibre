import type { EventCollection, EventFeature } from "./events";
import { eventPageUrl } from "./events";
import { dateLocale } from "./i18n";

/** The service's times are UTC without the `Z`. */
export const eventDate = (time: string) => new Date(`${time.replace(/Z$/, "")}Z`);

const italy = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", ...options });
const ITALY_DATE = italy({ year: "numeric", month: "2-digit", day: "2-digit" });
const ITALY_TIME = italy({ hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
/** Dates with month names follow the interface language; the numeric ones above do not need to. */
const named = (options: Intl.DateTimeFormatOptions) => (date: Date) =>
  new Intl.DateTimeFormat(dateLocale(), { timeZone: "Europe/Rome", ...options }).format(date);
const ITALY_LONG = named({ day: "numeric", month: "long", year: "numeric" });
const ITALY_SHORT = named({ day: "numeric", month: "short" });

/** `2026-10-23` in Italy. */
export function italyDateIso(date: Date): string {
  const [d, m, y] = ITALY_DATE.format(date).split("/");
  return `${y}-${m}-${d}`;
}

export const italyTime = (date: Date) => ITALY_TIME.format(date);
export const italyDateLong = ITALY_LONG;
export const italyDateShort = ITALY_SHORT;
export const utcDateIso = (date: Date) => date.toISOString().slice(0, 10);
export const utcTime = (date: Date) => date.toISOString().slice(11, 19);

export const formatMagnitude = (mag: number) => mag.toFixed(1);

/** Depth in km, without a trailing `.0`. */
export const formatDepth = (depth: number) => String(Math.round(depth * 10) / 10);

const CSV_COLUMNS = ["eventId", "time_utc", "time_italy", "magnitude", "magType", "depth_km", "latitude", "longitude", "place", "url"];

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function csvRow(f: EventFeature): (string | number)[] {
  const date = eventDate(f.properties.time);
  const [lon, lat] = f.geometry.coordinates;
  return [
    f.properties.eventId,
    `${utcDateIso(date)} ${utcTime(date)}`,
    `${italyDateIso(date)} ${italyTime(date)}`,
    f.properties.mag,
    f.properties.magType,
    f.properties.depth,
    lat,
    lon,
    f.properties.place,
    eventPageUrl(f.properties.eventId),
  ];
}

export function toCsv(features: EventFeature[]): string {
  return [CSV_COLUMNS, ...features.map(csvRow)].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export const toGeoJson = (events: EventCollection) => JSON.stringify(events);
