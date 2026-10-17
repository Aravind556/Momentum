/** Half-open interval [start, end) in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

export function isValidInterval(i: Interval): boolean {
  return Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start;
}

/** Sorts and merges overlapping or touching intervals. Invalid intervals are dropped. */
export function mergeIntervals<T extends Interval>(intervals: T[]): Interval[] {
  const sorted = intervals.filter(isValidInterval).map((i) => ({ start: i.start, end: i.end }));
  sorted.sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/** base − cuts. Both lists may be unsorted/overlapping. */
export function subtractIntervals(base: Interval[], cuts: Interval[]): Interval[] {
  const merged = mergeIntervals(cuts);
  const out: Interval[] = [];
  for (const b of mergeIntervals(base)) {
    let cursor = b.start;
    for (const c of merged) {
      if (c.end <= cursor) continue;
      if (c.start >= b.end) break;
      if (c.start > cursor) out.push({ start: cursor, end: Math.min(c.start, b.end) });
      cursor = Math.max(cursor, c.end);
      if (cursor >= b.end) break;
    }
    if (cursor < b.end) out.push({ start: cursor, end: b.end });
  }
  return out;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function clampInterval(i: Interval, lo: number, hi: number): Interval | null {
  const start = Math.max(i.start, lo);
  const end = Math.min(i.end, hi);
  return end > start ? { start, end } : null;
}

export function totalDuration(intervals: Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, i) => sum + (i.end - i.start), 0);
}
