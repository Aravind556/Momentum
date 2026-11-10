import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { addDays, dateRange, instantToLocalDate, localDayBounds } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import { externalEvents, focusSessions, itemProgress, taskCompletions, tasks } from "../../core/db/schema.js";
import { ACCEPTED } from "../platforms/types.js";

/** What finished work counts as, for the activity chart. */
export const ACTIVITY_KINDS = ["tasks", "roadmap", "revisions", "group", "problems"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityDay extends Record<ActivityKind, number> {
  date: string;
  total: number;
  focusMinutes: number;
}

const KIND_BY_SOURCE: Record<string, ActivityKind> = { manual: "tasks", roadmap: "roadmap", review: "revisions", group: "group" };

/**
 * Everything finished in Momentum per local day: own tasks, roadmap items, revisions, group tasks,
 * and other accepted problems (solves beyond the ones already counted as a verified item that day,
 * so a verified roadmap problem counts once). Plus focus minutes, streak and week-over-week totals.
 */
export async function activity(s: Services, userId: string, tz: string, days: number) {
  const now = s.now();
  const today = instantToLocalDate(now, tz);
  // Look back far enough for streaks and the week-over-week comparison, whatever range is shown.
  const span = Math.max(days, 90);
  const start = addDays(today, -(span - 1));
  const startAt = new Date(localDayBounds(start, tz).start);
  const series = new Map<string, ActivityDay>(
    dateRange(start, today).map((date) => [date, { date, tasks: 0, roadmap: 0, revisions: 0, group: 0, problems: 0, total: 0, focusMinutes: 0 }]),
  );

  const done = await s.db
    .select({ day: taskCompletions.day, source: tasks.source, sourceId: tasks.sourceId, verification: taskCompletions.verificationStatus })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(and(eq(taskCompletions.userId, userId), isNull(taskCompletions.voidedAt), gte(taskCompletions.day, start)));
  const verifiedPerDay = new Map<string, number>();
  const roadmapItemDays = new Set<string>();
  for (const c of done) {
    if (c.verification === "pending") continue;
    const d = series.get(c.day);
    if (!d) continue;
    d[KIND_BY_SOURCE[c.source] ?? "tasks"] += 1;
    if (c.verification === "verified") verifiedPerDay.set(c.day, (verifiedPerDay.get(c.day) ?? 0) + 1);
    if (c.source === "roadmap" && c.sourceId) roadmapItemDays.add(`${c.sourceId}:${c.day}`);
  }

  // Roadmap items ticked from the roadmap page rather than from Today.
  const items = await s.db
    .select({ itemId: itemProgress.itemId, doneAt: itemProgress.doneAt, verifiedBy: itemProgress.verifiedBy })
    .from(itemProgress)
    .where(and(eq(itemProgress.userId, userId), eq(itemProgress.status, "done"), isNotNull(itemProgress.doneAt), gte(itemProgress.doneAt, startAt)));
  for (const it of items) {
    const day = instantToLocalDate(it.doneAt!.getTime(), tz);
    const d = series.get(day);
    if (!d || roadmapItemDays.has(`${it.itemId}:${day}`)) continue;
    d.roadmap += 1;
    if (it.verifiedBy === "submission") verifiedPerDay.set(day, (verifiedPerDay.get(day) ?? 0) + 1);
  }

  // Distinct accepted problems per day, minus those already counted through a verified item.
  const subs = await s.db
    .select({ provider: externalEvents.provider, occurredAt: externalEvents.occurredAt, data: externalEvents.data })
    .from(externalEvents)
    .where(and(eq(externalEvents.userId, userId), eq(externalEvents.type, ACCEPTED), gte(externalEvents.occurredAt, startAt)));
  const solved = new Map<string, Set<string>>();
  for (const e of subs) {
    const day = instantToLocalDate(e.occurredAt.getTime(), tz);
    const set = solved.get(day) ?? new Set<string>();
    set.add(`${e.provider}:${String(e.data.problemKey ?? e.occurredAt.getTime())}`);
    solved.set(day, set);
  }
  for (const [day, set] of solved) {
    const d = series.get(day);
    if (d) d.problems += Math.max(0, set.size - (verifiedPerDay.get(day) ?? 0));
  }

  const sessions = await s.db
    .select({ startedAt: focusSessions.startedAt, activeSeconds: focusSessions.activeSeconds })
    .from(focusSessions)
    .where(and(eq(focusSessions.userId, userId), eq(focusSessions.kind, "focus"), gte(focusSessions.startedAt, startAt)));
  for (const f of sessions) {
    const d = series.get(instantToLocalDate(f.startedAt.getTime(), tz));
    if (d) d.focusMinutes += Math.round((f.activeSeconds ?? 0) / 60);
  }

  const all = [...series.values()];
  for (const d of all) d.total = ACTIVITY_KINDS.reduce((n, k) => n + d[k], 0);
  const sum = (list: ActivityDay[]) => list.reduce((n, d) => n + d.total, 0);
  const shown = all.slice(-days);
  const byKind = Object.fromEntries(ACTIVITY_KINDS.map((k) => [k, shown.reduce((n, d) => n + d[k], 0)])) as Record<ActivityKind, number>;
  const best = shown.reduce<ActivityDay | null>((b, d) => (d.total > (b?.total ?? 0) ? d : b), null);
  // A streak is consecutive days with anything done; today only counts once something is done.
  const active = all.map((d) => d.total > 0);
  let longest = 0;
  let run = 0;
  for (const a of active) {
    run = a ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = active.length - (active[active.length - 1] ? 1 : 2); i >= 0 && active[i]; i--) current += 1;

  return {
    today,
    days: shown,
    total: sum(shown),
    byKind,
    focusMinutes: shown.reduce((n, d) => n + d.focusMinutes, 0),
    thisWeek: sum(all.slice(-7)),
    lastWeek: sum(all.slice(-14, -7)),
    bestDay: best ? { date: best.date, total: best.total } : null,
    activeDays: shown.filter((d) => d.total > 0).length,
    streak: { current, longest, doneToday: active[active.length - 1] ?? false },
  };
}
