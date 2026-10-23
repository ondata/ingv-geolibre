import type { Controller } from "./controller";
import { dot, el, extLink, probeImage } from "./dom";
import { eventPageUrl, type EventFeature } from "./events";
import { eventDate, formatDepth, formatMagnitude, italyDateIso, italyDateLong, italyTime, utcDateIso, utcTime } from "./format";
import { depthColor } from "./layer";
import {
  feltMapUrl,
  feltQuestionnaireUrl,
  formatDelay,
  parseHistory,
  quakeMlUrl,
  SEISMICITY_MAPS,
  seismicityMapUrl,
  SHAKEMAP_IMAGES,
  SHAKEMAP_LAYERS,
  shakeMapBase,
} from "./products";

/**
 * A section that opens on click. `load` runs the first time it opens, so a
 * section costs its request only when someone wants it.
 */
function section(title: string, load: (body: HTMLElement) => void | Promise<void>, open = false) {
  const chev = el("span", { class: "ingq-chev" });
  const body = el("div", { class: "ingq-sec-body" });
  let loaded = false;
  const toggle = () => {
    body.hidden = !body.hidden;
    chev.textContent = body.hidden ? "▸" : "▾";
    if (!body.hidden && !loaded) {
      loaded = true;
      void load(body);
    }
  };
  const element = el("div", { class: "ingq-sec" }, el("button", { type: "button", class: "ingq-sec-head", onclick: toggle }, chev, title), body);
  body.hidden = true;
  chev.textContent = "▸";
  if (open) toggle();
  return element;
}

const thumb = (src: string, label: string, cls: string) =>
  el("a", { href: src, target: "_blank", rel: "noopener noreferrer", class: "ingq-thumb" }, el("img", { src, alt: label, loading: "lazy", class: cls }), el("span", {}, label));

const loading = (body: HTMLElement, text = "Loading…") => body.replaceChildren(el("div", { class: "ingq-muted" }, text));

/** Read a GeoJSON product: the browser when the server allows it, else GeoLibre Desktop's own downloader. */
async function readJson(ctl: Controller, url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url);
    if (response.ok) return await response.json();
  } catch {
    // No CORS: try the host.
  }
  const file = await ctl.app.fetchVectorUrl?.(url).catch(() => null);
  return file ? JSON.parse(await file.text()) : null;
}

export function renderDetail(ctl: Controller, feature: EventFeature): HTMLElement {
  const p = feature.properties;
  const id = p.eventId;
  const date = eventDate(p.time);
  const [lon, lat] = feature.geometry.coordinates;

  const back = el("a", { href: "#", class: "ingq-link", onclick: (e: Event) => (e.preventDefault(), ctl.backToSearch()) }, "← Back to search");
  const header = el(
    "div",
    { class: "ingq-det-head" },
    back,
    el(
      "div",
      { class: "ingq-det-title" },
      el("div", { class: "ingq-badge" }, el("div", { class: "ingq-badge-mag" }, formatMagnitude(p.mag)), el("div", { class: "ingq-badge-type" }, p.magType)),
      el(
        "div",
        { class: "ingq-det-text" },
        el("div", { class: "ingq-det-place" }, p.place),
        el("div", { class: "ingq-muted" }, `${italyDateLong(date)} · ${italyTime(date)} Italy`),
        el("div", { class: "ingq-muted ingq-inline" }, dot(depthColor(p.depth)), `${formatDepth(p.depth)} km deep`),
      ),
    ),
  );

  const kv = (k: string, v: string, mono = false) => [el("span", { class: "ingq-muted" }, k), el("span", { class: mono ? "ingq-mono" : "" }, v)];
  const summary = section(
    "Summary",
    (body) =>
      body.replaceChildren(
        el(
          "div",
          { class: "ingq-kv" },
          ...kv("Magnitude", `${formatMagnitude(p.mag)} ${p.magType}`),
          ...kv("Time UTC", `${utcDateIso(date)} ${utcTime(date)}`, true),
          ...kv("Time Italy", `${italyDateIso(date)} ${italyTime(date)}`, true),
          ...kv("Depth", `${formatDepth(p.depth)} km`),
          ...kv("Position", `${lat.toFixed(2)} N, ${lon.toFixed(2)} E`, true),
          ...kv("Located by", p.author),
          ...kv("Event ID", String(id), true),
          extLink(eventPageUrl(id), "Open on terremoti.ingv.it ↗", "ingq-kv-wide"),
        ),
      ),
    true,
  );

  // Shown only when the event has a ShakeMap.
  const shake = section("Shaking (ShakeMap)", (body) => {
    const base = shakeMapBase(id);
    const buttons = SHAKEMAP_LAYERS.map((layer) => {
      const note = el("span", { class: "ingq-muted" });
      const button = el("button", { type: "button", class: "ingq-secondary" }, el("span", {}, layer.label), note);
      button.addEventListener("click", async () => {
        button.disabled = true;
        note.textContent = "Loading…";
        const json = await readJson(ctl, `${base}/${layer.file}`);
        if (json && ctl.app.addGeoJsonLayer) {
          ctl.app.addGeoJsonLayer(`${layer.name} ${id}`, json as { type: "FeatureCollection"; features: unknown[] });
          note.textContent = "Added";
        } else {
          note.textContent = "Desktop only";
          button.disabled = false;
        }
      });
      return button;
    });
    body.replaceChildren(
      el("div", { class: "ingq-thumbs ingq-thumbs-3" }, ...SHAKEMAP_IMAGES.map((i) => thumb(`${base}/${i.file}`, i.label, "ingq-img-tall"))),
      el("div", { class: "ingq-stack" }, ...buttons),
    );
  });
  shake.hidden = true;
  void probeImage(`${shakeMapBase(id)}/intensity.jpg`).then((ok) => (shake.hidden = !ok));

  const felt = section("Felt reports", async (body) => {
    loading(body);
    const src = feltMapUrl(id);
    const ok = await probeImage(src);
    body.replaceChildren(
      ok ? thumb(src, "Intensity by municipality, from the “Hai sentito il terremoto?” questionnaires.", "ingq-img-wide") : el("div", { class: "ingq-muted" }, "No felt reports map for this event yet."),
      extLink(feltQuestionnaireUrl(id), "Did you feel it? Fill in the questionnaire ↗"),
    );
  });

  const history = section("Location and magnitude history", async (body) => {
    loading(body, "Loading QuakeML…");
    try {
      const response = await fetch(quakeMlUrl(id));
      if (!response.ok) throw new Error(String(response.status));
      const rows = parseHistory(await response.text());
      if (!rows.length) {
        loading(body, "No history for this event.");
        return;
      }
      const head = ["UTC", "Status", "Mag", "Depth"].map((h, i) => el("span", { class: `ingq-th${i > 1 ? " ingq-right" : ""}` }, h));
      body.replaceChildren(
        el(
          "div",
          { class: "ingq-history" },
          ...head,
          ...rows.flatMap((r) => {
            const strong = r.preferred ? " ingq-strong" : "";
            return [
              el("span", { class: "ingq-mono" }, formatDelay(r.delay)),
              el("span", { class: strong.trim() }, `${r.automatic ? "Automatic" : "Revised"}${r.preferred ? " (preferred)" : ""}`),
              el("span", { class: `ingq-mono ingq-right${strong}` }, `${formatMagnitude(r.magnitude)} ${r.magType}`),
              el("span", { class: "ingq-mono ingq-right" }, r.depth === null ? "" : `${formatDepth(r.depth)} km`),
            ];
          }),
        ),
        el("div", { class: "ingq-muted ingq-note" }, "UTC: time from the earthquake to the publication."),
      );
    } catch {
      loading(body, "The INGV service did not send the history.");
    }
  });

  const around = section("Seismicity around", (body) =>
    body.replaceChildren(
      el("button", { type: "button", class: "ingq-accent", onclick: () => ctl.searchAround(feature) }, "Search around this event (30 km)"),
      el("div", { class: "ingq-muted" }, "INGV maps"),
      el("div", { class: "ingq-thumbs ingq-thumbs-2" }, ...SEISMICITY_MAPS.map((m) => thumb(seismicityMapUrl(id, m.map), m.label, "ingq-img-map"))),
    ),
  );

  return el("div", { class: "ingq-detail" }, header, summary, shake, felt, history, around);
}
