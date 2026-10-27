import { el, extLink } from "./dom";
import type { MapLike } from "./host";
import { tr } from "./i18n";
import { MapOverlay } from "./overlay";

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
/** Wide and invisible: a thin line is hard to click. */
export const FAULTS_HIT_ID = "ingq-faults-hit";

/** The catalogue's own kinematics, worth showing when it says more than the group: "Normal Oblique SX". */
const detail = (kinematics: unknown) => typeof kinematics === "string" && !["Normal", "Reverse", "ND", ""].includes(kinematics);

const lineColor = () => ["match", ["get", "kind"], ...FAULT_KINDS.flatMap((k) => [k.id, k.color]), FAULT_KINDS[3].color];

/** A fault's popup: name, kinematics, rank and region, its ITHACA page. */
function faultPopup(p: Record<string, unknown>) {
  const page = faultPage(p.url);
  const rank = p.rank === "Primary" ? tr("faults.primary", "Primary") : p.rank === "Secondary" ? tr("faults.secondary", "Secondary") : tr("faults.ndShort", "n.d.");
  const kind = FAULT_KINDS.find((k) => k.id === p.kind) ?? FAULT_KINDS[3];
  return [
    el("strong", {}, String(p.faultname ?? "")),
    el("div", {}, el("span", { class: "ingq-fault-line", style: { background: kind.color } }), kind.label() + (detail(p.kinematics) ? ` (${String(p.kinematics)})` : "")),
    el("div", { class: "ingq-muted" }, `${tr("faults.rank", "Rank")}: ${rank} · ${String(p.regionname ?? "")}`),
    page ? extLink(page, tr("faults.page", "ITHACA page")) : null,
  ];
}

/** ISPRA's faults on the map, under the earthquakes, coloured by kinematics. */
export class FaultsLayer extends MapOverlay {
  constructor(map: MapLike, data: FaultCollection, toolActive: () => boolean) {
    super(
      map,
      {
        sources: { [SOURCE_ID]: data },
        layers: [
          { id: "ingq-faults-lines", type: "line", source: SOURCE_ID, paint: { "line-color": lineColor(), "line-width": 1.6 } },
          { id: FAULTS_HIT_ID, type: "line", source: SOURCE_ID, paint: { "line-color": "#000", "line-width": 12, "line-opacity": 0 } },
        ],
        hitLayers: [FAULTS_HIT_ID],
        popup: faultPopup,
      },
      toolActive,
    );
  }
}
