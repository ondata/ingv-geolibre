import { areaCombo } from "./area-combo";
import { sortEvents, type Controller } from "./controller";
import { wrapsWorld } from "./countries";
import { renderDetail } from "./detail";
import { dot, el, extLink, scrollParent } from "./dom";
import { eventDate, formatDepth, formatMagnitude, italyDateShort, italyTime } from "./format";
import { DEPTH_CLASSES, depthColor, radiusAt } from "./layer";
import { DEFAULT_MAGNITUDE, DEPTH_SCALE, MAGNITUDE_SCALE, TIME_PRESETS, type OrderBy, type TimePresetId } from "./query";
import { rangeSlider } from "./range-slider";
import { dateLocale, presetLabel, tr, trCount } from "./i18n";
import { shareButton } from "./share";
import { barWhen, percent } from "./charts";
import { barStart } from "./stats";

const ORDERS: { id: OrderBy; label: () => string }[] = [
  { id: "time", label: () => tr("order.time", "Newest first") },
  { id: "time-asc", label: () => tr("order.timeAsc", "Oldest first") },
  { id: "magnitude", label: () => tr("order.magnitude", "Magnitude, largest first") },
  { id: "magnitude-asc", label: () => tr("order.magnitudeAsc", "Magnitude, smallest first") },
];

const sectionTitle = (text: string) => el("div", { class: "ingq-label" }, text);
const REPO_URL = "https://github.com/ondata/ingv-geolibre";
const GITHUB_ICON =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";

/** The credits, fixed at the bottom of the panel; "i" opens the sources and how to cite them. */
function footer(ctl: Controller): { element: HTMLElement; showAbout: () => void } {
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
    el("div", { class: "ingq-row" }, el("strong", {}, tr("about.title", "About the data")), el("button", { type: "button", class: "ingq-close", "aria-label": tr("about.close", "Close"), onclick: () => toggle() }, "×")),
    el("p", {}, tr("about.source", "Earthquake locations and magnitudes come from the Istituto Nazionale di Geofisica e Vulcanologia (INGV), through its FDSN event web service.")),
    // Measured over the 30 days before 2026-10-23 (see LOG.md, "Coverage measured").
    el(
      "p",
      {},
      tr(
        "about.coverage",
        "The catalogue is detailed for Italy and its seas, down to the smallest events (M 0.1). Elsewhere INGV lists only the stronger earthquakes: in the rest of Europe and the Mediterranean from about M 4.5, in the rest of the world from about M 5.5.",
      ),
    ),
    el(
      "div",
      { class: "ingq-about-grid" },
      ...row(tr("about.source", "Source"), extLink("https://terremoti.ingv.it", "terremoti.ingv.it")),
      ...row(tr("about.webService", "Web service"), extLink("https://webservices.ingv.it/swagger-ui/dist/?url=https://ingv.github.io/openapi/fdsnws/event/0.0.1/event.yaml", "webservices.ingv.it/fdsnws/event/1")),
      ...row("ShakeMap", extLink("https://shakemap.ingv.it", "shakemap.ingv.it")),
      ...row(tr("about.feltReports", "Felt reports"), extLink("https://www.hsit.it", "hsit.it")),
      ...row(tr("about.licence", "Licence"), extLink("https://creativecommons.org/licenses/by/4.0/", "CC BY 4.0")),
      ...row(tr("about.countries", "Countries"), extLink("https://www.naturalearthdata.com", "Natural Earth 1:110m")),
    ),
    // Citation from DataCite for the DOI of ISIDe, the INGV catalogue the event service serves.
    el("p", { class: "ingq-muted ingq-small-text" }, tr("about.citeAs", "Cite as:") + " ISIDe Working Group (2007). Italian Seismological Instrumental and Parametric Database (ISIDe). INGV. ", extLink("https://doi.org/10.13127/ISIDE", "doi:10.13127/ISIDE")),
    el("div", { class: "ingq-about-foot ingq-muted" }, tr("about.repo", "Plugin source and issues:") + " ", extLink(REPO_URL, "GitHub")),
  );
  const info = el("button", { type: "button", class: "ingq-info", title: tr("about.title", "About the data"), onclick: () => toggle() }, "i");
  function toggle(show = about.hidden === true) {
    about.hidden = !show;
    info.classList.toggle("ingq-on", show);
  }
  about.hidden = true;
  const element = el("div", { class: "ingq-footer" }, info, el("span", {}, tr("footer.data", "Data:") + " ", extLink("https://terremoti.ingv.it", "INGV"), ", CC BY 4.0"), shareButton(ctl), github, about);
  return { element, showAbout: () => toggle(true) };
}

/** The right panel: the search, or the detail of the selected event. */
export function renderPanel(ctl: Controller, container: HTMLElement): () => void {
  const { element: foot, showAbout } = footer(ctl);
  const root = el("div", { class: "ingq-panel" }, foot);
  ctl.panelElement = root;
  const search = buildSearch(ctl, showAbout);
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
      if (!detail!.isConnected) {
        foot.before(detail!);
        // On a phone GeoLibre's container scrolls, not the panel: a detail opened from far down the list starts at its top.
        const scroller = scrollParent(root);
        if (scroller) scroller.scrollTop = 0;
      }
    } else {
      detail?.remove();
      detail = null;
      detailFor = null;
      if (!search.element.isConnected) {
        foot.before(search.element);
        const scroller = scrollParent(root);
        if (scroller) scroller.scrollTop = 0;
      }
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

function buildSearch(ctl: Controller, showAbout: () => void) {
  // Time
  const chips = [...TIME_PRESETS.map((p) => ({ id: p.id as TimePresetId, label: presetLabel(p.id) })), { id: "custom" as const, label: tr("time.custom", "Custom") }].map((p) =>
    el("button", { type: "button", class: "ingq-chip", onclick: () => ctl.set({ time: p.id }, p.id !== "custom") }, p.label),
  );
  const from = el("input", { type: "datetime-local", step: "60", class: "ingq-input ingq-mono", onchange: () => from.value && ctl.set({ from: from.value }) });
  const to = el("input", { type: "datetime-local", step: "60", class: "ingq-input ingq-mono", onchange: () => to.value && ctl.set({ to: to.value }) });
  const offset = -new Date().getTimezoneOffset() / 60;
  const zone = `UTC${offset >= 0 ? "+" : "-"}${Math.abs(offset)}`;
  const custom = el(
    "div",
    { class: "ingq-custom" },
    el("span", {}, tr("time.from", "From")),
    from,
    el("span", {}, tr("time.to", "To")),
    to,
    el("span", {}),
    el("span", { class: "ingq-faint ingq-note" }, tr("time.zone", "Local time ({{zone}}). INGV is queried in UTC.", { zone })),
  );
  const time = el("div", { class: "ingq-group" }, sectionTitle(tr("time.title", "Time")), el("div", { class: "ingq-chips" }, ...chips), custom);

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
  // A tick at every magnitude, longer on the even ones the size legend labels.
  const firstHandle = magSlider.element.querySelector(".ingq-range-handle");
  for (let m = MAGNITUDE_SCALE.min; m <= MAGNITUDE_SCALE.max; m++) {
    const tick = el("span", { class: `ingq-tick${m % 2 ? "" : " ingq-tick-major"}`, style: { left: `${(m / MAGNITUDE_SCALE.max) * 100}%` } });
    magSlider.element.insertBefore(tick, firstHandle);
  }
  function commitMagnitude(v: [number, number]) {
    magSlider.set(v);
    ctl.set({ magnitude: magSlider.get() });
  }
  // Size legend: each mark's circle is as large as a point of that magnitude on
  // the map, filled when the magnitude is inside the range searched.
  const sizeMarks = [0, 2, 4, 6, 8].map((m) => {
    const d = `${2 * radiusAt(m)}px`;
    const mark = el(
      "span",
      { class: "ingq-size", style: { left: `${(m / MAGNITUDE_SCALE.max) * 100}%` } },
      el("span", { class: "ingq-size-dot", style: { width: d, height: d } }),
      el("span", {}, String(m)),
    );
    return { m, mark };
  });
  const ticks = el("div", { class: "ingq-sizes", title: tr("magnitude.sizes", "Point size on the map at each magnitude; filled: inside the range searched") }, ...sizeMarks.map((s) => s.mark));
  const magnitude = el(
    "div",
    { class: "ingq-group ingq-tight ingq-mag" },
    el("div", { class: "ingq-row" }, sectionTitle(tr("magnitude.title", "Magnitude")), el("div", { class: "ingq-pair" }, magLo, el("span", { class: "ingq-muted" }, "-"), magHi)),
    magSlider.element,
    ticks,
  );

  // Area
  const combo = areaCombo((area, country) => {
    // A country moves the map to it, unless its box spans the whole world.
    if (country && !wrapsWorld(country.bbox)) ctl.app.fitBounds?.(country.bbox);
    ctl.set({ area, country, centre: null });
  }, showAbout);
  const countryBbox = el("span", { class: "ingq-mono" });
  const countryNote = el("span", {});
  // Measured on 2026-10-23: in Greece's box the catalogue has 59 events in 2026, the smallest M 2.6; in Italy's, 13,025.
  const abroadNote = el("span", {}, tr("area.abroad", "The INGV catalogue is centred on Italy: elsewhere it lists mostly the stronger earthquakes."));
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
    el("div", { class: "ingq-row" }, el("span", { class: "ingq-muted" }, tr("area.centre", "Centre")), centreText),
    el("div", { class: "ingq-row" }, el("span", { class: "ingq-muted" }, tr("area.radius", "Radius")), el("span", { class: "ingq-pair" }, radius, el("span", {}, "km"))),
    el("div", { class: "ingq-muted" }, tr("area.follow", "The centre follows the map; click the map to fix it.")),
  );
  const area = el("div", { class: "ingq-group" }, sectionTitle(tr("area.title", "Area")), combo.element, countryInfo, around);

  // Search, result, legend
  const count = el("span", { class: "ingq-count" });
  const strongest = el("span", { class: "ingq-muted" });
  const zoomLink = el("a", { href: "#", class: "ingq-link", onclick: (e: Event) => (e.preventDefault(), ctl.zoomToResults()) }, tr("result.zoom", "Zoom to results"));
  const tableLink = el("a", { href: "#", class: "ingq-link ingq-table-link", onclick: (e: Event) => (e.preventDefault(), ctl.openResults("table")) }, tr("result.table", "Show table"));
  const message = el("div", { class: "ingq-message" });
  // Preview of the time chart: a hover lights up its events, a click opens the charts.
  const previewBars = el("div", { class: "ingq-pbars" });
  const previewFrom = el("span");
  const previewTo = el("span");
  const previewText = el("span");
  const preview = el(
    "div",
    { class: "ingq-preview", title: tr("preview.hint", "Open the charts"), onclick: () => ctl.openResults("time"), onmouseleave: () => ctl.highlight(null) },
    previewBars,
    el("div", { class: "ingq-pdates" }, previewFrom, previewTo),
    el("div", { class: "ingq-row ingq-ptext" }, previewText, el("span", { class: "ingq-link" }, tr("preview.open", "Charts ↓"))),
  );
  let previewOf: unknown = null;
  function drawPreview() {
    const features = ctl.state.events?.features ?? [];
    const stats = ctl.timeStats();
    preview.hidden = ctl.state.status !== "done" || !stats;
    if (!stats) return;
    if (previewOf !== ctl.state.events) {
      previewOf = ctl.state.events;
      const max = Math.max(...stats.counts);
      previewBars.replaceChildren(
        ...stats.counts.map((n, i) => el("span", { style: { height: `${Math.max(n ? 2 : 0, (n / max) * 40)}px` }, onmouseenter: () => ctl.highlight({ time: i }) })),
      );
      previewFrom.textContent = italyDateShort(new Date(barStart(stats, 0)));
      previewTo.textContent = italyDateShort(new Date(barStart(stats, stats.counts.length) - 1));
      previewText.textContent = tr("preview.text", "{{low}} below M 3 · peak {{when}}", {
        low: percent(features.filter((f) => f.properties.mag < 3).length / features.length),
        when: barWhen(stats, stats.peak),
      });
    }
    const lit = ctl.state.lit;
    [...previewBars.children].forEach((bar, i) => {
      bar.classList.toggle("ingq-peak", !lit && i === stats.peak);
      bar.classList.toggle("ingq-lit", !!lit && "time" in lit && lit.time === i);
      bar.classList.toggle("ingq-dim", !!lit && !("time" in lit && lit.time === i));
    });
    preview.classList.toggle("ingq-on", ctl.state.tableOpen && ctl.state.resultsTab !== "table");
  }
  const legend = el(
    "div",
    { class: "ingq-legend" },
    el("span", {}, tr("depth.title", "Depth")),
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
  const searchButton = el("button", { type: "button", class: "ingq-primary ingq-search-btn", onclick: () => void ctl.run() }, tr("search", "Search"));
  const result = el(
    "div",
    { class: "ingq-group ingq-result" },
    searchButton,
    el("div", { class: "ingq-row" }, el("div", {}, count, strongest), el("div", { class: "ingq-links" }, zoomLink, tableLink)),
    message,
    preview,
  );

  // More filters
  const depthText = el("span", { class: "ingq-mono" });
  const depthSlider = rangeSlider(
    DEPTH_SCALE,
    ctl.search.depth,
    (v) => (depthText.textContent = `${v[0]} - ${v[1]} km`),
    (v) => ctl.set({ depth: v }),
  );
  const order = el("select", { class: "ingq-input", onchange: () => ctl.set({ order: order.value as OrderBy }) }, ...ORDERS.map((o) => el("option", { value: o.id }, o.label())));
  const limit = el("input", { type: "number", min: "1", class: "ingq-num ingq-num-wide" });
  limit.addEventListener("change", () => {
    const v = parseInt(limit.value, 10);
    if (v > 0) ctl.set({ limit: v });
  });
  const moreBody = el(
    "div",
    { class: "ingq-more-body" },
    el("div", { class: "ingq-group ingq-tight" }, el("div", { class: "ingq-row" }, el("span", { class: "ingq-muted" }, tr("depth.range", "Depth range")), depthText), depthSlider.element),
    el("div", { class: "ingq-row" }, el("span", { class: "ingq-muted" }, tr("order.title", "Order")), order),
    el("div", { class: "ingq-row" }, el("span", { class: "ingq-muted" }, tr("limit.title", "Limit")), limit),
  );
  const moreChev = el("span", { class: "ingq-chev" });
  let moreOpen = false;
  const moreToggle = el("button", { type: "button", class: "ingq-disclosure", onclick: () => ((moreOpen = !moreOpen), refresh()) }, moreChev, tr("more.title", "More filters"));
  const more = el("div", { class: "ingq-more" }, moreToggle, moreBody);

  const live = el("input", { type: "checkbox", class: "ingq-check", onchange: () => ctl.setLiveZoom(live.checked) });
  const liveRow = el(
    "label",
    { class: "ingq-live", title: tr("live.hint", "Fit the map to the results every time a filter changes") },
    live,
    el("span", {}, tr("live.title", "Live zoom")),
    el("span", { class: "ingq-faint" }, tr("live.note", "fit map to results on every filter change")),
  );

  // Small screens (GeoLibre docks the panel under the map below 768 px): the
  // period stays on top, then two tabs, the results as a list and the filters.
  let tab: "results" | "filters" = "results";
  const tabButton = (id: typeof tab, label: string) =>
    el("button", { type: "button", class: "ingq-tab", onclick: () => switchTab(id) }, label);
  // A tab opens at its top, not at the scroll of the other one.
  const switchTab = (id: typeof tab) => {
    tab = id;
    refresh();
    const scroller = scrollParent(element);
    if (scroller) scroller.scrollTop = 0;
  };
  const resultsTab = tabButton("results", tr("tab.results", "Results"));
  const filtersTab = tabButton("filters", tr("tab.filters", "Filters"));
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
  for (const [node, where] of [[time, "both"], [tabs, "both"], [result, "results"], [list, "results"], [legend, "filters"], [liveRow, "filters"], [magnitude, "filters"], [area, "filters"], [more, "filters"]] as const)
    node.dataset.tab = where;

  const element = el("div", { class: "ingq-search" }, liveRow, time, tabs, magnitude, area, result, legend, list, more);

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
      b.title = s.depthOn[i] ? tr("depth.hide", "Hide") : tr("depth.show", "Show");
    });
    magSlider.set(s.magnitude);
    magLo.value = String(s.magnitude[0]);
    magHi.value = String(s.magnitude[1]);
    for (const { m, mark } of sizeMarks) mark.classList.toggle("ingq-on", m >= s.magnitude[0] && m <= s.magnitude[1]);
    combo.show(s.area, s.country);
    const c = s.area === "country" ? s.country : null;
    countryInfo.hidden = !c;
    if (c) {
      countryBbox.textContent = `${c.bbox[0]}, ${c.bbox[1]} → ${c.bbox[2]}, ${c.bbox[3]}`;
      countryNote.textContent = wrapsWorld(c.bbox)
        ? tr("area.wraps", "Crosses the 180° meridian: the search uses the country's latitude band.")
        : tr("area.bbox", "Bounding box from Natural Earth 1:110m. The map fits to it.");
      abroadNote.hidden = c.code === "IT";
    }
    around.hidden = s.area !== "around";
    const centre = s.centre ?? ctl.usedCentre;
    const where = centre ? `${centre.lat.toFixed(2)} N, ${centre.lon.toFixed(2)} E` : tr("area.mapCentre", "map centre");
    centreText.textContent = s.centre ? tr("area.fixed", "{{where}} (fixed)", { where }) : where;
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
      count.textContent = n
        ? trCount("result.count", "{{n}} earthquake", "{{n}} earthquakes", n, { n: n.toLocaleString(dateLocale()) })
        : tr("result.none", "No earthquakes");
      const top = n ? Math.max(...features.map((f) => f.properties.mag)) : null;
      const hiddenNote = ctl.hiddenNote();
      strongest.textContent =
        (top !== null ? tr("result.strongest", ", strongest M\u00a0{{mag}}", { mag: formatMagnitude(top) }) : "") + (hiddenNote ? (n ? `; ${hiddenNote}` : ` (${hiddenNote})`) : "");
      message.textContent = n >= s.limit ? tr("result.limit", "The limit of {{limit}} was reached: narrow the search or raise the limit.", { limit: s.limit }) : "";
    } else {
      count.textContent = "";
      strongest.textContent = "";
      message.textContent = st.message;
    }
    message.hidden = !message.textContent;
    live.checked = st.liveZoom;
    zoomLink.hidden = st.liveZoom || st.status !== "done" || !features.length;
    tableLink.hidden = (st.tableOpen && st.resultsTab === "table") || !features.length;
    drawPreview();

    element.dataset.show = tab;
    resultsTab.classList.toggle("ingq-on", tab === "results");
    filtersTab.classList.toggle("ingq-on", tab === "filters");
    const changed = [
      s.magnitude[0] !== DEFAULT_MAGNITUDE[0] || s.magnitude[1] !== DEFAULT_MAGNITUDE[1],
      s.area !== "view",
      s.depth[0] !== DEPTH_SCALE.min || s.depth[1] !== DEPTH_SCALE.max,
      s.depthOn.some((on) => !on),
    ].filter(Boolean).length;
    filtersTab.textContent = changed ? tr("tab.filtersCount", "Filters · {{n}}", { n: changed }) : tr("tab.filters", "Filters");
    drawList();
  }

  return {
    element,
    refresh,
    dispose: () => map?.off("click", onMapClick),
  };
}
