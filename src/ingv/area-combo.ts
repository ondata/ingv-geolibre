import type { Area } from "./controller";
import { COUNTRIES, matchCountries, type Country } from "./countries";
import { el } from "./dom";

const FIXED: { area: Exclude<Area, "country">; label: string; note: string }[] = [
  { area: "view", label: "Map view", note: "default" },
  { area: "around", label: "Around a point…", note: "" },
  { area: "world", label: "World", note: "" },
];

type Option = { area: Exclude<Area, "country">; label: string; note: string } | { area: "country"; country: Country };

/**
 * The area as a button that opens a list: map view, around a point, world, or
 * a country picked from the list or found by typing its name or ISO code in
 * the search field at the top of the list.
 */
export function areaCombo(onPick: (area: Area, country: Country | null) => void) {
  const label = el("span", {}, "Map view");
  const chev = el("span", { class: "ingq-combo-chev" }, "▼");
  const button = el("button", { type: "button", class: "ingq-combo-button", "aria-haspopup": "listbox" }, label, chev);
  const input = el("input", { class: "ingq-combo-search", type: "text", placeholder: "Search a country…", autocomplete: "off", spellcheck: false, "aria-label": "Search a country" });
  const list = el("div", { class: "ingq-combo-items", role: "listbox" });
  const popup = el("div", { class: "ingq-combo-list" }, el("div", { class: "ingq-combo-field" }, input), list);
  const element = el("div", { class: "ingq-combo" }, button, popup);

  let open = false;
  let active = 0;
  let options: Option[] = [];

  const labelOf = (o: Option) => (o.area === "country" ? o.country.name : o.label);

  function drawList() {
    const query = input.value;
    const q = query.trim().toLowerCase();
    const fixed = FIXED.filter((o) => !q || o.label.toLowerCase().includes(q));
    const countries = q ? matchCountries(query) : COUNTRIES;
    options = [...fixed, ...countries.map((country) => ({ area: "country" as const, country }))];
    active = Math.min(active, Math.max(options.length - 1, 0));
    const row = (o: Option, i: number) =>
      el(
        "div",
        {
          class: `ingq-combo-item${i === active ? " ingq-on" : ""}`,
          role: "option",
          onmousedown: (e: Event) => (e.preventDefault(), pick(o)),
          onmouseenter: () => ((active = i), drawList()),
        },
        el("span", {}, labelOf(o)),
        el("span", { class: o.area === "country" ? "ingq-combo-code" : "ingq-combo-note" }, o.area === "country" ? o.country.code : o.note),
      );
    list.replaceChildren(
      ...fixed.map(row),
      el("div", { class: "ingq-combo-head" }, `Countries · ${countries.length}`),
      ...countries.map((country, i) => row({ area: "country", country }, i + fixed.length)),
    );
    if (q && !options.length) list.append(el("div", { class: "ingq-combo-none" }, `No country matches “${query.trim()}”.`));
    list.querySelector(".ingq-combo-item.ingq-on")?.scrollIntoView({ block: "nearest" });
  }

  function setOpen(next: boolean) {
    open = next;
    popup.hidden = !open;
    button.classList.toggle("ingq-on", open);
    button.setAttribute("aria-expanded", String(open));
    chev.textContent = open ? "▲" : "▼";
    if (open) {
      input.value = "";
      active = 0;
      drawList();
      input.focus();
    }
  }

  function pick(o: Option) {
    setOpen(false);
    onPick(o.area, o.area === "country" ? o.country : null);
  }

  // Keep the focus in the search field, so a click on the button does not first blur it.
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", () => setOpen(!open));
  input.addEventListener("blur", () => setOpen(false));
  input.addEventListener("input", () => ((active = 0), drawList()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") active = Math.min(active + 1, options.length - 1);
    else if (e.key === "ArrowUp") active = Math.max(active - 1, 0);
    else if (e.key === "Enter" && options[active]) return pick(options[active]);
    else if (e.key === "Escape") return input.blur();
    else return;
    e.preventDefault();
    drawList();
  });
  setOpen(false);

  return {
    element,
    /** Show the current area on the button. */
    show(area: Area, country: Country | null) {
      label.textContent = area === "country" && country ? country.name : (FIXED.find((o) => o.area === area)?.label ?? "Map view");
    },
  };
}
