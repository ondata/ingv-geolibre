import type { EventFeature } from "./events";
import { eventDate } from "./format";

const HOUR = 3600e3;
/** Widths of the time bars, the first that gives at most 60 bars over the events' span. */
export const TIME_BINS = [1, 3, 6, 12, 24, 168].map((h) => h * HOUR);

const ITALY_PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });

/** Offset of Italy time from UTC at a date, in ms: bars start at an hour or a midnight of Italy. */
export function italyOffset(date: Date): number {
  const parts = Object.fromEntries(ITALY_PARTS.formatToParts(date).map((p) => [p.type, Number(p.value)]));
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return wall - Math.floor(date.getTime() / 60e3) * 60e3;
}

export interface TimeStats {
  /** Start of the first bar, ms, in Italy wall time read as UTC: bars follow Italy's clock across a change of summer time. */
  start: number;
  /** Width of a bar, ms. */
  bin: number;
  counts: number[];
  /** Index of the highest bar, the first one on a tie. */
  peak: number;
}

/** Event counts per bar of time; null without events. */
export function timeStats(features: EventFeature[]): TimeStats | null {
  if (!features.length) return null;
  const times = features.map((f) => wall(eventDate(f.properties.time).getTime()));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const bin = TIME_BINS.find((b) => (t1 - t0) / b <= 60) ?? TIME_BINS[TIME_BINS.length - 1];
  const start = Math.floor(t0 / bin) * bin;
  const counts = Array<number>(Math.floor((t1 - start) / bin) + 1).fill(0);
  for (const t of times) counts[Math.floor((t - start) / bin)]++;
  return { start, bin, counts, peak: counts.indexOf(Math.max(...counts)) };
}

/** Italy wall time of an instant, as ms read as UTC. */
const wall = (t: number) => t + italyOffset(new Date(t));

/** The instant a bar starts: its Italy wall time back to UTC. */
export function barStart(stats: TimeStats, i: number): number {
  const w = stats.start + i * stats.bin;
  return w - italyOffset(new Date(w - italyOffset(new Date(w))));
}

/** Index of the bar of an instant, in ms. */
export const barAt = (stats: TimeStats, t: number) => Math.floor((wall(t) - stats.start) / stats.bin);

/** Index of the bar of an event time. */
export const binOf = (stats: TimeStats, time: string) => barAt(stats, eventDate(time).getTime());

/** Lower bound of the magnitude class of 0.5 a magnitude falls in: 2.5 holds 2.5 to 2.9. */
export const magClassOf = (mag: number) => Math.floor(Math.round(mag * 10) / 5) / 2;

/** Radiated energy of a magnitude, in joules: log10 E = 1.5 M + 4.8. */
export const energyOf = (mag: number) => 10 ** (1.5 * mag + 4.8);

export interface MagClass {
  from: number;
  count: number;
  /** Share of the energy of all events, 0 to 1. */
  energy: number;
}

/** Classes of 0.5 magnitude from the weakest event to the strongest, empty ones included. */
export function magClasses(features: EventFeature[]): MagClass[] {
  if (!features.length) return [];
  const mags = features.map((f) => f.properties.mag);
  const total = mags.reduce((s, m) => s + energyOf(m), 0);
  const lo = magClassOf(Math.min(...mags));
  const hi = magClassOf(Math.max(...mags));
  const classes: MagClass[] = [];
  for (let k = Math.round(lo * 2); k <= Math.round(hi * 2); k++) {
    const sub = mags.filter((m) => magClassOf(m) === k / 2);
    classes.push({ from: k / 2, count: sub.length, energy: sub.reduce((s, m) => s + energyOf(m), 0) / total });
  }
  return classes;
}

/** What a chart lights up on the map: a bar of time or a class of magnitude. */
export type Highlight = { time: number } | { mag: number };

/** The events of a highlight. */
export function highlighted(features: EventFeature[], stats: TimeStats | null, hl: Highlight): EventFeature[] {
  if ("mag" in hl) return features.filter((f) => magClassOf(f.properties.mag) === hl.mag);
  return stats ? features.filter((f) => binOf(stats, f.properties.time) === hl.time) : [];
}
