import { and, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import {
  addDays,
  computeStreaks,
  dateRange,
  instantToLocalDate,
  instantToLocalMinutes,
  localDayBounds,
  type DayState,
} from "@cadence/shared";
import type { Tx } from "../../core/db/index.js";
import { focusSessions, goals, profiles, scheduleBlocks, taskCompletions, tasks } from "../../core/db/schema.js";
import { notFound } from "../../core/http.js";
import type { Services } from "../../core/context.js";

/**
 * Streak over the last `days` local days. A day is active when a task was completed or a focus
 * block was done; missed when focus work was scheduled but nothing was done; otherwise neutral
 * (rest days and unplanned days never break a streak).
 */
export async function computeStreak(db: Tx, userId: string, tz: string, now: number, days = 180) {
  const today = instantToLocalDate(now, tz);
  const start = addDays(today, -(days - 1));
  const completionDays = await db
    .selectDistinct({ day: taskCompletions.day })
    .from(taskCompletions)
    .where(and(eq(taskCompletions.userId, userId), isNull(taskCompletions.voidedAt), gte(taskCompletions.day, start)));
  const blockRows = await db
    .select({ day: scheduleBlocks.day, status: scheduleBlocks.status })
    .from(scheduleBlocks)
    .where(
      and(
        eq(scheduleBlocks.userId, userId),
        eq(scheduleBlocks.kind, "focus"),
        gte(scheduleBlocks.day, start),
        lt(scheduleBlocks.startAt, new Date(now)),
      ),
    );
  const active = new Set(completionDays.map((d) => d.day));
  const planned = new Set<string>();
  for (const b of blockRows) {
    planned.add(b.day);
    if (b.status === "completed" || b.status === "partial") active.add(b.day);
  }
  const states: DayState[] = dateRange(start, today).map((d) => (active.has(d) ? "active" : planned.has(d) ? "missed" : "neutral"));
  return { ...computeStreaks(states), today, history: states.slice(-28) };
}

const PERIODS: Record<string, [number, number]> = {
  morning: [0, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
};

/** Personal analytics over the last `days` local days, computed only from recorded data. */
export async function personalAnalytics(s: Services, userId: string, days: number) {
  const now = s.now();
  const profile = await s.db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!profile) throw notFound("Profile");
  const tz = profile.timezone;
  const today = instantToLocalDate(now, tz);
  const start = addDays(today, -(days - 1));
  const prevStart = addDays(start, -days);
  const series = dateRange(start, today).map((date) => ({
    date,
    plannedMinutes: 0,
    completedMinutes: 0,
    focusMinutes: 0,
    plannedBlocks: 0,
    doneBlocks: 0,
    completions: 0,
  }));
  const byDate = new Map(series.map((d) => [d.date, d]));

  const blocks = await s.db
    .select()
    .from(scheduleBlocks)
    .where(and(eq(scheduleBlocks.userId, userId), eq(scheduleBlocks.kind, "focus"), gte(scheduleBlocks.day, prevStart), lte(scheduleBlocks.day, today)));
  const sessions = await s.db
    .select()
    .from(focusSessions)
    .where(
      and(
        eq(focusSessions.userId, userId),
        eq(focusSessions.kind, "focus"),
        gte(focusSessions.startedAt, new Date(localDayBounds(prevStart, tz).start)),
      ),
    );
  const completions = await s.db
    .select()
    .from(taskCompletions)
    .where(and(eq(taskCompletions.userId, userId), isNull(taskCompletions.voidedAt), gte(taskCompletions.day, prevStart)));

  const prev = { planned: 0, done: 0, focus: 0, completions: 0 };
  const periodStats = Object.fromEntries(Object.keys(PERIODS).map((k) => [k, { planned: 0, done: 0 }]));
  const missedByTask = new Map<string, { title: string; count: number }>();

  for (const b of blocks) {
    const minutes = Math.round((b.endAt.getTime() - b.startAt.getTime()) / 60_000);
    const past = b.startAt.getTime() < now;
    const done = b.status === "completed" || b.status === "partial";
    if (b.day < start) {
      if (past) {
        prev.planned += 1;
        if (done) prev.done += 1;
      }
      continue;
    }
    const d = byDate.get(b.day);
    if (!d) continue;
    d.plannedMinutes += minutes;
    if (done) d.completedMinutes += b.actualMinutes ?? minutes;
    if (past) {
      d.plannedBlocks += 1;
      if (done) d.doneBlocks += 1;
      const m = instantToLocalMinutes(b.startAt.getTime(), tz);
      for (const [k, [lo, hi]] of Object.entries(PERIODS)) {
        if (m >= lo && m < hi) {
          periodStats[k]!.planned += 1;
          if (done) periodStats[k]!.done += 1;
        }
      }
    }
    if (b.status === "missed" && b.taskId) {
      const e = missedByTask.get(b.taskId) ?? { title: b.title, count: 0 };
      e.count += 1;
      missedByTask.set(b.taskId, e);
    }
  }
  const focusByTask = new Map<string, number>();
  for (const f of sessions) {
    const minutes = Math.round((f.activeSeconds ?? 0) / 60);
    const day = instantToLocalDate(f.startedAt.getTime(), tz);
    if (day < start) {
      prev.focus += minutes;
      continue;
    }
    const d = byDate.get(day);
    if (d) d.focusMinutes += minutes;
    if (f.taskId) focusByTask.set(f.taskId, (focusByTask.get(f.taskId) ?? 0) + minutes);
  }
  for (const c of completions) {
    if (c.outcome !== "completed") continue;
    if (c.day < start) prev.completions += 1;
    else {
      const d = byDate.get(c.day);
      if (d) d.completions += 1;
    }
  }

  // Focus minutes by goal category (tasks without a goal count as "other").
  const categoryMinutes: Record<string, number> = {};
  const taskIds = [...focusByTask.keys()];
  if (taskIds.length) {
    const rows = await s.db
      .select({ id: tasks.id, category: goals.category })
      .from(tasks)
      .leftJoin(goals, eq(goals.id, tasks.goalId))
      .where(inArray(tasks.id, taskIds));
    for (const r of rows) {
      const cat = r.category ?? "other";
      categoryMinutes[cat] = (categoryMinutes[cat] ?? 0) + (focusByTask.get(r.id) ?? 0);
    }
  }

  const overdue = await s.db
    .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, userId),
        inArray(tasks.status, ["not_started", "scheduled", "in_progress", "partial"]),
        lt(tasks.dueAt, new Date(now)),
      ),
    );

  const totals = series.reduce(
    (a, d) => ({
      plannedMinutes: a.plannedMinutes + d.plannedMinutes,
      completedMinutes: a.completedMinutes + d.completedMinutes,
      focusMinutes: a.focusMinutes + d.focusMinutes,
      plannedBlocks: a.plannedBlocks + d.plannedBlocks,
      doneBlocks: a.doneBlocks + d.doneBlocks,
      completions: a.completions + d.completions,
    }),
    { plannedMinutes: 0, completedMinutes: 0, focusMinutes: 0, plannedBlocks: 0, doneBlocks: 0, completions: 0 },
  );
  const streak = await computeStreak(s.db, userId, tz, now);
  const insights = buildInsights(series, totals, prev, periodStats, missedByTask);

  return {
    timezone: tz,
    startDate: start,
    endDate: today,
    series,
    totals: { ...totals, completionRate: totals.plannedBlocks ? totals.doneBlocks / totals.plannedBlocks : null },
    previous: { ...prev, completionRate: prev.planned ? prev.done / prev.planned : null },
    categoryMinutes,
    overdue,
    rescheduled: [...missedByTask.entries()]
      .filter(([, v]) => v.count >= 2)
      .map(([taskId, v]) => ({ taskId, title: v.title, missedBlocks: v.count }))
      .sort((a, b) => b.missedBlocks - a.missedBlocks),
    streak: { current: streak.current, longest: streak.longest, history: streak.history },
    insights,
  };
}

/** Rule-based observations. Each one is only produced when the underlying data supports it. */
function buildInsights(
  series: Array<{ date: string; plannedBlocks: number; doneBlocks: number; focusMinutes: number }>,
  totals: { plannedBlocks: number; doneBlocks: number; focusMinutes: number; completions: number },
  prev: { planned: number; done: number; focus: number; completions: number },
  periods: Record<string, { planned: number; done: number }>,
  missed: Map<string, { title: string; count: number }>,
): string[] {
  const out: string[] = [];
  if (totals.plannedBlocks > 0) {
    out.push(
      `You completed ${totals.doneBlocks} of ${totals.plannedBlocks} scheduled focus sessions (${Math.round((totals.doneBlocks / totals.plannedBlocks) * 100)}%).`,
    );
  }
  const planned = series.filter((d) => d.plannedBlocks > 0);
  if (planned.length >= 4) {
    const sorted = [...planned].map((d) => d.plannedBlocks).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const heavy = planned.filter((d) => d.plannedBlocks > median);
    const light = planned.filter((d) => d.plannedBlocks <= median);
    const rate = (ds: typeof planned) => ds.reduce((s, d) => s + d.doneBlocks, 0) / ds.reduce((s, d) => s + d.plannedBlocks, 0);
    if (heavy.length >= 2 && light.length >= 2) {
      const h = rate(heavy);
      const l = rate(light);
      if (Math.abs(h - l) >= 0.15) {
        out.push(
          `On days with more than ${median} sessions planned you completed ${Math.round(h * 100)}% of them, versus ${Math.round(l * 100)}% on lighter days.`,
        );
      }
    }
  }
  const periodRates = Object.entries(periods)
    .filter(([, v]) => v.planned >= 5)
    .map(([k, v]) => ({ k, rate: v.done / v.planned }));
  if (periodRates.length >= 2) {
    periodRates.sort((a, b) => b.rate - a.rate);
    const best = periodRates[0]!;
    const worst = periodRates[periodRates.length - 1]!;
    if (best.rate - worst.rate >= 0.2) {
      out.push(`You follow through most in the ${best.k} (${Math.round(best.rate * 100)}%) and least in the ${worst.k} (${Math.round(worst.rate * 100)}%).`);
    }
  }
  if (prev.focus > 0 || totals.focusMinutes > 0) {
    const diff = totals.focusMinutes - prev.focus;
    if (prev.focus > 0 && Math.abs(diff) >= 30) {
      out.push(`Focus time ${diff > 0 ? "rose" : "fell"} by ${Math.abs(diff)} minutes compared with the previous period.`);
    }
  }
  const worstTask = [...missed.values()].sort((a, b) => b.count - a.count)[0];
  if (worstTask && worstTask.count >= 2) {
    out.push(`"${worstTask.title}" was missed ${worstTask.count} times — consider shortening its sessions or moving it to a time you usually keep.`);
  }
  return out;
}
