import { el, extLink } from "./dom";
import type { MapLike } from "./host";
import { dateLocale, tr } from "./i18n";
import { FAULTS_HIT_ID } from "./faults";
import { MapOverlay } from "./overlay";

/**
 * INGV's Database of Individual Seismogenic Sources (DISS 3.3.1): the
 * potential sources of earthquakes above M 5.5, as their planes projected on
 * the surface. Served by the WFS behind "Download GeoJSON" on
 * diss.ingv.it/download-diss-3-3-1, with CORS (checked 2026-10-27).
 * Licence CC BY 4.0 (Accompanying Notes 3.3.1).
 */
const WFS = "https://services.seismofaults.eu/DISS331/ows?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326&typeName=DISS331:";
export const DISS_PAGE = "https://diss.ingv.it";
export const DISS_DOI = "https://doi.org/10.13127/diss3.3.1";

/** The two kinds shown (user's choice, 2026-10-27), one colour each. */
export const DISS_KINDS = [
  { id: "css", color: "#78716c", label: () => tr("diss.css", "Composite sources"), one: () => tr("diss.cssOne", "Composite source") },
  { id: "iss", color: "#ca8a04", label: () => tr("diss.iss", "Individual sources"), one: () => tr("diss.issOne", "Individual source") },
] as const;

type Collection = { type: "FeatureCollection"; features: unknown[] };
export interface DissData {
  /** Individual sources: one plane each. */
  iss: Collection;
  /** Composite sources: the planes, and their top trace. */
  cssPlanes: Collection;
  cssTop: Collection;
}

async function layer(name: string, signal?: AbortSignal): Promise<Collection> {
  const response = await fetch(WFS + name, { signal });
  if (!response.ok) throw new Error(tr("diss.error", "The DISS service answered {{status}}.", { status: response.status }));
  return (await response.json()) as Collection;
}

/** The individual and composite sources, about 130 KB compressed in all. */
export async function fetchDiss(signal?: AbortSignal): Promise<DissData> {
  const [iss, cssPlanes, cssTop] = await Promise.all(["iss331", "csspln331", "csstop331"].map((n) => layer(n, signal)));
  return { iss, cssPlanes, cssTop };
}

const ISS_FILL = "ingq-diss-iss-fill";
const CSS_FILL = "ingq-diss-css-fill";

/** "0.26-1.87", "1.5", or null when the database gives none. */
function range(min: unknown, max: unknown, digits = 1): string | null {
  const f = (v: unknown) => (typeof v === "number" ? v.toLocaleString(dateLocale(), { maximumFractionDigits: digits }) : null);
  const [a, b] = [f(min), f(max)];
  if (!a && !b) return null;
  return a && b && a !== b ? `${a}-${b}` : (a ?? b);
}

/** A source's popup: name and code, its kind, maximum magnitude and depth, slip rate, latest earthquake, its DISS page. */
function dissPopup(p: Record<string, unknown>) {
  const kind = String(p.idsource ?? "").slice(2, 4) === "IS" ? DISS_KINDS[1] : DISS_KINDS[0];
  const depth = range(p.mindepth, p.maxdepth);
  const slip = range(p.srmin, p.srmax, 2);
  const lines = [
    typeof p.maxmag === "number" ? `${tr("diss.maxmag", "Max magnitude")} ${p.maxmag.toLocaleString(dateLocale(), { minimumFractionDigits: 1 })}` : null,
    depth ? `${tr("diss.depth", "Depth")} ${depth} km` : null,
    slip ? `${tr("diss.slip", "Slip rate")} ${slip} mm/${tr("diss.year", "yr")}` : null,
    p.latesteq ? `${tr("diss.latest", "Latest earthquake")}: ${String(p.latesteq)}` : null,
  ].filter(Boolean) as string[];
  const page = typeof p.linktoinfo === "string" ? p.linktoinfo.replace(/^http:/, "https:") : null;
  return [
    el("strong", {}, String(p.sourcename ?? "")),
    el("div", {}, el("span", { class: "ingq-fault-line", style: { background: kind.color } }), `${kind.one()} · ${String(p.idsource ?? "")}`),
    ...lines.map((l) => el("div", { class: "ingq-muted" }, l)),
    page ? extLink(page, tr("diss.page", "DISS page")) : null,
  ];
}

/** The sources on the map, under the earthquakes and ISPRA's faults: composite sources as bands, individual ones above them. */
export class DissLayer extends MapOverlay {
  constructor(map: MapLike, data: DissData, toolActive: () => boolean) {
    const [css, iss] = DISS_KINDS;
    super(
      map,
      {
        sources: { "ingq-diss-css": data.cssPlanes, "ingq-diss-css-top": data.cssTop, "ingq-diss-iss": data.iss },
        layers: [
          { id: CSS_FILL, type: "fill", source: "ingq-diss-css", paint: { "fill-color": css.color, "fill-opacity": 0.22 } },
          { id: "ingq-diss-css-top", type: "line", source: "ingq-diss-css-top", paint: { "line-color": "#44403c", "line-width": 1.4 } },
          { id: ISS_FILL, type: "fill", source: "ingq-diss-iss", paint: { "fill-color": iss.color, "fill-opacity": 0.3 } },
          { id: "ingq-diss-iss-line", type: "line", source: "ingq-diss-iss", paint: { "line-color": "#a16207", "line-width": 1.2 } },
        ],
        // An individual source lies inside a composite one: it is looked for first.
        hitLayers: [ISS_FILL, CSS_FILL],
        over: ["ingq-faults-lines", FAULTS_HIT_ID],
        popup: dissPopup,
      },
      toolActive,
    );
  }
}
