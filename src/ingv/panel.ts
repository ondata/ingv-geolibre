import { areaCombo } from "./area-combo";
import type { Controller } from "./controller";
import { wrapsWorld } from "./countries";
import { renderDetail } from "./detail";
import { dot, el } from "./dom";
import { formatMagnitude } from "./format";
import { DEPTH_CLASSES } from "./layer";
import { DEPTH_SCALE, MAGNITUDE_SCALE, TIME_PRESETS, type OrderBy, type TimePresetId } from "./query";
import { rangeSlider } from "./range-slider";

const ORDERS: { id: OrderBy; label: string }[] = [
  { id: "time", label: "Newest first" },
  { id: "time-asc", label: "Oldest first" },
  { id: "magnitude", label: "Magnitude, largest first" },
  { id: "magnitude-asc", label: "Magnitude, smallest first" },
];

const sectionTitle = (text: string) => el("div", { class: "ingq-label" }, text);
const credit = () => el("div", { class: "ingq-credit" }, "Data: INGV, CC BY 4.0.");

/** The right panel: the search, or the detail of the selected event. */
export function renderPanel(ctl: Controller, container: HTMLElement): () => void {
  const root = el("div", { class: "ingq-panel" });
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
      if (!detail!.isConnected) root.append(detail!);
    } else {
      detail?.remove();
      detail = null;
      detailFor = null;
      if (!search.element.isConnected) root.append(search.element);
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
    ctl.set({ area, country, centre: area === "around" ? ctl.search.centre : null });
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
    el("div", { class: "ingq-muted" }, "Click the map to move the centre."),
  );
  const area = el("div", { class: "ingq-group" }, sectionTitle("Area"), combo.element, countryInfo, around);

  // Search, result, legend
  const count = el("span", { class: "ingq-count" });
  const strongest = el("span", { class: "ingq-muted" });
  const zoomLink = el("a", { href: "#", class: "ingq-link", onclick: (e: Event) => (e.preventDefault(), ctl.zoomToResults()) }, "Zoom to results");
  const tableLink = el("a", { href: "#", class: "ingq-link", onclick: (e: Event) => (e.preventDefault(), ctl.openTable()) }, "Show table");
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

  const element = el("div", { class: "ingq-search" }, liveRow, time, magnitude, area, result, more, credit());

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
    centreText.textContent = s.centre ? `${s.centre.lat.toFixed(2)} N, ${s.centre.lon.toFixed(2)} E` : "map centre";
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
  }

  return {
    element,
    refresh,
    dispose: () => map?.off("click", onMapClick),
  };
}
