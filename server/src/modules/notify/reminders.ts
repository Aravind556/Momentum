import { and, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { instantToLocalDate, instantToLocalMinutes, localDayBounds, preferencesSchema } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import { env } from "../../core/env.js";
import { emailLog, integrationConnections, profiles, taskCompletions, tasks, user } from "../../core/db/schema.js";
import { ensureDay } from "../planning/daily.js";
import { asBackground } from "../platforms/limiter.js";
import { syncConnection } from "../platforms/service.js";
import { isRecurring, occursOn } from "../tasks/recurrence.js";
import { deliver, type Recipient } from "./channels.js";

const OPEN = ["completed", "cancelled", "skipped"] as const;

/** What's still open today: day-plan work plus the user's own tasks due today or repeating today. */
async function pendingToday(s: Services, userId: string, day: string, tz: string) {
  const bounds = localDayBounds(day, tz);
  const rows = await s.db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, userId),
        notInArray(tasks.status, [...OPEN]),
        sql`(${tasks.planDay} = ${day} or (${tasks.source} = 'manual' and (
          (${tasks.dueAt} >= ${new Date(bounds.start).toISOString()} and ${tasks.dueAt} <= ${new Date(bounds.end).toISOString()})
          or ${tasks.recurrence}->>'type' <> 'none')))`,
      ),
    );
  const candidates = rows.filter((t) => !isRecurring(t.recurrence) || occursOn(t.recurrence, day));
  if (!candidates.length) return [];
  const done = await s.db
    .select({ taskId: taskCompletions.taskId, key: taskCompletions.occurrenceKey })
    .from(taskCompletions)
    .where(and(inArray(taskCompletions.taskId, candidates.map((t) => t.id)), isNull(taskCompletions.voidedAt), ne(taskCompletions.verificationStatus, "pending")));
  return candidates.filter((t) => !done.some((d) => d.taskId === t.id && (isRecurring(t.recurrence) ? d.key === day : true)));
}

/** Before nagging, pick up anything solved since the last sync (light, background priority). */
async function refreshSubmissions(s: Services, userId: string, providers: string[], now: number) {
  const conns = await s.db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.userId, userId), inArray(integrationConnections.provider, providers), ne(integrationConnections.status, "disconnected")));
  await asBackground(async () => {
    for (const c of conns) {
      if (c.lastSyncAt && now - c.lastSyncAt.getTime() < 30 * 60_000) continue;
      await syncConnection(s, userId, c.provider).catch(() => undefined);
    }
  });
}

const line = (t: { title: string; sourceLabel: string | null; resourceUrl: string | null }) =>
  `• ${t.title}${t.sourceLabel ? ` — ${t.sourceLabel}` : ""}${t.resourceUrl ? ` (${t.resourceUrl})` : ""}`;

/**
 * Reminders, run every 15 minutes, only while something on today's plan is still open:
 *  - a browser push every `every` hours from `startHour` (09:00, 13:00, 17:00 by default);
 *  - the final reminder of the day at `hour` (21:00): email + push + in-app;
 *  - a push when a group task is due within two hours.
 * Each reminder has a deterministic key, so repeated or concurrent runs never send twice, and the
 * latest submissions are synced first so already-solved work doesn't trigger anything.
 */
export async function sendReminders(s: Services) {
  const now = s.now();
  const people = await s.db
    .select({ userId: profiles.userId, timezone: profiles.timezone, preferences: profiles.preferences, lastPlannedDay: profiles.lastPlannedDay, email: user.email, name: profiles.displayName })
    .from(profiles)
    .innerJoin(user, eq(user.id, profiles.userId));
  let sent = 0;
  for (const p of people) {
    const r = preferencesSchema.parse(p.preferences).reminders;
    const day = instantToLocalDate(now, p.timezone);
    const minute = instantToLocalMinutes(now, p.timezone);
    const to: Recipient = { userId: p.userId, email: p.email, name: p.name };

    // Which reminder (if any) is due right now?
    const final = (r.email || r.push) && minute >= r.hour * 60;
    const slot = r.push && minute >= r.startHour * 60 && minute < r.hour * 60 ? Math.floor((minute - r.startHour * 60) / (r.every * 60)) : null;
    const key = final ? `final:${day}` : slot !== null ? `push:${day}:${slot}` : null;
    const dueSoon = r.push && r.groupDueSoon;
    if (!key && !dueSoon) continue;
    if (key && (await s.db.query.emailLog.findFirst({ where: and(eq(emailLog.userId, p.userId), eq(emailLog.key, key)) }))) {
      if (!dueSoon) continue;
    }

    if (p.lastPlannedDay !== day) await ensureDay(s, p.userId, day).catch(() => undefined);
    let pending = await pendingToday(s, p.userId, day, p.timezone);
    if (!pending.length) continue;
    const providers = [...new Set(pending.map((t) => t.verification.provider).filter((x) => x !== "none"))];
    if (providers.length) {
      await refreshSubmissions(s, p.userId, providers, now);
      pending = await pendingToday(s, p.userId, day, p.timezone);
      if (!pending.length) continue;
    }

    // Group tasks due within two hours.
    if (dueSoon) {
      for (const t of pending.filter((x) => x.source === "group" && x.dueAt && x.dueAt.getTime() > now && x.dueAt.getTime() <= now + 2 * 3600_000)) {
        const at = new Intl.DateTimeFormat("en-GB", { timeZone: p.timezone, hour: "2-digit", minute: "2-digit" }).format(t.dueAt!);
        sent += await deliver(
          s,
          to,
          `due:${t.id}`,
          {
            subject: `Due by ${at}: ${t.title}`,
            summary: `"${t.title}" for ${t.sourceLabel ?? "your group"} is due by ${at}`,
            lines: [`"${t.title}" for ${t.sourceLabel ?? "your group"} is due by ${at}.`],
            link: `${env.appUrl}/`,
            tag: `due-${t.id}`,
          },
          ["push", "in_app"],
        );
      }
    }

    if (!key) continue;
    const n = pending.length;
    const items = [...pending.slice(0, 15).map(line), ...(n > 15 ? [`…and ${n - 15} more.`] : [])];
    sent += await deliver(
      s,
      to,
      key,
      final
        ? {
            subject: `${n} task${n === 1 ? "" : "s"} still open today`,
            summary: `Last reminder: ${n} task${n === 1 ? "" : "s"} still open today`,
            lines: [`Hi ${p.name},`, `Last reminder for today — ${n === 1 ? "this is" : "these are"} still open:`, ...items],
            link: `${env.appUrl}/`,
            tag: "momentum-reminder",
          }
        : {
            subject: `${n} task${n === 1 ? "" : "s"} left today`,
            summary: `${n} task${n === 1 ? "" : "s"} left today`,
            lines: items,
            link: `${env.appUrl}/`,
            tag: "momentum-reminder",
          },
      final ? [...(r.email ? ["email"] : []), ...(r.push ? ["push"] : []), "in_app"] : ["push"],
    );
  }
  return sent;
}
