import { and, eq, notInArray } from "drizzle-orm";
import { addDays, instantToLocalDate, localDayBounds, preferencesSchema } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import { profiles, tasks } from "../../core/db/schema.js";
import { notFound } from "../../core/http.js";
import { isRecurring, occursOn } from "../tasks/recurrence.js";
import { freeMinutesLeft, generatedTasksFor } from "./daily.js";
import { dailySources, type DayContext } from "./sources.js";

export interface ForecastItem {
  title: string;
  label: string | null;
  kind: "new" | "revision" | "group" | "task" | "deadline";
  category: string;
  estMinutes: number;
}
export interface ForecastDay {
  date: string;
  items: ForecastItem[];
  minutes: number;
}

const kindOf = (source: string, k: "due" | "new"): ForecastItem["kind"] => (source === "group" ? "group" : k === "new" ? "new" : "revision");

/**
 * "What's lined up": the coming days as the automation would plan them today, from every
 * daily source plus the user's own deadlines and repeating tasks. Nothing is stored — change a
 * setting and the forecast changes with it. It's an estimate: it assumes today's plan gets done
 * and revisions go "Good".
 */
export async function forecast(s: Services, userId: string, count = 14): Promise<{ today: string; days: ForecastDay[] }> {
  const profile = await s.db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!profile) throw notFound("Profile");
  const tz = profile.timezone;
  const today = instantToLocalDate(s.now(), tz);
  const days = Array.from({ length: Math.min(Math.max(count, 1), 28) }, (_, i) => addDays(today, i + 1));
  const byDay = new Map(days.map((d) => [d, [] as ForecastItem[]]));
  const prefs = preferencesSchema.parse(profile.preferences);
  const generated = await generatedTasksFor(s.db, userId, today);
  const capacity = new Map<string, number>();
  for (const d of days) capacity.set(d, await freeMinutesLeft(s.db, userId, d, localDayBounds(d, tz).start));

  for (const src of dailySources()) {
    if (!src.forecast) continue;
    const ctx: DayContext = { s, db: s.db, userId, day: today, tz, prefs, todays: generated.filter((t) => t.source === src.key), after: [], capacity };
    for (const e of await src.forecast(ctx, days)) {
      byDay.get(e.day)?.push({ title: e.candidate.title, label: e.candidate.label, kind: kindOf(src.key, e.candidate.kind), category: e.candidate.category, estMinutes: e.candidate.estMinutes });
    }
  }

  // The user's own work: deadlines falling in the window and repeating tasks.
  const own = await s.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.ownerId, userId), eq(tasks.source, "manual"), notInArray(tasks.status, ["completed", "cancelled", "skipped"])));
  for (const t of own) {
    if (isRecurring(t.recurrence)) {
      for (const d of days) {
        if (occursOn(t.recurrence, d)) byDay.get(d)!.push({ title: t.title, label: null, kind: "task", category: "mine", estMinutes: t.estimatedMinutes });
      }
    } else if (t.dueAt) {
      const due = instantToLocalDate(t.dueAt.getTime(), tz);
      byDay.get(due)?.push({ title: t.title, label: "Due", kind: "deadline", category: "mine", estMinutes: t.estimatedMinutes });
    }
  }

  return {
    today,
    days: days.map((date) => {
      const items = byDay.get(date)!;
      return { date, items, minutes: items.reduce((n, i) => n + (i.kind === "deadline" ? 0 : i.estMinutes), 0) };
    }),
  };
}
