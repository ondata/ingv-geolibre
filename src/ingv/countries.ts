import data from "./countries.json";
import { dateLocale, locale } from "./i18n";
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

/**
 * A country's name in the interface language: Natural Earth's in English, the
 * browser's for its ISO code otherwise ("Grecia"), Natural Earth's when the
 * browser has none.
 */
export function countryName(c: Country): string {
  if (locale().startsWith("en")) return c.name;
  try {
    const name = new Intl.DisplayNames([dateLocale()], { type: "region" }).of(c.code);
    if (name && name !== c.code) return name;
  } catch {
    // No display names in this browser: the English name.
  }
  return c.name;
}

/** Countries matching typed text, by name (shown or English) or exact code; names starting with it first. */
export function matchCountries(query: string): Country[] {
  const q = fold(query.trim());
  const shown = (c: Country) => fold(countryName(c));
  const byName = (a: Country, b: Country) => countryName(a).localeCompare(countryName(b), dateLocale());
  if (!q) return [...COUNTRIES].sort(byName);
  return COUNTRIES.filter((c) => shown(c).includes(q) || fold(c.name).includes(q) || c.code.toLowerCase() === q).sort(
    (a, b) => Number(shown(b).startsWith(q)) - Number(shown(a).startsWith(q)) || byName(a, b),
  );
}
