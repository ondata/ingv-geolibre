import { areaCombo } from "./area-combo";
import { sortEvents, type Controller } from "./controller";
import { wrapsWorld } from "./countries";
import { renderDetail } from "./detail";
import { dot, el, extLink } from "./dom";
import { eventDate, formatDepth, formatMagnitude, italyDateShort, italyTime } from "./format";
import { DEPTH_CLASSES, depthColor } from "./layer";
import { DEFAULT_MAGNITUDE, DEPTH_SCALE, MAGNITUDE_SCALE, TIME_PRESETS, type OrderBy, type TimePresetId } from "./query";
import { rangeSlider } from "./range-slider";

const ORDERS: { id: OrderBy; label: string }[] = [
  { id: "time", label: "Newest first" },
  { id: "time-asc", label: "Oldest first" },
  { id: "magnitude", label: "Magnitude, largest first" },
  { id: "magnitude-asc", label: "Magnitude, smallest first" },
];

const sectionTitle = (text: string) => el("div", { class: "ingq-label" }, text);
const REPO_URL = "https://github.com/ondata/ingv-geolibre";
const GITHUB_ICON =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";

/** The credits, fixed at the bottom of the panel; "i" opens the sources and how to cite them. */
function footer(): HTMLElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "currentColor");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", GITHUB_ICON);
  svg.append(path);
  const github = el("a", { href: REPO_URL, target: "_blank", rel: "noopener noreferrer", class: "ingq-github", title: "github.com/ondata/ingv-geolibre" }, svg);

  const row = (label: string, link: HTMLElement) => [el("span", { class: "ingq-muted" }, label), link];
  const about = el(
    "div",
    { class: "ingq-about" },
    el("div", { class: "ingq-row" }, el("strong", {}, "About the data"), el("button", { type: "button", class: "ingq-close", "aria-label": "Close", onclick: () => toggle() }, "×")),
    el("p", {}, "Earthquake locations and magnitudes come from the Istituto Nazionale di Geofisica e Vulcanologia (INGV), through its FDSN event web service."),
    // Measured over the 30 days before 2026-10-23 (see LOG.md, "Coverage measured").
    el(
      "p",
      {},
      "The catalogue is detailed for Italy and its seas, down to the smallest events (M 0.1). Elsewhere INGV lists only the stronger earthquakes: in the rest of Europe and the Mediterranean from about M 4.5, in the rest of the world from about M 5.5.",
    ),
    el(
      "div",
      { class: "ingq-about-grid" },
      ...row("Source", extLink("https://terremoti.ingv.it", "terremoti.ingv.it")),
      ...row("Web service", extLink("https://webservices.ingv.it/swagger-ui/dist/?url=https://ingv.github.io/openapi/fdsnws/event/0.0.1/event.yaml", "webservices.ingv.it/fdsnws/event/1")),
      ...row("ShakeMap", extLink("https://shakemap.ingv.it", "shakemap.ingv.it")),
      ...row("Felt reports", extLink("https://www.hsit.it", "hsit.it")),
      ...row("Licence", extLink("https://creativecommons.org/licenses/by/4.0/", "CC BY 4.0")),
      ...row("Countries", extLink("https://www.naturalearthdata.com", "Natural Earth 1:110m")),
    ),
    // Citation from DataCite for the DOI of ISIDe, the INGV catalogue the event service serves.
    el("p", { class: "ingq-muted ingq-small-text" }, "Cite as: ISIDe Working Group (2007). Italian Seismological Instrumental and Parametric Database (ISIDe). INGV. ", extLink("https://doi.org/10.13127/ISIDE", "doi:10.13127/ISIDE")),
    el("div", { class: "ingq-about-foot ingq-muted" }, "Plugin source and issues: ", extLink(REPO_URL, "GitHub")),
  );
  const info = el("button", { type: "button", class: "ingq-info", title: "About the data", onclick: () => toggle() }, "i");
  function toggle() {
    about.hidden = !about.hidden;
    info.classList.toggle("ingq-on", !about.hidden);
  }
  about.hidden = true;
  return el("div", { class: "ingq-footer" }, info, el("span", {}, "Data: ", extLink("https://terremoti.ingv.it", "INGV"), ", CC BY 4.0"), github, about);
}

/** The right panel: the search, or the detail of the selected event. */
export function renderPanel(ctl: Controller, container: HTMLElement): () => void {
  const foot = footer();
  const root = el("div", { class: "ingq-panel" }, foot);
  ctl.panelElement = root;
  const search = buildSearch(ctl);
  let detailFor: number | null = null;
  let detail: HTMLElement | null = null;

  function render() {
    const { view, selected } = ctl.state;
    if (view === "detail" && selected) {
      if (detailFor !== selected.properties.eventId) {
        detail?.remove();
        detail = renderDetail(ctl, selected);
        detailFor = selected.properties.eventId;
      }
      if (search.element.isConnected) search.element.remove();
      if (!detail!.isConnected) foot.before(detail!);
    } else {
      detail?.remove();
      detail = null;
      detailFor = null;
      if (!search.element.isConnected) foot.before(search.element);
      search.refresh();
    }
  }

  container.append(root);
  render();
  const unsubscribe = ctl.subscribe(render);
  return () => {
    unsubscribe();
    search.dispose();
    root.remove();
  };
}

function buildSearch(ctl: Controller) {
  // Time
  const chips = [...TIME_PRESETS.map((p) => ({ id: p.id as TimePresetId, label: p.label })), { id: "custom" as const, label: "Custom" }].map((p) =>
    el("button", { type: "button", class: "ingq-chip", onclick: () => ctl.set({ time: p.id }, p.id !== "custom") }, p.label),
  );
  const from = el("input", { type: "datetime-local", step: "60", class: "ingq-input ingq-mono", onchange: () => from.value && ctl.set({ from: from.value }) });
  const to = el("input", { type: "datetime-local", step: "60", class: "ingq-input ingq-mono", onchange: () => to.value && ctl.set({ to: to.value }) });
  const offset = -new Date().getTimezoneOffset() / 60;
  const zone = `UTC${offset >= 0 ? "+" : "-"}${Math.abs(offset)}`;
  const custom = el(
    "div",
    { class: "ingq-custom" },
    el("span", {}, "From"),
    from,
    el("span", {}, "To"),
    to,
    el("span", {}),
    el("span", { class: "ingq-faint ingq-note" }, `Local time (${zone}). INGV is queried in UTC.`),
  );
  const time = el("div", { class: "ingq-group" }, sectionTitle("Time"), el("div", { class: "ingq-chips" }, ...chips), custom);

  // Magnitude
  const numberInput = (onCommit: (v: number) => void) => {
    const input = el("input", { type: "number", step: String(MAGNITUDE_SCALE.step), min: "0", max: "8", class: "ingq-num" });
    input.addEventListener("change", () => {
      const v = parseFloat(input.value);
      if (!Number.isNaN(v)) onCommit(v);
    });
    return input;
  };
  const magLo = numberInput((v) => commitMagnitude([v, ctl.search.magnitude[1]]));
  const magHi = numberInput((v) => commitMagnitude([ctl.search.magnitude[0], v]));
  const magSlider = rangeSlider(
    MAGNITUDE_SCALE,
    ctl.search.magnitude,
    (v) => {
      magLo.value = String(v[0]);
      magHi.value = String(v[1]);
    },
    (v) => ctl.set({ magnitude: v }),
  );
  function commitMagnitude(v: [number, number]) {
    magSlider.set(v);
    ctl.set({ magnitude: magSlider.get() });
  }
  const ticks = el("div", { class: "ingq-ticks" }, ...[0, 2, 4, 6, 8].map((t) => el("span", {}, String(t))));
  const magnitude = el(
    "div",
    { class: "ingq-group ingq-tight" },
    el("div", { class: "ingq-row" }, sectionTitle("Magnitude"), el("div", { class: "ingq-pair" }, magLo, el("span", { class: "ingq-muted" }, "-"), magHi)),
    magSlider.element,
    ticks,
  );

  // Area
  const combo = areaCombo((area, country) => {
    // A country moves the map to it, unless its box spans the whole world.
    if (country && !wrapsWorld(country.bbox)) ctl.app.fitBounds?.(country.bbox);
    ctl.set({ area, country, centre: null });
  });
  const countryBbox = el("span", { class: "ingq-mono" });
  const countryNote = el("span", {});
  // Measured on 2026-10-23: in Greece's box the catalogue has 59 events in 2026, the smallest M 2.6; in Italy's, 13,025.
  const abroadNote = el("span", {}, "The INGV catalogue is centred on Italy: elsewhere it lists mostly the stronger earthquakes.");
  const countryInfo = el("div", { class: "ingq-country" }, countryBbox, countryNote, abroadNote);
  const centreText = el("span", { class: "ingq-mono" });
  const radius = el("input", { type: "number", min: "1", max: "500", class: "ingq-num ingq-num-wide" });
  radius.addEventListener("change", () => {
    const v = parseFloat(radius.value);
    if (v > 0) ctl.set({ radiusKm: v });
  });
  const around = el(
    "div",
    { class: "ingq-around" },
    el("div", { class: "ingq-row" }, el("span", { class: "ingq-muted" }, "Centre"), centreText),
    el("div", { class: "ingq-row" }, el("span", { class: "ingq-muted" }, "Radius"), el("span", { class: "ingq-pair" }, radius, el("span", {}, "km"))),
    el("div", { class: "ingq-muted" }, "The centre follows the map; click the map to fix it."),
  );
  const area = el("div", { class: "ingq-group" }, sectionTitle("Area"), combo.element, countryInfo, around);

  // Search, result, legend
  const count = el("span", { class: "ingq-count" });
  const strongest = el("span", { class: "ingq-muted" });
  const zoomLink = el("a", { href: "#", class: "ingq-link", onclick: (e: Event) => (e.preventDefault(), ctl.zoomToResults()) }, "Zoom to results");
  const tableLink = el("a", { href: "#", class: "ingq-link ingq-table-link", onclick: (e: Event) => (e.preventDefault(), ctl.openTable()) }, "Show table");
  const message = el("div", { class: "ingq-message" });
  const legend = el(
    "div",
    { class: "ingq-legend" },
    el("span", {}, "Depth"),
    ...DEPTH_CLASSES.map((c, i) =>
      el(
        "button",
        {
          type: "button",
          class: "ingq-depth",
          onclick: () => ctl.set({ depthOn: ctl.search.depthOn.map((on, k) => (k === i ? !on : on)) }),
        },
        dot(c.color),
        c.label,
      ),
    ),
  );
  const depthButtons = [...legend.querySelectorAll<HTMLButtonElement>(".ingq-depth")];
  const searchButton = el("button", { type: "button", class: "ingq-primary", onclick: () => void ctl.run() }, "Search");
  const result = el(
    "div",
    { class: "ingq-group ingq-result" },
    searchButton,
    el("div", { class: "ingq-row" }, el("div", {}, count, strongest), el("div", { class: "ingq-links" }, zoomLink, tableLink)),
    message,
    legend,
  );

  // More filters
  const depthText = el("span", { class: "ingq-mono" });
  const depthSlider = rangeSlider(
    DEPTH_SCALE,
    ctl.search.depth,
    (v) => (depthText.textContent = `${v[0]} - ${v[1]} km`),
    (v) => ctl.set({ depth: v }),
  );
  const order = el("select", { class: "ingq-input", onchange: () => ctl.set({ order: order.value as OrderBy }) }, ...ORDERS.map((o) => el("option", { value: o.id }, o.label)));
  const limit = el("input", { type: "number", min: "1", class: "ingq-num ingq-num-wide" });
  limit.addEventListener("change", () => {
    const v = parseInt(limit.value, 10);
    if (v > 0) ctl.set({ limit: v });
  });
  const moreBody = el(
    "div",
    { class: "ingq-more-body" },
    el("div", { class: "ingq-group ingq-tight" }, el("div", { class: "ingq-row" }, el("span", { class: "ingq-muted" }, "Depth"), depthText), depthSlider.element),
    el("div", { class: "ingq-row" }, el("span", { class: "ingq-muted" }, "Order"), order),
    el("div", { class: "ingq-row" }, el("span", { class: "ingq-muted" }, "Limit"), limit),
  );
  const moreChev = el("span", { class: "ingq-chev" });
  let moreOpen = false;
  const moreToggle = el("button", { type: "button", class: "ingq-disclosure", onclick: () => ((moreOpen = !moreOpen), refresh()) }, moreChev, "More filters");
  const more = el("div", { class: "ingq-more" }, moreToggle, moreBody);

  const live = el("input", { type: "checkbox", class: "ingq-check", onchange: () => ctl.setLiveZoom(live.checked) });
  const liveRow = el(
    "label",
    { class: "ingq-live", title: "Fit the map to the results every time a filter changes" },
    live,
    el("span", {}, "Live zoom"),
    el("span", { class: "ingq-faint" }, "fit map to results on every filter change"),
  );

  // Small screens (GeoLibre docks the panel under the map below 768 px): the
  // period stays on top, then two tabs, the results as a list and the filters.
  let tab: "results" | "filters" = "results";
  const tabButton = (id: typeof tab, label: string) =>
    el("button", { type: "button", class: "ingq-tab", onclick: () => ((tab = id), refresh()) }, label);
  const resultsTab = tabButton("results", "Results");
  const filtersTab = tabButton("filters", "Filters");
  const tabs = el("div", { class: "ingq-tabs" }, resultsTab, filtersTab);
  const list = el("div", { class: "ingq-list" });
  let listed: unknown;
  function drawList() {
    const { events, sort } = ctl.state;
    if (listed === events) return;
    listed = events;
    list.replaceChildren(
      ...sortEvents(events?.features ?? [], sort).map((f) => {
        const p = f.properties;
        const date = eventDate(p.time);
        return el(
          "button",
          { type: "button", class: "ingq-list-row", onclick: () => ctl.select(f) },
          el("span", { class: "ingq-list-mag" }, el("strong", {}, formatMagnitude(p.mag)), el("span", { class: "ingq-mono ingq-tiny ingq-muted" }, p.magType)),
          el("span", { class: "ingq-list-place" }, el("span", { class: "ingq-ellipsis" }, p.place), el("span", { class: "ingq-muted ingq-small-text" }, `${italyDateShort(date)} · ${italyTime(date).slice(0, 5)}`)),
          el("span", { class: "ingq-mono ingq-small-text ingq-inline" }, formatDepth(p.depth), dot(depthColor(p.depth))),
        );
      }),
    );
  }
  for (const [node, where] of [[time, "both"], [tabs, "both"], [result, "results"], [list, "results"], [liveRow, "filters"], [magnitude, "filters"], [area, "filters"], [more, "filters"]] as const)
    node.dataset.tab = where;

  const element = el("div", { class: "ingq-search" }, liveRow, time, tabs, magnitude, area, result, list, more);

  // Click on the map moves the centre of "Around".
  const map = ctl.app.getMap?.();
  const onMapClick = (event: { lngLat: { lng: number; lat: number } }) => {
    if (ctl.search.area !== "around" || ctl.state.view !== "search") return;
    ctl.set({ centre: { lat: event.lngLat.lat, lon: event.lngLat.lng } });
  };
  map?.on("click", onMapClick);

  function refresh() {
    const s = ctl.search;
    const st = ctl.state;
    chips.forEach((c, i) => c.classList.toggle("ingq-on", (i < TIME_PRESETS.length ? TIME_PRESETS[i].id : "custom") === s.time));
    custom.hidden = s.time !== "custom";
    from.value = s.from;
    to.value = s.to;
    depthButtons.forEach((b, i) => {
      b.classList.toggle("ingq-off", !s.depthOn[i]);
      b.title = s.depthOn[i] ? "Hide" : "Show";
    });
    magSlider.set(s.magnitude);
    magLo.value = String(s.magnitude[0]);
    magHi.value = String(s.magnitude[1]);
    combo.show(s.area, s.country);
    const c = s.area === "country" ? s.country : null;
    countryInfo.hidden = !c;
    if (c) {
      countryBbox.textContent = `${c.bbox[0]}, ${c.bbox[1]} → ${c.bbox[2]}, ${c.bbox[3]}`;
      countryNote.textContent = wrapsWorld(c.bbox)
        ? "Crosses the 180° meridian: the search uses the country's latitude band."
        : "Bounding box from Natural Earth 1:110m. The map fits to it.";
      abroadNote.hidden = c.code === "IT";
    }
    around.hidden = s.area !== "around";
    const centre = s.centre ?? ctl.usedCentre;
    centreText.textContent = `${centre ? `${centre.lat.toFixed(2)} N, ${centre.lon.toFixed(2)} E` : "map centre"}${s.centre ? " (fixed)" : ""}`;
    radius.value = String(s.radiusKm);
    depthSlider.set(s.depth);
    depthText.textContent = `${s.depth[0]} - ${s.depth[1]} km`;
    order.value = s.order;
    limit.value = String(s.limit);
    moreBody.hidden = !moreOpen;
    moreChev.textContent = moreOpen ? "▾" : "▸";

    const features = st.events?.features ?? [];
    searchButton.disabled = st.status === "loading";
    if (st.status === "done") {
      const n = features.length;
      count.textContent = n ? `${n.toLocaleString("en")} ${n === 1 ? "earthquake" : "earthquakes"}` : "No earthquakes";
      const top = n ? Math.max(...features.map((f) => f.properties.mag)) : null;
      const hiddenNote = ctl.hiddenNote();
      strongest.textContent =
        (top !== null ? `, strongest M\u00a0${formatMagnitude(top)}` : "") + (hiddenNote ? (n ? `; ${hiddenNote}` : ` (${hiddenNote})`) : "");
      message.textContent = n >= s.limit ? `The limit of ${s.limit} was reached: narrow the search or raise the limit.` : "";
    } else {
      count.textContent = "";
      strongest.textContent = "";
      message.textContent = st.message;
    }
    message.hidden = !message.textContent;
    live.checked = st.liveZoom;
    zoomLink.hidden = st.liveZoom || st.status !== "done" || !features.length;
    tableLink.hidden = st.tableOpen || !features.length;

    element.dataset.show = tab;
    resultsTab.classList.toggle("ingq-on", tab === "results");
    filtersTab.classList.toggle("ingq-on", tab === "filters");
    const changed = [
      s.magnitude[0] !== DEFAULT_MAGNITUDE[0] || s.magnitude[1] !== DEFAULT_MAGNITUDE[1],
      s.area !== "view",
      s.depth[0] !== DEPTH_SCALE.min || s.depth[1] !== DEPTH_SCALE.max,
    ].filter(Boolean).length;
    filtersTab.textContent = changed ? `Filters · ${changed}` : "Filters";
    drawList();
  }

  return {
    element,
    refresh,
    dispose: () => map?.off("click", onMapClick),
  };
}
