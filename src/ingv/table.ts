import { sortEvents, type Controller, type SortKey } from "./controller";
import { dot, el } from "./dom";
import { eventDate, formatDepth, formatMagnitude, italyDateShort, italyTime, toCsv, toGeoJson } from "./format";
import { depthColor } from "./layer";

/** Save a file: GeoLibre's "Save as" dialog when there is one, else a browser download. */
async function save(ctl: Controller, filename: string, content: string, mimeType: string) {
  if (ctl.app.exportTextFile) {
    await ctl.app.exportTextFile(filename, content, { mimeType, extensions: [filename.split(".").pop()!] });
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  el("a", { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The results table, in a floating panel over the map. */
export function renderTable(ctl: Controller, container: HTMLElement): () => void {
  const sub = el("div", { class: "ingq-muted ingq-grow" });
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const csv = el("button", { type: "button", class: "ingq-small", onclick: () => void save(ctl, `ingv-earthquakes-${stamp()}.csv`, toCsv(ctl.state.events?.features ?? []), "text/csv") }, "CSV");
  const geojson = el(
    "button",
    { type: "button", class: "ingq-small", onclick: () => ctl.state.events && void save(ctl, `ingv-earthquakes-${stamp()}.geojson`, toGeoJson(ctl.state.events), "application/geo+json") },
    "GeoJSON",
  );
  const zoom = el("button", { type: "button", class: "ingq-small", title: "Zoom to results", onclick: () => ctl.zoomToResults() }, "Zoom to");
  const addLayer = el("button", { type: "button", class: "ingq-small", title: "Keep this search in the project, as a layer of the Layers panel", onclick: () => ctl.saveToProject() }, "Add to layers");
  const headers: { key: SortKey | null; label: string; cls?: string }[] = [
    { key: "time", label: "Time (Italy)" },
    { key: "mag", label: "Mag" },
    { key: null, label: "Place" },
    { key: "depth", label: "Depth", cls: "ingq-right" },
  ];
  const headCells = headers.map((h) =>
    el("span", { class: `${h.cls ?? ""}${h.key ? " ingq-sortable" : ""}`.trim(), onclick: h.key ? () => sortBy(h.key!) : undefined }, h.label),
  );
  const body = el("div", { class: "ingq-tbody" });
  const root = el(
    "div",
    { class: "ingq-table" },
    el("div", { class: "ingq-table-bar" }, sub, zoom, addLayer, csv, geojson),
    el("div", { class: "ingq-trow ingq-thead" }, ...headCells),
    body,
  );

  function sortBy(key: SortKey) {
    const { sort } = ctl.state;
    ctl.update({ sort: { key, dir: sort.key === key ? (-sort.dir as 1 | -1) : -1 } });
  }

  let drawn: { events: unknown; sort: unknown } = { events: undefined, sort: undefined };
  function render() {
    const { events, sort, selected, hover, view } = ctl.state;
    const features = events?.features ?? [];
    sub.textContent = features.length ? `${features.length.toLocaleString("en")} events · ${ctl.describe()}` : "";
    addLayer.disabled = zoom.disabled = !features.length;
    headCells.forEach((cell, i) => {
      const key = headers[i].key;
      cell.classList.toggle("ingq-on", key === sort.key);
      cell.dataset.arrow = key === sort.key ? (sort.dir < 0 ? "↓" : "↑") : "";
    });
    // Rows are rebuilt only when the events or their order change; marks follow the state.
    if (drawn.events !== events || drawn.sort !== sort) {
      drawn = { events, sort };
      body.replaceChildren(
        ...(features.length
          ? sortEvents(features, sort).map((f) => {
              const p = f.properties;
              const date = eventDate(p.time);
              const row = el(
                "div",
                {
                  class: "ingq-trow",
                  onclick: () => ctl.select(f),
                  onmouseenter: () => ctl.hover(f),
                  onmouseleave: () => ctl.hover(null),
                },
                el("span", { class: "ingq-mono ingq-small-text" }, el("span", { class: "ingq-muted" }, italyDateShort(date)), ` ${italyTime(date).slice(0, 5)}`),
                el("span", { class: "ingq-inline" }, el("strong", {}, formatMagnitude(p.mag)), el("span", { class: "ingq-mono ingq-tiny ingq-muted" }, p.magType)),
                el("span", { class: "ingq-ellipsis", title: p.place }, p.place),
                el("span", { class: "ingq-mono ingq-small-text ingq-right ingq-inline ingq-end" }, formatDepth(p.depth), dot(depthColor(p.depth))),
              );
              row.dataset.id = String(p.eventId);
              return row;
            })
          : [el("div", { class: "ingq-empty" }, "No earthquakes for these filters.")]),
      );
    }
    const selectedId = view === "detail" ? selected?.properties.eventId : undefined;
    for (const row of body.children as HTMLCollectionOf<HTMLElement>) {
      row.classList.toggle("ingq-selected", row.dataset.id === String(selectedId));
      row.classList.toggle("ingq-hover", row.dataset.id === String(hover));
    }
  }

  container.append(root);
  render();
  const unsubscribe = ctl.subscribe(render);
  return () => {
    unsubscribe();
    root.remove();
  };
}
