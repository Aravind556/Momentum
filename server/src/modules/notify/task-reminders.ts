import { and, eq, isNotNull, isNull, ne, notInArray } from "drizzle-orm";
import { instantToLocalDate, instantToLocalMinutes } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import { env } from "../../core/env.js";
import { emailLog, profiles, taskCompletions, tasks, user } from "../../core/db/schema.js";
import { isRecurring, occursOn } from "../tasks/recurrence.js";
import { deliver } from "./channels.js";
import { refreshSubmissions } from "./reminders.js";

/** A reminder that is late by more than this (server was down, clock jumped) is dropped, not sent. */
const STALE_MS = 6 * 3600_000;

const fmtTime = (ms: number, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(ms);

/**
 * Per-task reminders, run every minute. Each task can ask to be reminded at a moment ("at") or at a
 * local time on each day it's due ("daily"). A reminder goes out once (push + in-app) and only if
 * the task is still open then; problem-verified tasks sync submissions first, so work that is
 * already solved never triggers one.
 */
export async function sendTaskReminders(s: Services) {
  const now = s.now();
  const rows = await s.db
    .select({ task: tasks, tz: profiles.timezone, email: user.email, name: profiles.displayName })
    .from(tasks)
    .innerJoin(profiles, eq(profiles.userId, tasks.ownerId))
    .innerJoin(user, eq(user.id, tasks.ownerId))
    .where(and(isNotNull(tasks.reminder), notInArray(tasks.status, ["completed", "cancelled", "skipped"])));
  let sent = 0;
  for (const { task: t, tz, email, name } of rows) {
    const r = t.reminder!;
    const day = instantToLocalDate(now, tz);
    // Generated day-plan items (roadmap, revision, group) only exist for their own day.
    if (t.planDay && t.planDay !== day) continue;

    let key: string;
    let dueMs: number;
    if (r.type === "at") {
      dueMs = Date.parse(r.at);
      key = `task-reminder:${t.id}:${r.at}`;
    } else {
      if (isRecurring(t.recurrence) && !occursOn(t.recurrence, day)) continue;
      const [h, m] = r.time.split(":").map(Number);
      dueMs = now - (instantToLocalMinutes(now, tz) - (h! * 60 + m!)) * 60_000;
      key = `task-reminder:${t.id}:${day}`;
    }
    if (dueMs > now || now - dueMs > STALE_MS) continue;
    if (await s.db.query.emailLog.findFirst({ where: and(eq(emailLog.userId, t.ownerId), eq(emailLog.key, key)) })) continue;

    const isDone = async () => {
      const occurrence = isRecurring(t.recurrence) ? day : null;
      const c = await s.db.query.taskCompletions.findFirst({
        where: and(
          eq(taskCompletions.taskId, t.id),
          isNull(taskCompletions.voidedAt),
          ne(taskCompletions.verificationStatus, "pending"),
          occurrence ? eq(taskCompletions.occurrenceKey, occurrence) : undefined,
        ),
      });
      return !!c;
    };
    if (await isDone()) continue;
    if (t.verification.provider !== "none") {
      await refreshSubmissions(s, t.ownerId, [t.verification.provider], now, 5 * 60_000);
      if (await isDone()) continue;
    }

    const due = t.dueAt ? ` It's due ${instantToLocalDate(t.dueAt.getTime(), tz) === day ? "today" : "on " + instantToLocalDate(t.dueAt.getTime(), tz)} at ${fmtTime(t.dueAt.getTime(), tz)}.` : "";
    sent += await deliver(
      s,
      { userId: t.ownerId, email, name },
      key,
      {
        subject: `Reminder: ${t.title}`,
        summary: `Reminder: "${t.title}" isn't done yet`,
        lines: [`"${t.title}" isn't done yet.${due}`],
        link: `${env.appUrl}/`,
        tag: `task-${t.id}`,
      },
      ["push", "in_app"],
    );
  }
  return sent;
}

