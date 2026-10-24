/**
 * The interface follows GeoLibre's language through the host's own i18n
 * (docs/plugin-api.md, "Following the app language"): the Italian catalogue
 * is registered once with `registerTranslations`, every string is resolved
 * with `translate` and keeps its English text in the code as the fallback.
 * Without the host (unit tests, an old GeoLibre) the English text is used,
 * with the same `{{name}}` interpolation.
 */
import { PLUGIN_ID } from "./constants";
import type { IngvHost } from "./host";
import { IT } from "./i18n-it";
import { TIME_PRESETS, type TimePresetId } from "./query";

type Params = Record<string, string | number>;

let host: IngvHost | null = null;

const fullKey = (key: string) => `plugin.${PLUGIN_ID}.${key}`;

const interpolate = (text: string, params?: Params) =>
  params ? text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text;

/**
 * Bind the strings to GeoLibre's language and register the Italian
 * catalogue. Registering again is a no-op in the host, so a second activation
 * costs nothing.
 */
export function bindLanguage(app: IngvHost | null) {
  host = app;
  app?.registerTranslations?.({ it: Object.fromEntries(Object.entries(IT).map(([key, text]) => [fullKey(key), text])) });
}

/** A string in GeoLibre's language; `english` is what shows without a translation. */
export function tr(key: string, english: string, params?: Params): string {
  return host?.translate?.(fullKey(key), english, params) ?? interpolate(english, params);
}

/**
 * A count with its noun: the host picks `<key>_one` or `<key>_other` for the
 * language; without it, the English singular or plural.
 */
export function trCount(key: string, one: string, other: string, count: number, params: Params = {}): string {
  return tr(key, count === 1 ? one : other, { ...params, count });
}

/** GeoLibre's language code ("en", "it", "pt-BR"…), "en" without the host. */
export const locale = () => host?.getLocale?.() ?? "en";

/** The locale for dates and numbers: Italian when the interface is, else British English (24-hour, day first). */
export const dateLocale = () => (locale().startsWith("it") ? "it-IT" : "en-GB");

/** Run `listener` when the user switches GeoLibre's language; returns the unsubscribe. */
export const onLanguageChange = (listener: () => void): (() => void) => host?.onLocaleChange?.(() => listener()) ?? (() => {});

/** The label of a period preset: "7 days", "7 giorni". */
export const presetLabel = (id: Exclude<TimePresetId, "custom">) => tr(`time.${id}`, TIME_PRESETS.find((p) => p.id === id)!.label);
