import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { countryName, COUNTRIES, matchCountries } from "../src/ingv/countries";
import { italyDateLong } from "../src/ingv/format";
import type { IngvHost } from "../src/ingv/host";
import { bindLanguage, presetLabel, tr, trCount } from "../src/ingv/i18n";
import { IT } from "../src/ingv/i18n-it";

/** A GeoLibre whose `translate` resolves as i18next does: the language's key, `_one`/`_other` with `count`, else the default. */
function fakeHost(language: string): IngvHost {
  const resources: Record<string, Record<string, string>> = {};
  const fill = (text: string, params?: Record<string, string | number>) =>
    text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (params && name in params ? String(params[name]) : match));
  return {
    getLocale: () => language,
    registerTranslations: (r: Record<string, Record<string, string>>) => {
      for (const [lng, entries] of Object.entries(r)) resources[lng] = { ...resources[lng], ...entries };
    },
    translate: (key: string, defaultValue: string, params?: Record<string, string | number>) => {
      const dict = resources[language] ?? {};
      const plural = params?.count === undefined ? undefined : `${key}_${params.count === 1 ? "one" : "other"}`;
      return fill((plural && dict[plural]) ?? dict[key] ?? defaultValue, params);
    },
  } as unknown as IngvHost;
}

const greece = COUNTRIES.find((c) => c.code === "GR")!;

describe("interface language", () => {
  afterEach(() => bindLanguage(null));

  it("speaks English without GeoLibre, with the same interpolation", () => {
    expect(tr("search", "Search")).toBe("Search");
    expect(tr("result.limit", "The limit of {{limit}} was reached", { limit: 1000 })).toBe("The limit of 1000 was reached");
    expect(trCount("result.count", "{{n}} earthquake", "{{n}} earthquakes", 1, { n: "1" })).toBe("1 earthquake");
    expect(trCount("result.count", "{{n}} earthquake", "{{n}} earthquakes", 3, { n: "3" })).toBe("3 earthquakes");
  });

  it("follows GeoLibre in Italian, plurals and periods included", () => {
    bindLanguage(fakeHost("it"));
    expect(tr("search", "Search")).toBe("Cerca");
    expect(trCount("result.count", "{{n}} earthquake", "{{n}} earthquakes", 1, { n: "1" })).toBe("1 terremoto");
    expect(trCount("result.count", "{{n}} earthquake", "{{n}} earthquakes", 1234, { n: "1.234" })).toBe("1.234 terremoti");
    expect(presetLabel("7d")).toBe("7 giorni");
    expect(tr("tab.filtersCount", "Filters · {{n}}", { n: 2 })).toBe("Filtri · 2");
  });

  it("keeps English in a language it has no catalogue for", () => {
    bindLanguage(fakeHost("fr"));
    expect(tr("search", "Search")).toBe("Search");
    expect(presetLabel("7d")).toBe("7 days");
  });

  it("names countries and months in the interface language", () => {
    expect(countryName(greece)).toBe("Greece");
    bindLanguage(fakeHost("it"));
    expect(countryName(greece)).toBe("Grecia");
    expect(matchCountries("grecia")[0].code).toBe("GR");
    // The English name still finds it.
    expect(matchCountries("greece")[0].code).toBe("GR");
    expect(italyDateLong(new Date("2026-10-24T10:00:00Z"))).toBe("24 ottobre 2026");
  });

  it("has an Italian text for every key the code asks for", () => {
    const dir = join(__dirname, "../src/ingv");
    const code = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "i18n-it.ts")
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    const plain = [...code.matchAll(/\btr\("([\w.]+)"/g)].map((m) => m[1]);
    const counted = [...code.matchAll(/\btrCount\("([\w.]+)"/g)].flatMap((m) => [`${m[1]}_one`, `${m[1]}_other`]);
    const missing = [...plain, ...counted].filter((key) => !(key in IT));
    expect(missing).toEqual([]);
  });
});
