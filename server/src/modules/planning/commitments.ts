import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { dateRange, localToInstant, parseHHMM, type CommitmentInput } from "@momentum/shared";
import type { DB, Tx } from "../../core/db/index.js";
import { commitments } from "../../core/db/schema.js";
import { notFound } from "../../core/http.js";
import { occursOn } from "../tasks/recurrence.js";

export type Commitment = typeof commitments.$inferSelect;

function toRow(input: CommitmentInput) {
  return {
    title: input.title,
    flexible: input.flexible,
    startAt: !input.flexible && input.startAt ? new Date(input.startAt) : null,
    endAt: !input.flexible && input.endAt ? new Date(input.endAt) : null,
    date: input.date ?? null,
    window: input.flexible ? (input.window ?? null) : null,
    durationMinutes: input.flexible ? (input.durationMinutes ?? null) : null,
    recurrence: input.recurrence,
    until: input.until ?? null,
  };
}

export async function createCommitment(db: DB, userId: string, input: CommitmentInput) {
  const [row] = await db.insert(commitments).values({ ...toRow(input), userId }).returning();
  return row!;
}

export async function updateCommitment(db: DB, userId: string, id: string, input: CommitmentInput) {
  const [row] = await db
    .update(commitments)
    .set(toRow(input))
    .where(and(eq(commitments.id, id), eq(commitments.userId, userId)))
    .returning();
  if (!row) throw notFound("Commitment");
  return row;
}

export async function deleteCommitment(db: DB, userId: string, id: string) {
  const [row] = await db.delete(commitments).where(and(eq(commitments.id, id), eq(commitments.userId, userId))).returning();
  if (!row) throw notFound("Commitment");
}

export async function listCommitments(db: Tx, userId: string) {
  return db.select().from(commitments).where(eq(commitments.userId, userId));
}

export interface FixedOccurrence {
  commitmentId: string;
  title: string;
  start: number;
  end: number;
  date: string;
}

export interface FlexibleOccurrence {
  commitmentId: string;
  title: string;
  date: string;
  window: { start: string; end: string };
  durationMinutes: number;
}

/**
 * Expands commitments into concrete occurrences for a date range. Recurring fixed commitments
 * repeat the first occurrence's local wall-clock times in the user's timezone (DST-safe).
 */
export function expandCommitments(rows: Commitment[], tz: string, startDate: string, endDate: string) {
  const fixed: FixedOccurrence[] = [];
  const flexible: FlexibleOccurrence[] = [];
  // include the previous day so commitments crossing midnight are not missed
  const dates = dateRange(DateTime.fromISO(startDate).minus({ days: 1 }).toISODate()!, endDate);
  for (const c of rows) {
    if (!c.flexible && c.startAt && c.endAt) {
      const first = DateTime.fromJSDate(c.startAt, { zone: tz });
      const firstDate = first.toISODate()!;
      const durMs = c.endAt.getTime() - c.startAt.getTime();
      if (c.recurrence.type === "none") {
        if (firstDate >= dates[0]! && firstDate <= endDate) {
          fixed.push({ commitmentId: c.id, title: c.title, start: c.startAt.getTime(), end: c.endAt.getTime(), date: firstDate });
        }
        continue;
      }
      const startMin = first.hour * 60 + first.minute;
      for (const d of dates) {
        if (d < firstDate || (c.until && d > c.until) || !occursOn(c.recurrence, d)) continue;
        const start = localToInstant(d, startMin, tz);
        fixed.push({ commitmentId: c.id, title: c.title, start, end: start + durMs, date: d });
      }
    } else if (c.flexible && c.window && c.durationMinutes) {
      for (const d of dates.slice(1)) {
        const matches = c.recurrence.type === "none" ? c.date === d : occursOn(c.recurrence, d) && (!c.until || d <= c.until);
        if (!matches) continue;
        flexible.push({ commitmentId: c.id, title: c.title, date: d, window: c.window, durationMinutes: c.durationMinutes });
      }
    }
  }
  return { fixed, flexible };
}

export function windowMinutes(w: { start: string; end: string }) {
  const s = parseHHMM(w.start);
  let e = parseHHMM(w.end);
  if (e <= s) e += 24 * 60;
  return { startMinute: s, endMinute: e };
}
