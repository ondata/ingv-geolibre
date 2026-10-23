import type { EventCollection } from "./events";
import type { IngvHost } from "./host";

/** Name of a saved search in GeoLibre's Layers panel, before its period and magnitudes. */
export const LAYER_NAME = "INGV Earthquakes";

/**
 * Depth classes, shallow (red) to deep (blue). Each class starts at its value,
 * in kilometres, and runs to the next one.
 */
export const DEPTH_CLASSES: { from: number; color: string; label: string }[] = [
  { from: 0, color: "#dc2626", label: "0-10 km" },
  { from: 10, color: "#f59e0b", label: "10-30" },
  { from: 30, color: "#60a5fa", label: "30-100" },
  { from: 100, color: "#1d4ed8", label: ">100" },
];

/** Colour of the depth class of a depth in km. */
export function depthColor(depth: number): string {
  return [...DEPTH_CLASSES].reverse().find((c) => depth >= c.from)?.color ?? DEPTH_CLASSES[0].color;
}

/** Circle radius in pixels at these magnitudes, linear in between and clamped outside. */
export const RADIUS_BY_MAGNITUDE = { minMag: 2, minRadius: 3, maxMag: 6, maxRadius: 18 };

/** `step` on depth: GeoLibre's "Import style" reads it back as a graduated colour, with its legend. */
export function circleColor(): unknown[] {
  const [first, ...rest] = DEPTH_CLASSES;
  return ["step", ["to-number", ["get", "depth"], first.from], first.color, ...rest.flatMap((c) => [c.from, c.color])];
}

/** Linear `interpolate` on magnitude: read back as a proportional size. */
export function circleRadius(): unknown[] {
  const { minMag, minRadius, maxMag, maxRadius } = RADIUS_BY_MAGNITUDE;
  return ["interpolate", ["linear"], ["to-number", ["get", "mag"], minMag], minMag, minRadius, maxMag, maxRadius];
}

/** The Mapbox GL style of a saved search, in the shapes GeoLibre's "Import style" reads as its own renderers. */
export function eventsStyle(): string {
  return JSON.stringify({
    version: 8,
    sources: {},
    layers: [
      {
        id: "ingv-earthquakes",
        type: "circle",
        source: "ingv-earthquakes",
        paint: { "circle-color": circleColor(), "circle-radius": circleRadius(), "circle-stroke-color": "#333333", "circle-stroke-width": 0.5 },
      },
    ],
  });
}

/** Keep a search in the project: a styled GeoJSON layer of the Layers panel. Returns its id. */
export function addToProject(app: IngvHost, events: EventCollection, name: string): string {
  // Strongest first, so the small circles of a sequence are drawn over the big one.
  const data = { ...events, features: [...events.features].sort((a, b) => b.properties.mag - a.properties.mag) };
  const id = app.addGeoJsonLayer!(name, data);
  app.importLayerStyle?.(id, eventsStyle());
  return id;
}
