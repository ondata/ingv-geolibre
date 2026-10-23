import data from "./countries.json";
import type { Bbox } from "./query";

/**
 * Country extents from Natural Earth 1:110m admin 0 (public domain), as the
 * gist graydon/11198540 extracts them: ISO code, name, bounding box.
 */
export interface Country {
  code: string;
  name: string;
  bbox: Bbox;
}

export const COUNTRIES: Country[] = Object.entries(data as unknown as Record<string, [string, Bbox]>)
  .map(([code, [name, bbox]]) => ({ code, name, bbox }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** A box that spans every longitude: the country crosses the 180° meridian. */
export const wrapsWorld = (bbox: Bbox) => bbox[2] - bbox[0] >= 359;

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Countries matching typed text, by name or exact code; names starting with it first. */
export function matchCountries(query: string): Country[] {
  const q = fold(query.trim());
  if (!q) return COUNTRIES;
  return COUNTRIES.filter((c) => fold(c.name).includes(q) || c.code.toLowerCase() === q).sort(
    (a, b) => Number(fold(b.name).startsWith(q)) - Number(fold(a.name).startsWith(q)) || a.name.localeCompare(b.name),
  );
}
