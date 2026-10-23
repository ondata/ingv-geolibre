import { el } from "./dom";

export interface Scale {
  min: number;
  max: number;
  step: number;
}

/** Snap a value to the scale's steps and limits. */
export function snap(value: number, scale: Scale): number {
  const stepped = Math.round((value - scale.min) / scale.step) * scale.step + scale.min;
  return Math.min(scale.max, Math.max(scale.min, Number(stepped.toFixed(6))));
}

/**
 * A slider with two handles, low and high. `onInput` follows the drag;
 * `onChange` fires when a handle is released, which is when a search runs.
 */
export function rangeSlider(
  scale: Scale,
  initial: [number, number],
  onInput: (value: [number, number]) => void,
  onChange: (value: [number, number]) => void,
) {
  let value: [number, number] = [...initial];
  const pct = (v: number) => `${((v - scale.min) / (scale.max - scale.min)) * 100}%`;
  const fill = el("div", { class: "ingq-range-fill" });
  const handles = [0, 1].map((i) =>
    el("div", { class: "ingq-range-handle", role: "slider", tabIndex: 0, "aria-label": i ? "Maximum" : "Minimum" }),
  );
  const track = el("div", { class: "ingq-range" }, el("div", { class: "ingq-range-track" }), fill, ...handles);

  function paint() {
    fill.style.left = pct(value[0]);
    fill.style.width = `calc(${pct(value[1])} - ${pct(value[0])})`;
    handles.forEach((h, i) => {
      h.style.left = pct(value[i]);
      h.setAttribute("aria-valuenow", String(value[i]));
    });
  }

  function set(i: number, v: number) {
    const s = snap(v, scale);
    const next: [number, number] = [...value];
    next[i] = i === 0 ? Math.min(s, value[1]) : Math.max(s, value[0]);
    if (next[i] === value[i]) return false;
    value = next;
    paint();
    onInput(value);
    return true;
  }

  const valueAt = (clientX: number) => {
    const rect = track.getBoundingClientRect();
    return scale.min + ((clientX - rect.left) / rect.width) * (scale.max - scale.min);
  };

  /** Drag handle `i` until the pointer is released, then report the change. */
  function drag(i: number, event: PointerEvent) {
    const handle = handles[i];
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => set(i, valueAt(e.clientX));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      onChange(value);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  // A press on the line moves the nearer handle there, and keeps dragging it.
  track.addEventListener("pointerdown", (event) => {
    if (handles.includes(event.target as HTMLDivElement)) return;
    const v = valueAt(event.clientX);
    const i = v > value[1] || (v >= value[0] && value[1] - v < v - value[0]) ? 1 : 0;
    set(i, v);
    drag(i, event);
  });

  handles.forEach((handle, i) => {
    handle.addEventListener("pointerdown", (event) => drag(i, event));
    handle.addEventListener("keydown", (event) => {
      const delta = event.key === "ArrowRight" || event.key === "ArrowUp" ? scale.step : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -scale.step : 0;
      if (delta && set(i, value[i] + delta)) onChange(value);
    });
  });
  paint();

  return {
    element: track,
    get: () => value,
    /** Set from outside (the number inputs); no callbacks. */
    set(next: [number, number]) {
      value = [snap(Math.min(next[0], next[1]), scale), snap(Math.max(next[0], next[1]), scale)];
      paint();
    },
  };
}
