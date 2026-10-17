import { DateTime } from "luxon";

export const MINUTE = 60_000;
export const DAY_MS = 24 * 60 * MINUTE;

/** "HH:mm" -> minutes since midnight. Accepts "24:00" as end-of-day. */
export function parseHHMM(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`Invalid time "${value}", expected HH:mm`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) throw new Error(`Invalid time "${value}"`);
  return h * 60 + min;
}

export function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Validates an IANA timezone name. */
export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

/**
 * Converts a local wall-clock time on a local date into an epoch-ms instant.
 * Non-existent local times (DST spring-forward gap) are shifted forward by Luxon;
 * ambiguous times (fall-back) resolve to the earlier offset.
 */
export function localToInstant(date: string, minutesOfDay: number, tz: string): number {
  const base = DateTime.fromISO(date, { zone: tz }).startOf("day");
  if (!base.isValid) throw new Error(`Invalid date "${date}" or timezone "${tz}"`);
  const dayOffset = Math.floor(minutesOfDay / (24 * 60));
  const rem = minutesOfDay - dayOffset * 24 * 60;
  return base
    .plus({ days: dayOffset })
    .set({ hour: Math.floor(rem / 60), minute: rem % 60, second: 0, millisecond: 0 })
    .toMillis();
}

/** Local date ("yyyy-MM-dd") of an instant in a timezone. */
export function instantToLocalDate(ms: number, tz: string): string {
  return DateTime.fromMillis(ms, { zone: tz }).toISODate()!;
}

/** Minutes since local midnight of an instant in a timezone. */
export function instantToLocalMinutes(ms: number, tz: string): number {
  const dt = DateTime.fromMillis(ms, { zone: tz });
  return dt.hour * 60 + dt.minute;
}

/** ISO weekday 1 (Monday) .. 7 (Sunday) for a local date. */
export function isoWeekday(date: string): number {
  return DateTime.fromISO(date).weekday;
}

/** Inclusive list of local dates between start and end. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(start);
  const last = DateTime.fromISO(end);
  if (!d.isValid || !last.isValid) throw new Error("Invalid date range");
  while (d <= last) {
    out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date).plus({ days }).toISODate()!;
}

/** Start/end instants of a local calendar day (handles 23h/25h DST days). */
export function localDayBounds(date: string, tz: string): { start: number; end: number } {
  const start = DateTime.fromISO(date, { zone: tz }).startOf("day");
  return { start: start.toMillis(), end: start.plus({ days: 1 }).toMillis() };
}

export function todayInZone(tz: string, now: number = Date.now()): string {
  return instantToLocalDate(now, tz);
}

export function minutesBetween(a: number, b: number): number {
  return Math.round((b - a) / MINUTE);
}
