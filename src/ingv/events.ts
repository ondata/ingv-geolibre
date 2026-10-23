/** Give up on a search after this long. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Properties of an event as the service sends them, plus `depth` copied from the third coordinate. */
export interface EventProperties {
  eventId: number;
  originId: number;
  /** UTC, without the `Z`. */
  time: string;
  mag: number;
  magType: string;
  magAuthor: string;
  place: string;
  type: string;
  author: string;
  version: number;
  /** Kilometres. */
  depth: number;
  /** Link to the event page, as markup: the one field GeoLibre's default popup renders as a link. */
  description: string;
}

/** The event page on terremoti.ingv.it. */
export const eventPageUrl = (eventId: number) => `https://terremoti.ingv.it/event/${eventId}`;

export interface EventFeature {
  type: "Feature";
  properties: EventProperties;
  geometry: { type: "Point"; coordinates: [number, number, number] };
}

export interface EventCollection {
  type: "FeatureCollection";
  features: EventFeature[];
}

/** GeoLibre renders `<a>` in a `description` field as a link opening in a new window. */
function eventLink(eventId: number): string {
  const url = eventPageUrl(eventId);
  return `<a href="${url}">${url.replace("https://", "")}</a>`;
}

/**
 * Add the link to the event page, copy the depth into the properties, where GeoLibre's styling and popups can
 * read it, and drop the service's own creation time, which is not about the event.
 */
export function normalizeEvents(json: unknown): EventCollection {
  const features = (json as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) throw new Error("The INGV service sent an answer that is not GeoJSON.");
  return {
    type: "FeatureCollection",
    features: features.map((raw) => {
      const feature = raw as { properties: Record<string, unknown>; geometry: EventFeature["geometry"] };
      const properties = { ...feature.properties };
      delete properties.geojson_creationTime;
      return {
        type: "Feature",
        properties: {
          ...properties,
          depth: feature.geometry.coordinates[2],
          description: eventLink(Number(properties.eventId)),
        } as EventProperties,
        geometry: feature.geometry,
      };
    }),
  };
}

/** The service's error text without the echo of the request and the footer. */
export function errorText(body: string): string {
  const text = body.replace(/\s+/g, " ").trim();
  // "Bad Request: " opens the message too: the echo is the "Request: " followed by a URL.
  return text.replace(/ Request: https?:.*$/, "").replace(/^Error \d+ /, "");
}

/** Run a query URL. A 204 is the service's answer for no events. */
export async function fetchEvents(url: string, signal?: AbortSignal): Promise<EventCollection> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (response.status === 204) return { type: "FeatureCollection", features: [] };
  if (!response.ok) {
    throw new Error(`The INGV service answered ${response.status}: ${errorText(await response.text())}`);
  }
  return normalizeEvents(await response.json());
}
