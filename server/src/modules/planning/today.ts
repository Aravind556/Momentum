import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { instantToLocalDate, localDayBounds, localToInstant, parseHHMM, preferencesSchema } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import { integrationConnections, profiles, reviews, scheduleBlocks, taskCompletions, tasks } from "../../core/db/schema.js";
import { badRequest, notFound } from "../../core/http.js";
import { manualSync, verifyTasks } from "../platforms/service.js";
import { completeTask, reopenTask, skipTask } from "../tasks/completions.js";
import { isRecurring, occursOn } from "../tasks/recurrence.js";
import { getOwnedTask } from "../tasks/tasks.js";
import { ensureDay, generatedTasksFor } from "./daily.js";
import { createManualBlock } from "./schedules.js";
import { dailySources, type DailyCandidate, type DayContext } from "./sources.js";

async function userDay(s: Services, userId: string) {
  const p = await s.db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!p) throw notFound("Profile");
  return { profile: p, tz: p.timezone, day: instantToLocalDate(s.now(), p.timezone) };
}

export interface TodayItem {
  taskId: string;
  title: string;
  url: string | null;
  category: string;
  source: string;
  label: string | null;
  estMinutes: number;
  status: "pending" | "done" | "skipped";
  /** How completion is decided: an accepted submission, or the learner's own tick. */
  check: "submission" | "self";
  verifiedBy: "submission" | "self" | null;
  completedAt: string | null;
  block: { startAt: string; endAt: string; status: string } | null;
  /** For revisions: the card and today's rating (null until rated; defaults to "good"). */
  review: { cardId: string; quality: number | null } | null;
  recurring: boolean;
  /** Can be swapped for another item of the same category. */
  swappable: boolean;
  /** "Due by" time (group tasks, own deadlines). Day-plan items are otherwise open all day. */
  dueAt: string | null;
}

/**
 * The day plan: generated work (roadmap items, revisions, group tasks) plus the user's own tasks
 * that are scheduled, due or recurring today. Builds the plan first if it hasn't been yet.
 */
export async function getToday(s: Services, userId: string) {
  const { tz, day } = await userDay(s, userId);
  const plan = await ensureDay(s, userId, day);
  const bounds = localDayBounds(day, tz);

  const generated = (await generatedTasksFor(s.db, userId, day)).filter((t) => t.status !== "cancelled");
  const dayBlocks = await s.db
    .select()
    .from(scheduleBlocks)
    .where(and(eq(scheduleBlocks.userId, userId), eq(scheduleBlocks.day, day), eq(scheduleBlocks.kind, "focus")))
    .orderBy(asc(scheduleBlocks.startAt));
  const blockTaskIds = [...new Set(dayBlocks.map((b) => b.taskId).filter((x): x is string => !!x))];

  // The user's own tasks that belong to today: scheduled today, due by today, or recurring today.
  const manual = (
    await s.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.ownerId, userId),
          eq(tasks.source, "manual"),
          ne(tasks.status, "cancelled"),
          or(
            blockTaskIds.length ? inArray(tasks.id, blockTaskIds) : undefined,
            and(lte(tasks.dueAt, new Date(bounds.end)), ne(tasks.status, "completed")),
            and(lte(tasks.dueAt, new Date(bounds.end)), gte(tasks.dueAt, new Date(bounds.start))),
            sql`${tasks.recurrence}->>'type' <> 'none'`,
          ),
        ),
      )
  ).filter((t) => !isRecurring(t.recurrence) || occursOn(t.recurrence, day));

  const all = [...generated, ...manual];
  const ids = all.map((t) => t.id);
  const completions = ids.length
    ? await s.db.select().from(taskCompletions).where(and(inArray(taskCompletions.taskId, ids), isNull(taskCompletions.voidedAt)))
    : [];
  const reviewIds = generated.filter((t) => t.source === "review").map((t) => t.sourceId!);
  const cards = reviewIds.length ? await s.db.select().from(reviews).where(inArray(reviews.id, reviewIds)) : [];

  const items: TodayItem[] = all.map((t) => {
    const recurring = isRecurring(t.recurrence);
    const c = completions.find((x) => x.taskId === t.id && (recurring ? x.occurrenceKey === day : true));
    const block = dayBlocks.find((b) => b.taskId === t.id);
    const card = t.source === "review" ? cards.find((x) => x.id === t.sourceId) : undefined;
    const done = !!c && c.verificationStatus !== "pending" && c.outcome === "completed";
    return {
      taskId: t.id,
      title: t.title,
      url: t.resourceUrl,
      category: t.category ?? (t.verification.provider === "none" ? "other" : t.verification.provider),
      source: t.source,
      label: t.sourceLabel,
      estMinutes: t.estimatedMinutes,
      status: done ? "done" : t.status === "skipped" ? "skipped" : "pending",
      check: t.verification.provider === "none" ? "self" : "submission",
      verifiedBy: done ? (c!.verificationStatus === "verified" ? "submission" : "self") : null,
      completedAt: done ? c!.completedAt.toISOString() : null,
      block: block ? { startAt: block.startAt.toISOString(), endAt: block.endAt.toISOString(), status: block.status } : null,
      review: card ? { cardId: card.id, quality: card.lastReviewedOn === day ? card.lastQuality : null } : null,
      recurring,
      swappable: t.source !== "manual" && !dailySources().find((x) => x.key === t.source)?.fixed && !!t.category,
      dueAt: t.dueAt && t.dueAt.getTime() <= bounds.end ? t.dueAt.toISOString() : null,
    };
  });
  // Items with a time first (in time order), then the all-day ones.
  items.sort((a, b) => (a.block?.startAt ?? "~").localeCompare(b.block?.startAt ?? "~") || (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~"));

  return {
    day,
    items,
    summary: {
      total: items.filter((i) => i.status !== "skipped").length,
      done: items.filter((i) => i.status === "done").length,
      minutesPlanned: items.filter((i) => i.status !== "skipped").reduce((n, i) => n + i.estMinutes, 0),
    },
    deferred: plan.deferred,
  };
}

/**
 * Ticking an item. LeetCode/Codeforces items are only completed when an accepted submission is
 * found (a sync runs first, respecting the cooldown); everything else is self-reported.
 */
export async function checkItem(s: Services, userId: string, taskId: string): Promise<{ status: "done" | "verified" | "not_found_yet" }> {
  const task = await getOwnedTask(s.db, userId, taskId);
  const { day } = await userDay(s, userId);
  const occurrence = isRecurring(task.recurrence) ? { occurrenceDate: day } : {};
  const provider = task.verification.provider;
  if (provider === "none") {
    await completeTask(s, userId, taskId, { outcome: "completed", ...occurrence });
    return { status: "done" };
  }
  const conn = await s.db.query.integrationConnections.findFirst({
    where: and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, provider)),
  });
  if (!conn || conn.status === "disconnected") {
    throw badRequest(`Connect your ${s.platforms.get(provider)?.label ?? provider} handle in Settings so this can be verified`, "not_connected");
  }
  await manualSync(s, userId, provider).catch(() => undefined);
  await verifyTasks(s, userId, provider); // in case the sync was skipped by the cooldown
  const done = await s.db.query.taskCompletions.findFirst({
    where: and(
      eq(taskCompletions.taskId, taskId),
      eq(taskCompletions.verificationStatus, "verified"),
      isNull(taskCompletions.voidedAt),
      isRecurring(task.recurrence) ? eq(taskCompletions.occurrenceKey, day) : undefined,
    ),
  });
  return { status: done ? "verified" : "not_found_yet" };
}

export async function uncheckItem(s: Services, userId: string, taskId: string) {
  const task = await getOwnedTask(s.db, userId, taskId);
  const { day } = await userDay(s, userId);
  return reopenTask(s, userId, taskId, isRecurring(task.recurrence) ? day : undefined);
}

/** Skip for today only. A roadmap item stays first in its queue for the next day. */
export async function skipItem(s: Services, userId: string, taskId: string) {
  const task = await getOwnedTask(s.db, userId, taskId);
  const { day } = await userDay(s, userId);
  return skipTask(s, userId, taskId, isRecurring(task.recurrence) ? day : undefined);
}

async function dayContext(s: Services, userId: string, source: string): Promise<DayContext> {
  const { profile, tz, day } = await userDay(s, userId);
  const todays = (await generatedTasksFor(s.db, userId, day)).filter((t) => t.source === source);
  return { s, db: s.db, userId, day, tz, prefs: preferencesSchema.parse(profile.preferences), todays, after: [] };
}

/** Other work of the same category the learner could do instead (any source). */
export async function swapOptions(s: Services, userId: string, taskId: string) {
  const task = await getOwnedTask(s.db, userId, taskId);
  if (!task.category) return [];
  const out: Array<DailyCandidate & { source: string }> = [];
  for (const src of dailySources()) {
    if (!src.swapOptions) continue;
    const ctx = await dayContext(s, userId, src.key);
    for (const c of await src.swapOptions(ctx, task)) out.push({ ...c, source: src.key });
  }
  return out.filter((o) => !(o.source === task.source && o.sourceId === task.sourceId));
}

/**
 * Replaces a planned item with another one of the same category. The new item takes over the old
 * one's time block and is pinned, so re-planning keeps it; the old item returns to its queue.
 */
export async function swapItem(s: Services, userId: string, taskId: string, pick: { source: string; sourceId: string }) {
  const task = await getOwnedTask(s.db, userId, taskId);
  if (task.status === "completed") throw badRequest("This one is already done");
  if (task.source === "manual" || dailySources().find((x) => x.key === task.source)?.fixed) throw badRequest("This item can't be swapped", "not_swappable");
  const option = (await swapOptions(s, userId, taskId)).find((o) => o.source === pick.source && o.sourceId === pick.sourceId);
  if (!option) throw badRequest("That item can't be swapped in here", "invalid_swap");
  const { day } = await userDay(s, userId);
  const created = await s.db.transaction(async (tx) => {
    await tx.update(tasks).set({ status: "cancelled" }).where(eq(tasks.id, taskId));
    const [row] = await tx
      .insert(tasks)
      .values({
        ownerId: userId,
        createdAt: new Date(s.now()),
        title: option.title,
        estimatedMinutes: option.estMinutes,
        priority: option.priority,
        preferredTime: option.preferredTime,
        splittable: option.estMinutes > 60,
        earliestStartAt: task.earliestStartAt,
        latestFinishAt: task.latestFinishAt,
        recurrence: { type: "none" },
        verification:
          option.platform === "leetcode" && option.problemKey
            ? { provider: "leetcode", mode: "problem", slug: option.problemKey, count: 1, difficulty: "Any" }
            : option.platform === "codeforces" && option.problemKey
              ? { provider: "codeforces", mode: "problem", key: option.problemKey, count: 1 }
              : { provider: "none" },
        resourceUrl: option.url,
        source: pick.source,
        sourceId: pick.sourceId,
        planDay: task.planDay ?? day,
        sourceLabel: option.label,
        category: option.category,
        verifyFrom: option.verifyFrom,
        pinned: true,
        status: "scheduled",
      })
      .onConflictDoUpdate({
        target: [tasks.ownerId, tasks.source, tasks.sourceId, tasks.planDay],
        targetWhere: ne(tasks.source, "manual"),
        set: { status: "scheduled", pinned: true },
      })
      .returning();
    await tx
      .update(scheduleBlocks)
      .set({ taskId: row!.id, title: option.title })
      .where(and(eq(scheduleBlocks.taskId, taskId), eq(scheduleBlocks.status, "planned")));
    return row!;
  });
  if (option.platform) await verifyTasks(s, userId, option.platform);
  return { task: created };
}

/**
 * Gives a day-plan item a time today ("do this at 19:00 for 45 min"). It becomes a locked block,
 * so re-planning never moves it. Without a time, items stay open all day.
 */
export async function setItemTime(s: Services, userId: string, taskId: string, at: { start: string; minutes: number }) {
  const task = await getOwnedTask(s.db, userId, taskId);
  const { tz, day } = await userDay(s, userId);
  await clearItemTime(s, userId, task.id);
  const startMs = localToInstant(task.planDay ?? day, parseHHMM(at.start), tz);
  const block = await createManualBlock(s, userId, { taskId: task.id, startAt: new Date(startMs), endAt: new Date(startMs + at.minutes * 60_000), kind: "focus" });
  return block;
}

/** Back to "any time today". */
export async function clearItemTime(s: Services, userId: string, taskId: string) {
  const task = await getOwnedTask(s.db, userId, taskId);
  await s.db.delete(scheduleBlocks).where(and(eq(scheduleBlocks.taskId, task.id), eq(scheduleBlocks.userId, userId), eq(scheduleBlocks.status, "planned")));
  return { ok: true };
}
