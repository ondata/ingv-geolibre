import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { BrushComponent, GridComponent, ToolboxComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { Controller, ResultsTab } from "./controller";
import { el } from "./dom";
import type { EventFeature } from "./events";
import { eventDate, italyDateShort, italyTime } from "./format";
import { dateLocale, locale, tr, trCount } from "./i18n";
import { depthColor, radiusAt } from "./layer";
import { barAt, barStart, binOf, energyOf, magClasses, magClassOf, type MagClass, type TimeStats } from "./stats";
import { renderTable } from "./table";

// The brush cursor is taken through the toolbox, kept hidden.
echarts.use([BarChart, LineChart, ScatterChart, GridComponent, TooltipComponent, BrushComponent, ToolboxComponent, CanvasRenderer]);

const ACCENT = "#2563eb";
const DAY = 24 * 3600e3;
const AXIS = {
  axisLine: { lineStyle: { color: "#d1d5db" } },
  axisTick: { show: false },
  axisLabel: { color: "#6b7280", fontSize: 10, fontFamily: "IBM Plex Mono, monospace" },
  splitLine: { lineStyle: { color: "#f3f4f6" } },
};

/** A magnitude or a decimal in the interface language: "5,5" in Italian. */
const decimal = (n: number) => n.toLocaleString(dateLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A share as a short percentage: "0,4%", "12%". */
export function percent(f: number): string {
  if (f === 0) return "0%";
  if (f < 0.001) return `<${decimal(0.1)}%`;
  return `${f < 0.1 ? decimal(f * 100) : Math.round(f * 100)}%`;
}

/** A share inside a sentence, with its article in Italian: "l'82%", "il 4%", "meno dell'1%". */
export function sharePhrase(f: number): string {
  const it = locale().startsWith("it");
  if (f > 0 && f < 0.01) return it ? "meno dell’1%" : "less than 1%";
  if (f > 0.99 && f < 1) return it ? "oltre il 99%" : "over 99%";
  const n = Math.round(f * 100);
  if (!it) return `${n}%`;
  return `${n === 1 || n === 8 || n === 11 || (n >= 80 && n <= 89) ? "l’" : "il "}${n}%`;
}

/** Italy hour of a time: "14". */
const hour = (t: number) => italyTime(new Date(t)).slice(0, 2);

/** When a bar is, in words: "on 23 Oct, 14-17", "on 23 Oct", "in the week from 19 Oct". */
export function barWhen(stats: TimeStats, i: number): string {
  const t = barStart(stats, i);
  const day = italyDateShort(new Date(t));
  // A bar that ends at midnight ends at 24, not 00.
  if (stats.bin < DAY) return tr("chart.whenHours", "on {{day}}, {{from}}‑{{to}}", { day, from: hour(t), to: hour(t + stats.bin).replace(/^00$/, "24") });
  if (stats.bin === DAY) return tr("chart.whenDay", "on {{day}}", { day });
  return tr("chart.whenWeek", "in the week from {{day}}", { day });
}

/** "Peak of 26 events on 23 Oct, 14-17, about 6 times the average of the period." */
export function peakText(stats: TimeStats, total: number): string {
  const n = stats.counts[stats.peak];
  const ratio = Math.round(n / (total / stats.counts.length));
  const params = { n, when: barWhen(stats, stats.peak), ratio };
  return ratio >= 2
    ? tr("chart.peak", "Peak of {{n}} events {{when}}, about {{ratio}} times the average of the period.", params)
    : tr("chart.peakFlat", "At most {{n}} events {{when}}: no clear peak.", params);
}

/** The text of the Energy tab: the weak events' share of the energy, then the strongest one's. */
export function energyText(features: EventFeature[]): string {
  const total = features.reduce((s, f) => s + energyOf(f.properties.mag), 0);
  const low = features.filter((f) => f.properties.mag < 3);
  const top = features.reduce((a, f) => (f.properties.mag > a.properties.mag ? f : a), features[0]);
  const strongest = tr("chart.energyTop", "The strongest event, M {{mag}}, alone releases {{energy}} of the energy.", {
    mag: decimal(top.properties.mag),
    energy: sharePhrase(energyOf(top.properties.mag) / total),
  });
  if (!low.length) return strongest;
  const weak = trCount(
    "chart.energyLow",
    "The one event below M 3 is {{share}} of the total but releases {{energy}} of the energy.",
    "The {{n}} events below M 3 are {{share}} of the total but release {{energy}} of the energy.",
    low.length,
    { n: low.length, share: sharePhrase(low.length / features.length), energy: sharePhrase(low.reduce((s, f) => s + energyOf(f.properties.mag), 0) / total) },
  );
  return `${weak} ${strongest}`;
}

/** Point size on the Sequence chart: the map's, a little smaller. */
const seqSize = (mag: number) => 2 * radiusAt(mag) * 0.55;

/**
 * The results floating panel (design "INGV Desktop Grafici", 2026-10-26):
 * the table and three charts in tabs. Hovering a chart lights up its events on
 * the map; dragging across the time chart searches that period.
 */
export function renderResults(ctl: Controller, container: HTMLElement): () => void {
  const TABS: [ResultsTab, string][] = [
    ["table", tr("tab.table", "Table")],
    ["time", tr("tab.time", "Time")],
    ["mag", tr("tab.mag", "Magnitude")],
    ["energy", tr("tab.energy", "Energy")],
  ];
  const tabButtons = TABS.map(([id, label]) => el("button", { type: "button", class: "ingq-rtab", onclick: () => ctl.update({ resultsTab: id }) }, label));
  const info = el("span", { class: "ingq-rinfo" });
  const tabBar = el("div", { class: "ingq-rtabs" }, ...tabButtons, info);

  const tablePane = el("div", { class: "ingq-rpane ingq-rpane-table" });
  const disposeTable = renderTable(ctl, tablePane);

  // Time
  let mode: "count" | "seq" = "count";
  const peak = el("div", { class: "ingq-ctext" });
  const modeButtons = (["count", "seq"] as const).map((m) =>
    el("button", { type: "button", onclick: () => ((mode = m), ctl.highlight(null), draw(true)) }, m === "count" ? tr("chart.count", "Count") : tr("chart.seq", "Sequence")),
  );
  const timeBox = el("div", { class: "ingq-chart" });
  const timePane = pane(
    tr("chart.timeTitle", "Over time"),
    [peak, el("div", { class: "ingq-seg" }, ...modeButtons)],
    tr("chart.timeHint", "Hover to see the events on the map. Drag to pick a period."),
    timeBox,
  );

  // Magnitude
  let logY = false;
  const magText = el("div", { class: "ingq-ctext" });
  const log = el("input", { type: "checkbox", class: "ingq-check", onchange: () => ((logY = log.checked), draw(true)) });
  const magBox = el("div", { class: "ingq-chart" });
  const magPane = pane(
    tr("chart.magTitle", "By magnitude"),
    [magText, el("label", { class: "ingq-live" }, log, el("span", {}, tr("chart.log", "Log scale")))],
    tr("chart.magHint", "Classes of 0.5: the 2.5 bar counts the events from 2.5 to 2.9."),
    magBox,
  );

  // Energy
  const enText = el("div", { class: "ingq-ctext" });
  const enRows = el("div", { class: "ingq-erows", onmouseleave: () => ctl.highlight(null) });
  const enPane = pane(
    tr("chart.energyTitle", "Events and energy"),
    [enText],
    tr("chart.energyHint", "Each step of magnitude is about 32 times the energy (log₁₀E = 1.5·M + 4.8)."),
    enRows,
  );

  const panes: Record<ResultsTab, HTMLElement> = { table: tablePane, time: timePane, mag: magPane, energy: enPane };
  const root = el("div", { class: "ingq-table ingq-results" }, tabBar, ...Object.values(panes));
  container.append(root);

  const timeChart = echarts.init(timeBox);
  const magChart = echarts.init(magBox);

  // Count: the bar under the pointer, anywhere in its column. Sequence: the point.
  // A redraw while dragging would drop the selection: no highlight until the button is up.
  let dragging = false;
  timeChart.getZr().on("mousedown", () => (dragging = true));
  timeChart.getZr().on("mouseup", () => (dragging = false));
  timeChart.getZr().on("mousemove", (e: { offsetX: number; offsetY: number }) => {
    const stats = ctl.timeStats();
    if (dragging || mode !== "count" || !stats) return;
    if (!timeChart.containPixel("grid", [e.offsetX, e.offsetY])) return ctl.highlight(null);
    const i = barAt(stats, axisValue(timeChart, e));
    ctl.highlight(i >= 0 && i < stats.counts.length ? { time: i } : null);
  });
  const pointOf = (p: { seriesType?: string; data?: unknown }) => (p.seriesType === "scatter" ? (p.data as { f: EventFeature }).f : null);
  timeChart.on("mouseover", (p) => {
    const f = pointOf(p);
    if (f) ctl.hover(f);
  });
  timeChart.on("mouseout", (p) => {
    if (pointOf(p)) ctl.hover(null);
  });
  timeChart.on("click", (p) => {
    const f = pointOf(p);
    if (f) ctl.select(f);
  });
  timeChart.on("brushEnd", (p) => {
    dragging = false;
    const range = (p as { areas?: { coordRange: [number, number] }[] }).areas?.[0]?.coordRange;
    if (range && range[1] > range[0]) ctl.pickPeriod(range[0], range[1]);
  });
  magChart.getZr().on("mousemove", (e: { offsetX: number; offsetY: number }) => {
    if (!magChart.containPixel("grid", [e.offsetX, e.offsetY])) return ctl.highlight(null);
    const c = magClasses(ctl.state.events?.features ?? [])[Math.round(axisValue(magChart, e))];
    ctl.highlight(c ? { mag: c.from } : null);
  });
  for (const chart of [timeChart, magChart]) chart.getZr().on("globalout", () => !dragging && ctl.highlight(null));

  const resize = new ResizeObserver(() => {
    timeChart.resize();
    magChart.resize();
  });
  resize.observe(root);

  const phone = window.matchMedia("(max-width: 767px)");
  const onWidth = () => draw(true);
  phone.addEventListener("change", onWidth);

  let drawn = "";
  /** Redraw the shown tab when the events, the highlight or an option change. */
  function draw(force = false) {
    const st = ctl.state;
    const features = st.events?.features ?? [];
    const stats = ctl.timeStats();
    // Charts are for wide screens (decided 2026-10-26): on a phone the panel keeps the table.
    const tab: ResultsTab = phone.matches ? "table" : st.resultsTab;
    TABS.forEach(([id], i) => tabButtons[i].classList.toggle("ingq-on", id === tab));
    for (const [id, p] of Object.entries(panes)) p.hidden = id !== tab;
    modeButtons.forEach((b, i) => b.classList.toggle("ingq-on", (i ? "seq" : "count") === mode));

    const lit = st.lit ? litCount(features, stats, st.lit) : null;
    info.classList.toggle("ingq-on", lit !== null);
    info.textContent =
      lit !== null
        ? trCount("chart.lit", "{{n}} event lit up on the map", "{{n}} events lit up on the map", lit, { n: lit })
        : stats && features.length
          ? `${trCount("chart.events", "{{n}} event", "{{n}} events", features.length, { n: features.length.toLocaleString(dateLocale()) })} · ${italyDateShort(new Date(barStart(stats, 0)))} - ${italyDateShort(new Date(barStart(stats, stats.counts.length) - 1))}`
          : "";

    // The events of a search: a new search gives a new collection, sorting the table does not.
    const key0 = JSON.stringify([features.length, features[0]?.properties.eventId, features[features.length - 1]?.properties.eventId, locale()]);
    const key = JSON.stringify([tab, mode, logY, st.lit, key0]);
    if (!force && key === drawn) return;
    const first = !drawn;
    drawn = key;
    const empty = !features.length || !stats;
    if (tab === "time") {
      peak.textContent = empty ? tr("table.empty", "No earthquakes for these filters.") : peakText(stats, features.length);
      if (!empty) drawTime(timeChart, features, stats, mode, st.lit, first);
      else timeChart.clear();
      timeChart.resize();
    }
    if (tab === "mag") {
      const classes = magClasses(features);
      const high = features.filter((f) => f.properties.mag >= 4).length;
      magText.textContent = empty
        ? tr("table.empty", "No earthquakes for these filters.")
        : trCount("chart.magText", "{{low}} of the earthquakes are below M 3; {{high}} reaches M 4 or more.", "{{low}} of the earthquakes are below M 3; {{high}} reach M 4 or more.", high, {
            low: percent(features.filter((f) => f.properties.mag < 3).length / features.length),
            high,
          });
      if (!empty) drawMag(magChart, features, classes, stats, logY, st.lit, first);
      else magChart.clear();
      magChart.resize();
    }
    if (tab === "energy") {
      enText.textContent = empty ? tr("table.empty", "No earthquakes for these filters.") : energyText(features);
      if (enRows.dataset.key !== key0) {
        enRows.dataset.key = key0;
        drawEnergy(enRows, ctl, features, empty ? [] : magClasses(features));
      }
      const lit = st.lit && "mag" in st.lit ? String(st.lit.mag) : "";
      for (const row of enRows.querySelectorAll<HTMLElement>("[data-mag]")) row.classList.toggle("ingq-on", row.dataset.mag === lit);
    }
  }

  draw();
  const unsubscribe = ctl.subscribe(() => draw());
  return () => {
    unsubscribe();
    phone.removeEventListener("change", onWidth);
    resize.disconnect();
    timeChart.dispose();
    magChart.dispose();
    disposeTable();
    root.remove();
  };
}

/** The x value under the pointer: a time, or the index of a category. */
function axisValue(chart: echarts.ECharts, e: { offsetX: number; offsetY: number }): number {
  return (chart.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]) as unknown as number[])[0];
}

/** A chart tab: title, text and controls at the left, the chart at the right. */
function pane(title: string, body: HTMLElement[], hint: string, chart: HTMLElement): HTMLElement {
  return el(
    "div",
    { class: "ingq-rpane ingq-cpane" },
    el("div", { class: "ingq-cside" }, el("div", { class: "ingq-label" }, title), ...body, el("div", { class: "ingq-chint" }, hint)),
    chart,
  );
}

function litCount(features: EventFeature[], stats: TimeStats | null, lit: NonNullable<Controller["state"]["lit"]>): number {
  if ("mag" in lit) return features.filter((f) => magClassOf(f.properties.mag) === lit.mag).length;
  return stats ? stats.counts[lit.time] ?? 0 : 0;
}

const timeAxis = (stats: TimeStats) => ({
  type: "time" as const,
  min: barStart(stats, 0),
  max: barStart(stats, stats.counts.length),
  ...AXIS,
  splitNumber: 7,
  splitLine: { show: false },
  // The day at midnight in Italy, the hour on the ticks in between.
  axisLabel: { ...AXIS.axisLabel, hideOverlap: true, formatter: (v: number) => (italyTime(new Date(v)).startsWith("00:00") ? italyDateShort(new Date(v)) : italyTime(new Date(v)).slice(0, 5)) },
});

function drawTime(chart: echarts.ECharts, features: EventFeature[], stats: TimeStats, mode: "count" | "seq", lit: Controller["state"]["lit"], first: boolean) {
  const common = {
    animation: first,
    grid: { left: 34, right: mode === "count" ? 40 : 10, top: 12, bottom: 24 },
    toolbox: { show: false },
    brush: { toolbox: [], xAxisIndex: 0, brushType: "lineX", brushMode: "single", throttleType: "debounce", throttleDelay: 0, brushStyle: { color: "rgba(37,99,235,.10)", borderColor: ACCENT, borderWidth: 1 } },
    xAxis: timeAxis(stats),
  };
  const inLit = (f: EventFeature) => (lit ? ("mag" in lit ? magClassOf(f.properties.mag) === lit.mag : binOf(stats, f.properties.time) === lit.time) : false);
  const centre = (i: number) => barStart(stats, i) + stats.bin / 2;
  if (mode === "count") {
    const colour = (i: number) => (lit ? ("time" in lit && lit.time === i ? ACCENT : "#e5e7eb") : i === stats.peak ? "#374151" : "#9ca3af");
    const sorted = features.map((f) => eventDate(f.properties.time).getTime()).sort((a, b) => a - b);
    const barWidth = Math.max(2, (chart.getWidth() - 80) / stats.counts.length - 1);
    // A class of magnitude lit up: its events per bar, in blue over the grey bars.
    const litBars = lit && "mag" in lit ? stats.counts.map(() => 0) : null;
    if (litBars) for (const f of features) if (inLit(f)) litBars[binOf(stats, f.properties.time)]++;
    chart.setOption(
      {
        ...common,
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "none" },
          textStyle: { fontSize: 12 },
          // On a time axis the bars are not matched by position: the bar comes from the axis value.
          formatter: (p: { axisValue: number }[]) => {
            const i = barAt(stats, p[0].axisValue);
            const n = stats.counts[i];
            return n === undefined ? "" : `${barWhen(stats, i)}<br><b>${trCount("chart.events", "{{n}} event", "{{n}} events", n, { n })}</b>`;
          },
        },
        yAxis: [
          { type: "value", ...AXIS, splitNumber: 3, minInterval: 1 },
          { type: "value", ...AXIS, splitLine: { show: false }, splitNumber: 3, minInterval: 1, axisLabel: { ...AXIS.axisLabel, color: ACCENT } },
        ],
        series: [
          { type: "bar", barWidth, data: stats.counts.map((n, i) => ({ value: [centre(i), n], itemStyle: { color: colour(i) } })) },
          { type: "bar", barWidth, barGap: "-100%", silent: true, itemStyle: { color: ACCENT }, data: litBars ? litBars.map((n, i) => (n ? [centre(i), n] : null)).filter(Boolean) : [] },
          {
            type: "line",
            yAxisIndex: 1,
            step: "end",
            showSymbol: false,
            silent: true,
            data: sorted.map((t, i) => [t, i + 1]),
            lineStyle: { color: ACCENT, width: 1.5, opacity: lit ? 0.3 : 1 },
            z: 3,
          },
        ],
      },
      true,
    );
  } else {
    chart.setOption(
      {
        ...common,
        tooltip: {
          trigger: "item",
          textStyle: { fontSize: 12 },
          formatter: (p: { data: { f: EventFeature } }) => {
            const { f } = p.data;
            const d = eventDate(f.properties.time);
            return `${italyDateShort(d)} ${italyTime(d).slice(0, 5)}<br>${f.properties.magType} <b>${decimal(f.properties.mag)}</b> · ${f.properties.depth} km<br>${f.properties.place}`;
          },
        },
        yAxis: { type: "value", min: (v: { min: number }) => Math.floor(v.min), max: (v: { max: number }) => Math.ceil(v.max), interval: 1, ...AXIS },
        series: [
          {
            type: "scatter",
            data: features.map((f) => {
              const on = inLit(f);
              return {
                value: [eventDate(f.properties.time).getTime(), f.properties.mag],
                f,
                symbolSize: seqSize(f.properties.mag),
                z: on ? 5 : 2,
                itemStyle: { color: depthColor(f.properties.depth), opacity: lit ? (on ? 1 : 0.12) : 0.8, borderColor: on ? "#1f2937" : "#fff", borderWidth: on ? 1.2 : 0.5 },
              };
            }),
          },
        ],
      },
      true,
    );
  }
  // Dragging picks a period without pressing a toolbox button first.
  chart.dispatchAction({ type: "takeGlobalCursor", key: "brush", brushOption: { brushType: "lineX", brushMode: "single" } });
}

function drawMag(chart: echarts.ECharts, features: EventFeature[], classes: MagClass[], stats: TimeStats | null, logY: boolean, lit: Controller["state"]["lit"], first: boolean) {
  const total = features.length;
  // A bar of time lit up: its events per class, in blue over the grey bars.
  const litBars = lit && "time" in lit && stats ? classes.map((c) => features.filter((f) => magClassOf(f.properties.mag) === c.from && binOf(stats, f.properties.time) === lit.time).length) : null;
  const grey = (from: number) => (from < 3 ? "#9ca3af" : from < 4 ? "#6b7280" : "#374151");
  chart.setOption(
    {
      animation: first,
      grid: { left: 34, right: 10, top: 16, bottom: 22 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(0,0,0,.03)" } },
        textStyle: { fontSize: 12 },
        formatter: (p: { dataIndex: number }[]) => {
          const c = classes[p[0].dataIndex];
          return `M ${c.from.toFixed(1)}-${(c.from + 0.4).toFixed(1)}<br><b>${trCount("chart.events", "{{n}} event", "{{n}} events", c.count, { n: c.count })}</b> (${percent(c.count / total)})`;
        },
      },
      xAxis: { type: "category", data: classes.map((c) => c.from.toFixed(1)), ...AXIS, axisLabel: { ...AXIS.axisLabel, interval: 0 } },
      yAxis: { type: logY ? "log" : "value", min: logY ? 0.5 : 0, ...AXIS, splitNumber: 3, minInterval: 1, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => (v < 1 ? "" : String(v)) } },
      series: [
        {
          type: "bar",
          barCategoryGap: "20%",
          data: classes.map((c) => ({
            value: logY && !c.count ? null : c.count,
            itemStyle: { color: lit ? ("mag" in lit && lit.mag === c.from ? ACCENT : "#e5e7eb") : grey(c.from) },
          })),
          label: { show: !litBars, position: "top", fontSize: 10, color: "#6b7280", fontFamily: "IBM Plex Mono, monospace", formatter: (p: { value: number | null }) => (p.value ? String(p.value) : "") },
        },
        {
          type: "bar",
          barGap: "-100%",
          barCategoryGap: "20%",
          silent: true,
          itemStyle: { color: ACCENT },
          data: litBars ? litBars.map((n) => n || null) : [],
          label: { show: true, position: "top", fontSize: 10, color: ACCENT, fontWeight: 600, fontFamily: "IBM Plex Mono, monospace" },
        },
      ],
    },
    true,
  );
}

/** Energy: one row per class, its share of the events and its share of the energy; built once per search. */
function drawEnergy(rows: HTMLElement, ctl: Controller, features: EventFeature[], classes: MagClass[]) {
  const bar = (f: number, cls: string, text: string) =>
    el("span", { class: "ingq-ebar" }, el("span", { class: cls, style: { width: `${f * 80}%` } }), el("span", { class: "ingq-mono" }, text));
  rows.replaceChildren(
    el(
      "div",
      { class: "ingq-erow ingq-ehead" },
      el("span", {}),
      el("span", {}, el("i", { class: "ingq-key ingq-key-n" }), tr("chart.shareEvents", "Share of events")),
      el("span", {}, el("i", { class: "ingq-key ingq-key-e" }), tr("chart.shareEnergy", "Share of energy")),
    ),
    ...classes.map((c) =>
      el(
        "div",
        { class: "ingq-erow", "data-mag": String(c.from), onmouseenter: () => ctl.highlight({ mag: c.from }) },
        el("span", { class: "ingq-mono" }, `M ${c.from.toFixed(1)}-${(c.from + 0.4).toFixed(1)}`),
        bar(c.count / features.length, "ingq-fill-n", percent(c.count / features.length)),
        bar(c.energy, "ingq-fill-e", percent(c.energy)),
      ),
    ),
  );
}
