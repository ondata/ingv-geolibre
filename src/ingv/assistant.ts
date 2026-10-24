/**
 * Tools for GeoLibre's AI Assistant. The assistant drives the panel, it does
 * not replace it: a search runs in the panel as one set by hand, and the tool
 * hands the model what the panel shows. The search input is turned into the
 * parameters of a link and read by `linkFrom`: one vocabulary for links and
 * tools.
 */
import type { Controller } from "./controller";
import { probeImage } from "./dom";
import { eventPageUrl, type EventFeature } from "./events";
import { formatDelay, parseHistory, quakeMlUrl, feltMapUrl, feltQuestionnaireUrl, shakeMapBase } from "./products";
import { eventDate, italyDateIso, italyTime, utcDateIso, utcTime } from "./format";
import type { IngvHost } from "./host";
import { DEPTH_CLASSES, LAYER_NAME } from "./layer";
import { TIME_PRESETS, type Bbox } from "./query";
import { linkFrom, type Link } from "./url-params";

/** Events handed to the model: the first ones in the panel's order. */
export const EVENTS_SHOWN = 20;
/** Italy and its seas, roughly: outside it the catalogue lists only the stronger events. */
const ITALY_BOX: Bbox = [6.6, 35.3, 18.6, 47.1];
/** Longest wait for a product check (ShakeMap image, felt reports map). */
const PROBE_MS = 8000;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function checkKeys(input: Record<string, unknown>, allowed: string[]) {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`Unknown field ${unknown.join(", ")}; the fields are ${allowed.join(", ")}.`);
}

/** Milliseconds Italy is ahead of UTC at a moment (1 or 2 hours). */
function romeOffset(date: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(date)
      .map((p) => [p.type, Number(p.value)]),
  );
  const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return local - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** `YYYY-MM-DD HH:mm` (or `T`) in Italy time as the UTC minute of a link, `2026-10-24T06:00Z`. */
export function italyToUtc(local: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(local.trim());
  if (!m) return null;
  const guess = Date.parse(`${m[1]}T${m[2]}:00Z`);
  if (Number.isNaN(guess)) return null;
  const utc = guess - romeOffset(new Date(guess - romeOffset(new Date(guess))));
  return `${new Date(utc).toISOString().slice(0, 16)}Z`;
}

const utcMinute = (date: Date) => `${date.toISOString().slice(0, 16)}Z`;

/** Where a search looks, as the tool takes it. */
type AreaInput = "view" | "world" | Bbox | { country: string } | { lat: number; lon: number; radiusKm?: number };

export const SEARCH_TOOL_NAME = "search_earthquakes";

export const SEARCH_TOOL_DESCRIPTION =
  "Search the INGV earthquake catalogue (Istituto Nazionale di Geofisica e Vulcanologia) in the INGV Earthquakes panel; the user sees the events on the map. " +
  "Fields left out keep the panel's defaults: the last 7 days, magnitude 2 and above, the current map view, newest first, up to 1000 events. " +
  `Returns the total, the strongest event, counts per depth class and the first ${EVENTS_SHOWN} events in the order asked (id, time in Italy and UTC, magnitude and type, depth, place, position).`;

export const SEARCH_TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    time: {
      type: "string",
      enum: [...TIME_PRESETS.map((p) => p.id), "today"],
      description: 'A period back from now ("24h" = the last 24 hours), or "today" = since midnight Italy time. Default 7d.',
    },
    from: { type: "string", description: "Start of a custom period, Italy time: YYYY-MM-DD or YYYY-MM-DD HH:mm. Replaces time." },
    to: { type: "string", description: "End of a custom period, Italy time: YYYY-MM-DD (the whole day) or YYYY-MM-DD HH:mm. Default now." },
    minMagnitude: { type: "number", minimum: 0, maximum: 8, description: "Default 2. 0 for every event." },
    maxMagnitude: { type: "number", minimum: 0, maximum: 8 },
    minDepth: { type: "number", minimum: 0, maximum: 700, description: "Kilometres." },
    maxDepth: { type: "number", minimum: 0, maximum: 700, description: "Kilometres." },
    area: {
      description:
        'Where: "view" (the current map view, default), "world", a box [west, south, east, north] in WGS84, {"country": ISO 3166-1 alpha-2 code}, or {"lat", "lon", "radiusKm"} for around a point (radius default 30 km).',
      oneOf: [
        { type: "string", enum: ["view", "world"] },
        { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        { type: "object", additionalProperties: false, required: ["country"], properties: { country: { type: "string" } } },
        {
          type: "object",
          additionalProperties: false,
          required: ["lat", "lon"],
          properties: { lat: { type: "number" }, lon: { type: "number" }, radiusKm: { type: "number", exclusiveMinimum: 0 } },
        },
      ],
    },
    order: { type: "string", enum: ["time", "time-asc", "magnitude", "magnitude-asc"], description: "time = newest first (default), magnitude = strongest first." },
    limit: { type: "integer", minimum: 1, description: "Most events returned by the service. Default 1000." },
  },
};

/** The search a tool input asks for, as a link; throws an error the model can act on. */
export function parseSearchInput(input: unknown, now: Date): { link: Link; area: AreaInput } {
  const fields = input ?? {};
  if (!isObject(fields)) throw new Error("The input must be an object.");
  checkKeys(fields, Object.keys(SEARCH_TOOL_SCHEMA.properties as object));
  const params = new URLSearchParams();
  const { time, from, to } = fields;
  if (from !== undefined || to !== undefined || time === "today") {
    if (time !== undefined && time !== "today") throw new Error("time: leave it out with from and to.");
    const start = time === "today" ? italyToUtc(`${italyDateIso(now)} 00:00`) : typeof from === "string" ? italyToUtc(/^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from} 00:00` : from) : null;
    if (!start) throw new Error("from: YYYY-MM-DD or YYYY-MM-DD HH:mm, Italy time.");
    const end = to === undefined ? utcMinute(now) : typeof to === "string" ? italyToUtc(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to} 23:59` : to) : null;
    if (!end) throw new Error("to: YYYY-MM-DD or YYYY-MM-DD HH:mm, Italy time.");
    if (end <= start) throw new Error("to: after from.");
    params.set("ingvTime", "custom");
    params.set("ingvFrom", start);
    params.set("ingvTo", end);
  } else if (time !== undefined) params.set("ingvTime", String(time));
  const { minMagnitude: minM, maxMagnitude: maxM, minDepth, maxDepth } = fields;
  for (const [key, value] of Object.entries({ minMagnitude: minM, maxMagnitude: maxM, minDepth, maxDepth }))
    if (value !== undefined && !isNumber(value)) throw new Error(`${key}: a number.`);
  if (minM !== undefined || maxM !== undefined) params.set("ingvMag", `${minM ?? 0},${maxM ?? 8}`);
  if (minDepth !== undefined || maxDepth !== undefined) params.set("ingvDepth", `${minDepth ?? 0},${maxDepth ?? 700}`);
  const area = (fields.area ?? "view") as AreaInput;
  if (area === "world") params.set("ingvArea", "world");
  else if (Array.isArray(area)) params.set("ingvBox", area.join(","));
  else if (isObject(area) && "country" in area) {
    params.set("ingvArea", "country");
    params.set("ingvCountry", String(area.country));
  } else if (isObject(area) && "lat" in area) {
    params.set("ingvArea", "around");
    params.set("ingvCentre", `${area.lat},${area.lon}`);
    params.set("ingvRadius", String(area.radiusKm ?? 30));
  } else if (area !== "view") throw new Error('area: "view", "world", [west, south, east, north], {"country": "GR"} or {"lat", "lon", "radiusKm"}.');
  if (fields.order !== undefined) params.set("ingvOrder", String(fields.order));
  if (fields.limit !== undefined) params.set("ingvLimit", String(fields.limit));
  const errors: string[] = [];
  const link = linkFrom(params, now, errors) ?? linkFrom(new URLSearchParams("ingvArea=view"), now)!;
  if (errors.length) throw new Error(`Not valid: ${errors.join("; ")}. Magnitude 0-8 with min <= max, depth 0-700 km, a box with west < east and south < north, a country by its ISO code.`);
  // A box filters "Map view" by itself; the map goes there too.
  if (Array.isArray(area)) link.search.area = "view";
  return { link, area };
}

/** One event as the model gets it. */
export function eventInfo(f: EventFeature) {
  const p = f.properties;
  const date = eventDate(p.time);
  const [lon, lat] = f.geometry.coordinates;
  return {
    id: p.eventId,
    timeItaly: `${italyDateIso(date)} ${italyTime(date)}`,
    timeUtc: `${utcDateIso(date)} ${utcTime(date)}`,
    magnitude: p.mag,
    magType: p.magType,
    depthKm: p.depth,
    place: p.place,
    lat,
    lon,
  };
}

const inItaly = (b: Bbox) => b[0] >= ITALY_BOX[0] && b[1] >= ITALY_BOX[1] && b[2] <= ITALY_BOX[2] && b[3] <= ITALY_BOX[3];

/** What a search gives the model: the panel's numbers and its first events, with what to do next. */
export function searchResult(ctl: Controller) {
  const s = ctl.search;
  const features = ctl.state.events?.features ?? [];
  const byDepth = Object.fromEntries(DEPTH_CLASSES.map((c) => [c.label, 0]));
  for (const f of features) {
    const shown = [...DEPTH_CLASSES].reverse().find((c) => f.properties.depth >= c.from) ?? DEPTH_CLASSES[0];
    byDepth[shown.label]++;
  }
  const strongest = features.reduce<EventFeature | null>((best, f) => (!best || f.properties.mag > best.properties.mag ? f : best), null);
  const box = ctl.shared().box;
  const where =
    s.area === "world"
      ? { area: "world" }
      : s.area === "country" && s.country
        ? { area: "country", country: s.country.code, name: s.country.name, box: s.country.bbox }
        : s.area === "around" && s.centre
          ? { area: "around", lat: s.centre.lat, lon: s.centre.lon, radiusKm: s.radiusKm }
          : { area: "box", box };
  const outside =
    s.area === "world" ||
    (s.area === "country" && s.country?.code !== "IT") ||
    (s.area === "around" && s.centre && !inItaly([s.centre.lon, s.centre.lat, s.centre.lon, s.centre.lat])) ||
    (s.area === "view" && box && !inItaly(box));
  const limitReached = features.length >= s.limit;
  const next: string[] = [];
  if (!features.length) next.push("No events: widen one filter at a time (lower minMagnitude, a longer time, a larger area or radius) and tell the user what you tried.");
  if (limitReached) next.push(`The limit of ${s.limit} was reached: the total is at least that. Narrow the search, or raise limit.`);
  if (features.length) next.push("open_event with an id gives its ShakeMap, felt reports and how magnitude and location changed.", "add_to_layers keeps this search as a layer of the project.");
  const notes = [
    "Times: give them in Italy time to the user. magType: ML local, Mw moment, mb body-wave magnitude.",
    ...(outside ? ["Outside Italy and its seas the INGV catalogue lists only the stronger earthquakes (from about M 4.5 in Europe and the Mediterranean, M 5.5 elsewhere): say so when counts matter."] : []),
  ];
  return {
    search: ctl.describe(),
    ...where,
    total: features.length,
    limitReached,
    strongest: strongest ? eventInfo(strongest) : null,
    byDepthKm: byDepth,
    events: features.slice(0, EVENTS_SHOWN).map(eventInfo),
    shown: Math.min(features.length, EVENTS_SHOWN),
    order: s.order,
    next,
    notes,
  };
}

export const OPEN_TOOL_NAME = "open_event";

export const OPEN_TOOL_DESCRIPTION =
  "Open one INGV earthquake in the panel, as a click on it: the map flies to it. Returns its summary, whether it has a ShakeMap (maps of the shaking) and a felt reports map, and how magnitude and location changed from the first automatic estimate to the final one.";

export const OPEN_TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["eventId"],
  properties: { eventId: { type: "integer", minimum: 1, description: "The id of an event, as search_earthquakes gives it." } },
};

const within = <T>(promise: Promise<T>, ms: number, fallback: T) =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

/** The event's products, checked as the detail view does. */
async function eventProducts(id: number) {
  const history = fetch(quakeMlUrl(id))
    .then((r) => (r.ok ? r.text() : ""))
    .then(parseHistory)
    .catch(() => []);
  const [shakeMap, felt, rows] = await Promise.all([
    within(probeImage(`${shakeMapBase(id)}/intensity.jpg`), PROBE_MS, false),
    within(probeImage(feltMapUrl(id)), PROBE_MS, false),
    within(history, 2 * PROBE_MS, []),
  ]);
  const row = (r: (typeof rows)[number]) => ({
    after: formatDelay(r.delay),
    magnitude: r.magnitude,
    magType: r.magType,
    depthKm: r.depth,
    automatic: r.automatic,
  });
  return {
    shakeMap: shakeMap ? { available: true, images: `${shakeMapBase(id)}/intensity.jpg` } : { available: false },
    feltReports: felt ? { available: true, map: feltMapUrl(id), questionnaire: feltQuestionnaireUrl(id) } : { available: false, questionnaire: feltQuestionnaireUrl(id) },
    history: rows.length ? { estimates: rows.length, first: row(rows[0]), final: row(rows.find((r) => r.preferred) ?? rows[rows.length - 1]) } : null,
  };
}

export const ADD_TOOL_NAME = "add_to_layers";

export const ADD_TOOL_DESCRIPTION =
  "Keep the search on screen in the INGV Earthquakes panel as a layer of the GeoLibre project, as its Add to layers button does: the layer stays after the next search. Returns the layer's name.";

/** Text added to the assistant's system prompt while the plugin is on: when and how to use the tools. */
export const ASSISTANT_GUIDANCE = `ingv-geolibre: the INGV Earthquakes panel searches the earthquake catalogue of INGV (Istituto Nazionale di Geofisica e Vulcanologia, Italy) and shows the events on the map. Use its tools for questions about earthquakes ("terremoti", "scosse", "sequenza sismica"); do not answer from memory about recent earthquakes: search.

Order: search_earthquakes, then open_event with an id when the user asks about one event (its ShakeMap, felt reports, how the magnitude changed), add_to_layers when the user wants to keep the result. Follow next and notes in each result.

Searching:
- a place the user names goes in area, never elsewhere: a town or a point as {"lat", "lon", "radiusKm"} (30 km for "near", 50-100 km for a province or "the area of"), a region or a sea as a coarse box [west, south, east, north] you know for it, a country as {"country": ISO code}. "In Italy" is {"country": "IT"}. Without area the search uses the current map view.
- time: "today"/"oggi" is time "today" (since midnight Italy time); "in the last 24 hours" is "24h"; "this week" is "7d"; dates and hours the user gives go in from and to, in Italy time.
- magnitude: the panel starts from M 2. For "all" or small events set minMagnitude 0; for "strong" earthquakes start from 4; "above M 3" is minMagnitude 3.
- "the strongest" or "the biggest": order "magnitude"; "the latest": the default order. The events list holds only the first ${EVENTS_SHOWN}: use total, strongest and byDepthKm for counts.
- coverage: the catalogue is detailed for Italy and its seas (down to M 0.1); elsewhere it lists only stronger events, from about M 4.5 in Europe and the Mediterranean and M 5.5 in the rest of the world. Say it when the user asks about other countries.
- no events: widen one filter at a time and tell the user what you tried.

Answering:
- times in Italy time (timeItaly), with the date; magnitude with its type (ML, Mw); depth in km; the place as INGV names it.
- do not call an event a main shock, foreshock or aftershock ("scossa principale", "precursore", "replica"): the catalogue does not say it.
- the panel shows your last search: when you answer from an earlier one, run it again last.
- link each event you name to its page: https://terremoti.ingv.it/event/<id>.`;

/** Wait for a promise, or end at once when the user presses Stop. */
function stoppable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("Stopped by the user."));
  return Promise.race([promise, new Promise<T>((_, reject) => signal.addEventListener("abort", () => reject(new Error("Stopped by the user.")), { once: true }))]);
}

/**
 * Register the tools and the guidance while the plugin is on; returns the call
 * that removes them. A host without the API gets nothing: the panel works as
 * before.
 */
export function registerAssistantTools(host: IngvHost, ctl: Controller): () => void {
  if (!host.registerAssistantToolSpec) return () => {};
  const disposers = [
    host.registerAssistantToolSpec({
      name: SEARCH_TOOL_NAME,
      description: SEARCH_TOOL_DESCRIPTION,
      inputSchema: SEARCH_TOOL_SCHEMA,
      callback: async (input, context) => {
        const { link } = parseSearchInput(input, new Date());
        await stoppable(ctl.followLink(link), context?.signal);
        if (ctl.state.status === "error") throw new Error(ctl.state.message);
        return searchResult(ctl);
      },
    }),
    host.registerAssistantToolSpec({
      name: OPEN_TOOL_NAME,
      description: OPEN_TOOL_DESCRIPTION,
      inputSchema: OPEN_TOOL_SCHEMA,
      callback: async (input, context) => {
        if (!isObject(input)) throw new Error("The input must be an object with eventId.");
        checkKeys(input, ["eventId"]);
        const id = input.eventId;
        if (typeof id !== "number" || !Number.isInteger(id) || id < 1) throw new Error("eventId: the integer id of an event.");
        await stoppable(ctl.openEvent(id), context?.signal);
        const selected = ctl.state.selected;
        if (selected?.properties.eventId !== id) throw new Error(`Event ${id} is not in the INGV catalogue.`);
        const products = await stoppable(eventProducts(id), context?.signal);
        return { ...eventInfo(selected), locatedBy: selected.properties.author, page: eventPageUrl(id), ...products };
      },
    }),
    host.registerAssistantToolSpec({
      name: ADD_TOOL_NAME,
      description: ADD_TOOL_DESCRIPTION,
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      callback: () => {
        if (!ctl.state.events) throw new Error("No search in the panel yet: call search_earthquakes first.");
        if (!host.addGeoJsonLayer) throw new Error("This version of GeoLibre cannot add layers from plugins.");
        ctl.saveToProject();
        return { layer: `${LAYER_NAME}, ${ctl.describe()}`, events: ctl.state.events.features.length };
      },
    }),
    host.registerAssistantGuidance?.(ASSISTANT_GUIDANCE) ?? (() => {}),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
