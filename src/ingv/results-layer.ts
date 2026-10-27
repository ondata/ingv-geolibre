import type { EventCollection, EventFeature } from "./events";
import type { MapLike } from "./host";
import { circleColor, circleRadius } from "./layer";

const SOURCE_ID = "ingq-results";
const POINTS_ID = "ingq-results-points";
const RING_ID = "ingq-results-ring";
const LAYER_IDS = [POINTS_ID, RING_ID];
const EMPTY: EventCollection = { type: "FeatureCollection", features: [] };

/**
 * The events of the current search, drawn straight on the MapLibre map and
 * replaced by every search. GeoLibre 3.4.0 gives a plugin no call to remove or
 * update a layer of the project, so a project layer per search would pile up
 * (seen in Desktop on 2026-10-23); openrndt-geolibre draws its results the same
 * way. "Add to layers" in the table keeps a search in the project.
 * A basemap change rebuilds the style and drops these layers: `styledata` adds them back.
 */
export class ResultsLayer {
  private data: EventCollection = EMPTY;
  private ring: number | null = null;
  /** Events a chart lights up: ringed, the others faded. */
  private lit: number[] | null = null;
  /** "Show on map" in the panel: off hides the circles and keeps the search. */
  private visible = true;
  private readonly onStyleData = () => this.ensure();
  private readonly onClick = (event: { features?: { properties: Record<string, unknown> }[] }) => {
    if (this.toolActive()) return;
    const id = Number(event.features?.[0]?.properties.eventId);
    const feature = this.data.features.find((f) => f.properties.eventId === id);
    if (feature) this.onSelect(feature);
  };
  private readonly onEnter = () => {
    if (!this.toolActive()) this.map.getCanvas().style.cursor = "pointer";
  };
  private readonly onLeave = () => {
    this.map.getCanvas().style.cursor = "";
  };

  constructor(
    private readonly map: MapLike,
    private readonly onSelect: (feature: EventFeature) => void,
    /** True while a host tool (Identify, selection, GeoEditor) owns map clicks. */
    private readonly toolActive: () => boolean,
  ) {
    map.on("styledata", this.onStyleData);
    map.on("click", POINTS_ID, this.onClick);
    map.on("mouseenter", POINTS_ID, this.onEnter);
    map.on("mouseleave", POINTS_ID, this.onLeave);
    this.ensure();
  }

  private ensure(): void {
    try {
      this.addToMap();
    } catch {
      // Style still loading: the next `styledata` retries.
    }
  }

  private addToMap(): void {
    const map = this.map;
    if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: "geojson", data: this.data });
    if (!map.getLayer(POINTS_ID)) {
      map.addLayer({
        id: POINTS_ID,
        type: "circle",
        source: SOURCE_ID,
        layout: { visibility: this.visibility() },
        paint: { "circle-color": circleColor(), "circle-radius": circleRadius(), "circle-stroke-color": "#333333", "circle-stroke-width": 0.5, ...this.fade() },
      });
    }
    if (!map.getLayer(RING_ID)) {
      map.addLayer({
        id: RING_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: this.ringFilter(),
        layout: { visibility: this.visibility() },
        paint: { "circle-radius": ["+", circleRadius(), 6], "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 3, "circle-stroke-color": "#2563eb" },
      });
    }
    // A layer added later (a new basemap, a project layer) would cover the results.
    const order = map.getLayersOrder();
    if (order.slice(-LAYER_IDS.length).join() !== LAYER_IDS.join()) for (const id of LAYER_IDS) map.moveLayer(id);
  }

  private ringFilter(): unknown {
    const one = ["==", ["get", "eventId"], this.ring ?? -1];
    return this.lit ? ["any", one, ["in", ["get", "eventId"], ["literal", this.lit]]] : one;
  }

  /** Opacity of the points: the ones a chart does not light up fade. */
  private fade(): Record<string, unknown> {
    const opacity = this.lit ? ["case", ["in", ["get", "eventId"], ["literal", this.lit]], 1, 0.15] : 1;
    return { "circle-opacity": opacity, "circle-stroke-opacity": opacity };
  }

  private visibility(): "visible" | "none" {
    return this.visible ? "visible" : "none";
  }

  /** Show or hide the circles of the search, without dropping them. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.ensure();
    for (const id of LAYER_IDS) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", this.visibility());
  }

  private refresh(): void {
    this.ensure();
    if (this.map.getLayer(RING_ID)) this.map.setFilter(RING_ID, this.ringFilter());
    if (this.map.getLayer(POINTS_ID)) for (const [name, value] of Object.entries(this.fade())) this.map.setPaintProperty(POINTS_ID, name, value);
  }

  setData(events: EventCollection): void {
    // Strongest first, so the small circles of a sequence are drawn over the big one.
    this.data = { ...events, features: [...events.features].sort((a, b) => b.properties.mag - a.properties.mag) };
    this.ring = null;
    this.lit = null;
    this.ensure();
    this.map.getSource(SOURCE_ID)?.setData(this.data);
    this.refresh();
  }

  /** A ring around one event: the row under the pointer, or the event in the panel. */
  setRing(eventId: number | null): void {
    this.ring = eventId;
    this.refresh();
  }

  /** Light up the events of a bar or a class of the charts; null: all as usual. */
  setLit(eventIds: number[] | null): void {
    this.lit = eventIds;
    this.refresh();
  }

  dispose(): void {
    this.map.off("styledata", this.onStyleData);
    this.map.off("click", POINTS_ID, this.onClick);
    this.map.off("mouseenter", POINTS_ID, this.onEnter);
    this.map.off("mouseleave", POINTS_ID, this.onLeave);
    for (const id of [...LAYER_IDS].reverse()) if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID);
  }
}
