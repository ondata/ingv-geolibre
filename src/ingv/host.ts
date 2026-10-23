import type { GeoLibreAppAPI, GeoLibreFeatureCollection, GeoLibreFloatingPanelRegistration, GeoLibreMapControlPosition } from "../lib/geolibre/host-api";
import type { Bbox } from "./query";

/** The few MapLibre map members the plugin uses, typed here to avoid bundling maplibre-gl. */
export interface MapLike {
  on(type: string, listener: (event: never) => void): void;
  on(type: string, layerId: string, listener: (event: never) => void): void;
  once(type: string, listener: () => void): void;
  off(type: string, listener: (event: never) => void): void;
  off(type: string, layerId: string, listener: (event: never) => void): void;
  flyTo(options: { center: [number, number]; zoom?: number }): void;
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  getCanvas(): HTMLCanvasElement;
  addSource(id: string, source: unknown): void;
  getSource(id: string): { setData(data: unknown): void } | undefined;
  addLayer(layer: unknown): void;
  getLayer(id: string): unknown;
  getLayersOrder(): string[];
  moveLayer(id: string): void;
  setFilter(id: string, filter: unknown): void;
  removeLayer(id: string): void;
  removeSource(id: string): void;
}

/**
 * Host methods this plugin uses beyond the template's `host-api.ts`. Signatures
 * from opengeos/GeoLibre `docs/plugin-api.md` (2026-10-23). All optional: the
 * plugin checks each one and degrades when it is missing.
 */
export interface IngvHostExtras {
  addGeoJsonLayer?: (name: string, data: GeoLibreFeatureCollection, sourcePath?: string) => string;
  /** Applies an SLD, QML or Mapbox GL style, as "Import style" of the Layers panel does. */
  importLayerStyle?: (layerId: string, text: string) => { ok: boolean; warnings: string[]; reason?: string };
  getViewBounds?: () => Bbox | null;
  fitBounds?: (bounds: Bbox) => void;
  getMap?: () => MapLike | null;
  /**
   * The floating panel registration takes the corner it first opens at and a
   * height. GeoLibre 3.4.0 measures the card before the plugin fills it, so a
   * card anchored at the bottom without `defaultHeight` grows off the screen.
   */
  registerFloatingPanel?: (
    panel: GeoLibreFloatingPanelRegistration & { position?: GeoLibreMapControlPosition; defaultHeight?: number },
  ) => () => void;
  /** The host tool that owns map clicks, or null (GeoLibre 3.4.0). */
  getActiveMapTool?: () => string | null;
  /** Desktop-native downloader of Add Vector Layer; null when no loader can serve the URL (most URLs in a browser). */
  fetchVectorUrl?: (url: string) => Promise<File | null>;
  /** Save a text file through the system "Save as" dialog (GeoLibre 3.1.0). */
  exportTextFile?: (filename: string, content: string, options?: { description?: string; extensions?: string[]; mimeType?: string }) => Promise<unknown> | unknown;
}

export type IngvHost = GeoLibreAppAPI & IngvHostExtras;
