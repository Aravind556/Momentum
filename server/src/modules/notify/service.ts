import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { addDays, instantToLocalDate, isoWeekday } from "@momentum/shared";
import { notifications, profiles, scheduleBlocks, tasks } from "../../core/db/schema.js";
import type { Services } from "../../core/context.js";
import { notify } from "./notify.js";

export async function listNotifications(s: Services, userId: string, limit = 30) {
  const items = await s.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(limit, 100));
  const [{ n } = { n: 0 }] = await s.db
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return { items, unread: Number(n) };
}

export async function markRead(s: Services, userId: string, ids: string[] | "all") {
  await s.db
    .update(notifications)
    .set({ readAt: new Date(s.now()) })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), ids === "all" ? undefined : inArray(notifications.id, ids)));
}

/**
 * Periodic reminder sweep. Every notification has a deterministic dedupe key, so running the sweep
 * repeatedly (or from several processes) never produces duplicates.
 */
export async function runReminderSweep(s: Services) {
  const now = s.now();
  // Upcoming focus blocks in the next 10 minutes.
  const upcoming = await s.db
    .select({ id: scheduleBlocks.id, userId: scheduleBlocks.userId, title: scheduleBlocks.title, startAt: scheduleBlocks.startAt })
    .from(scheduleBlocks)
    .where(
      and(
        eq(scheduleBlocks.status, "planned"),
        eq(scheduleBlocks.kind, "focus"),
        gte(scheduleBlocks.startAt, new Date(now)),
        lte(scheduleBlocks.startAt, new Date(now + 10 * 60_000)),
      ),
    );
  for (const b of upcoming) {
    await notify(s.db, b.userId, "upcoming_block", { message: `Up next: ${b.title}`, blockId: b.id, startAt: b.startAt.toISOString() }, `block:${b.id}`);
  }

  // Tasks due within 24 hours that are not done.
  const due = await s.db
    .select({ id: tasks.id, ownerId: tasks.ownerId, title: tasks.title, dueAt: tasks.dueAt })
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, ["not_started", "scheduled", "in_progress", "partial"]),
        gte(tasks.dueAt, new Date(now)),
        lt(tasks.dueAt, new Date(now + 24 * 3600_000)),
      ),
    );
  for (const t of due) {
    await notify(s.db, t.ownerId, "deadline", { message: `"${t.title}" is due within 24 hours`, taskId: t.id }, `deadline:${t.id}:${t.dueAt!.toISOString()}`);
  }

  // Per-user, timezone-aware: the Monday weekly recap.
  const users = await s.db.select({ userId: profiles.userId, timezone: profiles.timezone }).from(profiles);
  for (const u of users) {
    const d = instantToLocalDate(now, u.timezone);
    if (isoWeekday(d) === 1) {
      await notify(s.db, u.userId, "weekly_recap", { message: "Your weekly recap is ready", link: "/progress", weekStart: addDays(d, -7) }, `recap:${d}`);
    }
  }
}
