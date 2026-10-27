import { el } from "./dom";
import type { MapLike } from "./host";

/** The results' circles, drawn over every overlay. */
const POINTS_ID = "ingq-results-points";

export interface OverlaySpec {
  /** GeoJSON sources by id. */
  sources: Record<string, unknown>;
  /** MapLibre layers, in drawing order, all under the earthquakes. */
  layers: Record<string, unknown>[];
  /** Layers a click is looked for in; the topmost feature wins. */
  hitLayers: string[];
  /** Layers of other overlays drawn over this one: added under them, and a click on them wins. */
  over?: string[];
  /** The popup's content for a clicked feature. */
  popup: (properties: Record<string, unknown>) => (HTMLElement | null)[];
}

/**
 * Reference data drawn on the MapLibre map under the earthquakes (ISPRA's
 * faults, INGV's seismogenic sources). A click on a feature, away from an
 * earthquake or an overlay drawn above, shows a small popup; moving the map
 * closes it. A basemap change drops the layers: `styledata` adds them back.
 */
export class MapOverlay {
  private popup: HTMLElement | null = null;
  private readonly onStyleData = () => this.ensure();
  private readonly onClick = (event: { point: { x: number; y: number } }) => {
    this.close();
    if (this.toolActive()) return;
    const box = [event.point.x, event.point.y];
    const present = (ids: string[]) => ids.filter((id) => this.map.getLayer(id));
    // An earthquake, or an overlay drawn above, under the pointer wins the click.
    const above = present([POINTS_ID, ...(this.spec.over ?? [])]);
    if (above.length && this.map.queryRenderedFeatures(box, { layers: above }).length) return;
    const hit = this.map.queryRenderedFeatures(box, { layers: present(this.spec.hitLayers) })[0];
    if (hit) this.open(hit.properties, event.point);
  };
  private readonly onMove = () => this.close();

  constructor(
    private readonly map: MapLike,
    private readonly spec: OverlaySpec,
    private readonly toolActive: () => boolean,
  ) {
    map.on("styledata", this.onStyleData);
    map.on("click", this.onClick);
    map.on("movestart", this.onMove);
    this.ensure();
  }

  private ensure(): void {
    try {
      const map = this.map;
      for (const [id, data] of Object.entries(this.spec.sources)) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data });
      for (const layer of this.spec.layers) {
        const before = [...(this.spec.over ?? []), POINTS_ID].find((id) => map.getLayer(id));
        if (!map.getLayer(layer.id as string)) map.addLayer(layer, before);
      }
    } catch {
      // Style still loading: the next `styledata` retries.
    }
  }

  private open(properties: Record<string, unknown>, point: { x: number; y: number }) {
    this.popup = el("div", { class: "ingq-fault-pop", style: { left: `${point.x}px`, top: `${point.y}px` } }, ...this.spec.popup(properties));
    this.map.getContainer().append(this.popup);
  }

  private close() {
    this.popup?.remove();
    this.popup = null;
  }

  dispose(): void {
    this.close();
    this.map.off("styledata", this.onStyleData);
    this.map.off("click", this.onClick);
    this.map.off("movestart", this.onMove);
    for (const layer of [...this.spec.layers].reverse()) if (this.map.getLayer(layer.id as string)) this.map.removeLayer(layer.id as string);
    for (const id of Object.keys(this.spec.sources)) if (this.map.getSource(id)) this.map.removeSource(id);
  }
}
