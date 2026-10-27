import { el, extLink } from "./dom";
import type { MapLike } from "./host";
import { tr } from "./i18n";

/**
 * ISPRA's catalogue of capable faults (ITHACA), the faults that can break the
 * surface: one WFS layer of 2,653 lines over Italy, 1.8 MB as GeoJSON, with
 * CORS (checked 2026-10-27). Licence CC BY 4.0, from the RNDT record
 * `ispra_rm:meet-ithaca-default-MD` (user's choice, 2026-10-27).
 */
export const FAULTS_URL =
  "https://sgi2.isprambiente.it/geoserver/ge-core1/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=ge-core1:ITHACA&outputFormat=application/json&srsName=EPSG:4326";
export const FAULTS_PAGE = "https://sgi.isprambiente.it/ithacaweb/";

export type FaultKind = "normal" | "reverse" | "strike" | "nd";

/** Groups of the catalogue's kinematics, with their line colour: obliques go with the normal or reverse part. */
export const FAULT_KINDS: { id: FaultKind; color: string; label: () => string }[] = [
  { id: "normal", color: "#9333ea", label: () => tr("faults.normal", "Normal") },
  { id: "reverse", color: "#0d9488", label: () => tr("faults.reverse", "Reverse") },
  { id: "strike", color: "#db2777", label: () => tr("faults.strike", "Strike-slip") },
  { id: "nd", color: "#6b7280", label: () => tr("faults.nd", "Not determined") },
];

/** "Normal Oblique SX" -> normal, "Strike Slip DX" -> strike, "ND" or none -> nd. */
export function faultKind(kinematics: unknown): FaultKind {
  const k = String(kinematics ?? "").toLowerCase();
  if (k.includes("normal")) return "normal";
  if (k.includes("reverse")) return "reverse";
  if (k.includes("strike")) return "strike";
  return "nd";
}

/**
 * The fault's page in the ITHACA catalogue. The data give it on
 * sgi2.isprambiente.it over http, which answers 500; the same page on
 * sgi.isprambiente.it answers (checked 2026-10-27).
 */
export const faultPage = (url: unknown) =>
  typeof url === "string" && url ? url.replace(/^https?:\/\/sgi2\.isprambiente\.it\/ithacaweb\//, FAULTS_PAGE) : null;

interface FaultCollection {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: unknown; properties: Record<string, unknown> }[];
}

/** The whole catalogue, each fault with its `kind` for the style. */
export async function fetchFaults(signal?: AbortSignal): Promise<FaultCollection> {
  const response = await fetch(FAULTS_URL, { signal });
  if (!response.ok) throw new Error(tr("faults.error", "The ISPRA fault service answered {{status}}.", { status: response.status }));
  const data = (await response.json()) as FaultCollection;
  for (const f of data.features) f.properties.kind = faultKind(f.properties.kinematics);
  return data;
}

const SOURCE_ID = "ingq-faults";
const LINES_ID = "ingq-faults-lines";
/** Wide and invisible: a thin line is hard to click. */
const HIT_ID = "ingq-faults-hit";
/** The results' circles, drawn over the faults. */
const POINTS_ID = "ingq-results-points";

/** The catalogue's own kinematics, worth showing when it says more than the group: "Normal Oblique SX". */
const detail = (kinematics: unknown) => typeof kinematics === "string" && !["Normal", "Reverse", "ND", ""].includes(kinematics);

const lineColor = () => ["match", ["get", "kind"], ...FAULT_KINDS.flatMap((k) => [k.id, k.color]), FAULT_KINDS[3].color];

/**
 * The faults drawn on the MapLibre map, under the earthquakes. A click on a
 * fault, away from an earthquake, shows its name, kinematics and page.
 */
export class FaultsLayer {
  private popup: HTMLElement | null = null;
  private readonly onStyleData = () => this.ensure();
  private readonly onClick = (event: { point: { x: number; y: number } }) => {
    this.close();
    if (this.toolActive()) return;
    const box = [event.point.x, event.point.y];
    // An earthquake under the pointer wins: its click opens the event.
    if (this.map.getLayer(POINTS_ID) && this.map.queryRenderedFeatures(box, { layers: [POINTS_ID] }).length) return;
    const hit = this.map.queryRenderedFeatures(box, { layers: [HIT_ID] })[0];
    if (hit) this.open(hit.properties, event.point);
  };
  private readonly onMove = () => this.close();

  constructor(
    private readonly map: MapLike,
    private readonly data: FaultCollection,
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
      if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: "geojson", data: this.data });
      const before = map.getLayer(POINTS_ID) ? POINTS_ID : undefined;
      if (!map.getLayer(LINES_ID)) map.addLayer({ id: LINES_ID, type: "line", source: SOURCE_ID, paint: { "line-color": lineColor(), "line-width": 1.6 } }, before);
      if (!map.getLayer(HIT_ID)) map.addLayer({ id: HIT_ID, type: "line", source: SOURCE_ID, paint: { "line-color": "#000", "line-width": 12, "line-opacity": 0 } }, before);
    } catch {
      // Style still loading: the next `styledata` retries.
    }
  }

  private open(p: Record<string, unknown>, point: { x: number; y: number }) {
    const page = faultPage(p.url);
    const rank = p.rank === "Primary" ? tr("faults.primary", "Primary") : p.rank === "Secondary" ? tr("faults.secondary", "Secondary") : tr("faults.ndShort", "n.d.");
    const kind = FAULT_KINDS.find((k) => k.id === p.kind) ?? FAULT_KINDS[3];
    this.popup = el(
      "div",
      { class: "ingq-fault-pop", style: { left: `${point.x}px`, top: `${point.y}px` } },
      el("strong", {}, String(p.faultname ?? "")),
      el("div", {}, el("span", { class: "ingq-fault-line", style: { background: kind.color } }), kind.label() + (detail(p.kinematics) ? ` (${String(p.kinematics)})` : "")),
      el("div", { class: "ingq-muted" }, `${tr("faults.rank", "Rank")}: ${rank} · ${String(p.regionname ?? "")}`),
      page ? extLink(page, tr("faults.page", "ITHACA page")) : null,
    );
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
    for (const id of [HIT_ID, LINES_ID]) if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID);
  }
}
