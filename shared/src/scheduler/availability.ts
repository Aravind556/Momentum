import { mergeIntervals, subtractIntervals, type Interval } from "../intervals.js";
import { addDays, dateRange, isoWeekday, localToInstant, parseHHMM } from "../time.js";
import type { AvailabilitySpec, BusyInterval, TimeRange, WorkWindow } from "./types.js";

function rangeToInterval(date: string, range: TimeRange, tz: string): Interval | null {
  const s = parseHHMM(range.start);
  let e = parseHHMM(range.end);
  if (e === s) return null;
  if (e < s) e += 24 * 60; // crosses midnight
  const start = localToInstant(date, s, tz);
  const end = localToInstant(date, e, tz);
  return end > start ? { start, end } : null;
}

/**
 * Working windows for each date in [startDate, endDate]:
 * weekly ranges (or the date override) minus recurring blocked intervals.
 * Windows that cross midnight belong to the day on which they start.
 */
export function computeWorkWindows(
  spec: AvailabilitySpec,
  tz: string,
  startDate: string,
  endDate: string,
): WorkWindow[] {
  const overrides = new Map(spec.overrides.map((o) => [o.date, o]));
  const out: WorkWindow[] = [];
  for (const date of dateRange(startDate, endDate)) {
    const wd = isoWeekday(date);
    const ov = overrides.get(date);
    let ranges: TimeRange[];
    if (ov?.off) ranges = [];
    else if (ov?.windows) ranges = ov.windows;
    else ranges = spec.weekly[wd] ?? [];

    const base = ranges.map((r) => rangeToInterval(date, r, tz)).filter((i): i is Interval => i !== null);
    if (base.length === 0) continue;

    // Blocked ranges of this day, of the next day (an overnight window can reach it),
    // and of the previous day (a blocked range may spill past midnight).
    const blocked: Interval[] = [];
    for (const d of [addDays(date, -1), date, addDays(date, 1)]) {
      for (const b of spec.blocked) {
        if (!b.weekdays.includes(isoWeekday(d))) continue;
        const i = rangeToInterval(d, b, tz);
        if (i) blocked.push(i);
      }
    }

    for (const w of subtractIntervals(mergeIntervals(base), blocked)) out.push({ ...w, day: date });
  }
  return out;
}

/** Free intervals = windows − busy, clipped to notBefore, snapped to `stepMinutes`. */
export function computeFreeIntervals(
  windows: WorkWindow[],
  busy: Interval[],
  notBefore: number | undefined,
  stepMinutes = 5,
): WorkWindow[] {
  const step = stepMinutes * 60_000;
  const out: WorkWindow[] = [];
  for (const w of windows) {
    const lo = notBefore !== undefined ? Math.max(w.start, notBefore) : w.start;
    if (lo >= w.end) continue;
    for (const f of subtractIntervals([{ start: lo, end: w.end }], busy)) {
      const start = Math.ceil(f.start / step) * step;
      const end = Math.floor(f.end / step) * step;
      if (end > start) out.push({ start, end, day: w.day });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function busyToIntervals(busy: BusyInterval[]): Interval[] {
  return busy.map((b) => ({ start: b.start, end: b.end }));
}
