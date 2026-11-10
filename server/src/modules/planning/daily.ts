import { and, eq, gte, inArray, isNull, lt, lte, ne, notInArray } from "drizzle-orm";
import {
  busyToIntervals,
  computeFreeIntervals,
  computeWorkWindows,
  instantToLocalDate,
  localDayBounds,
  preferencesSchema,
  type VerificationConfig,
} from "@momentum/shared";
import type { Services } from "../../core/context.js";
import type { Tx } from "../../core/db/index.js";
import { profiles, scheduleBlocks, taskCompletions, tasks } from "../../core/db/schema.js";
import { notFound } from "../../core/http.js";
import { verifyTasks } from "../platforms/service.js";
import type { Task } from "../tasks/tasks.js";
import { buildPlanningState, generateUserSchedule } from "./schedules.js";
import { dailySources, type DailyCandidate, type DayContext } from "./sources.js";

const PENDING = ["not_started", "scheduled"] as const;

export interface PlanResult {
  day: string;
  added: number;
  removed: number;
  /** New items the load guard moved to a later day. */
  deferred: number;
  scheduled: boolean;
}

/** Verification for a generated task: the exact problem on its platform, or none. */
function verificationFor(c: Pick<DailyCandidate, "platform" | "problemKey">): VerificationConfig {
  if (c.platform === "leetcode" && c.problemKey) return { provider: "leetcode", mode: "problem", slug: c.problemKey, count: 1, difficulty: "Any" };
  if (c.platform === "codeforces" && c.problemKey) return { provider: "codeforces", mode: "problem", key: c.problemKey, count: 1 };
  return { provider: "none" };
}

/**
 * Builds (or rebuilds) a user's plan for one local day from every registered daily source:
 *  1. roll over earlier days — unfinished generated work is cancelled (its items return to the queue);
 *  2. ask each source what it wants on the day (revisions, new roadmap items, group tasks);
 *  3. load guard — new items beyond the daily study budget move to a later day;
 *  4. diff against what's already planned: add what's missing, remove untouched work that is no
 *     longer wanted (never anything done, started, swapped in or otherwise pinned);
 *  5. place the user's own tasks into free time (if auto-plan is on). Day-plan items stay open
 *     all day — they only get a slot if the learner sets a time.
 * Idempotent: running it twice changes nothing the second time.
 */
export async function ensureDay(s: Services, userId: string, day: string, opts: { forceSchedule?: boolean } = {}): Promise<PlanResult> {
  // Work sources ask to run once the plan is committed (never inside the transaction).
  const after: Array<() => Promise<unknown>> = [];
  const result = await s.db.transaction(async (tx) => {
    // One plan build per user at a time (the profile row is the lock, as for schedule generation).
    const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).for("update");
    if (!profile) throw notFound("Profile");
    const prefs = preferencesSchema.parse(profile.preferences);
    const tz = profile.timezone;

    await rollOver(tx, userId, day);

    const generated = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.ownerId, userId), eq(tasks.planDay, day), ne(tasks.source, "manual")));

    // Ask every source for its full wish list for the day.
    const wanted: Array<{ source: string; c: DailyCandidate }> = [];
    for (const src of dailySources()) {
      const ctx: DayContext = { s, db: tx, userId, day, tz, prefs, todays: generated.filter((t) => t.source === src.key), after };
      for (const c of await src.desired(ctx)) wanted.push({ source: src.key, c });
    }

    // Load guard: due work always stays; new items must fit both the daily study limit and the
    // free time actually left today (availability minus classes, own tasks due today, breaks).
    const doneMinutes = generated.filter((t) => t.status === "completed").reduce((n, t) => n + t.estimatedMinutes, 0);
    let budget = prefs.planning.maxStudyMinutesPerDay - doneMinutes;
    let free = await freeMinutesLeft(tx, userId, day, s.now());
    const gap = prefs.breakMinutes;
    const kept: typeof wanted = [];
    let deferred = 0;
    for (const w of wanted.filter((x) => x.c.kind === "due")) {
      budget -= w.c.estMinutes;
      free -= w.c.estMinutes + gap;
      kept.push(w);
    }
    for (const w of wanted.filter((x) => x.c.kind === "new")) {
      // Work the learner pinned or already started is never pushed out.
      const committed = generated.some(
        (t) => t.source === w.source && t.sourceId === w.c.sourceId && (t.pinned || t.status === "in_progress" || t.status === "partial"),
      );
      if (committed || (w.c.estMinutes <= budget && w.c.estMinutes + gap <= free)) {
        budget -= w.c.estMinutes;
        free -= w.c.estMinutes + gap;
        kept.push(w);
      } else deferred += 1;
    }

    const key = (source: string, id: string | null) => `${source}:${id}`;
    const wantedKeys = new Set(kept.map((w) => key(w.source, w.c.sourceId)));
    const existingKeys = new Set(generated.map((t) => key(t.source, t.sourceId)));

    // Remove untouched pending work that is no longer wanted.
    const completedIds = new Set(
      generated.length
        ? (
            await tx
              .select({ taskId: taskCompletions.taskId })
              .from(taskCompletions)
              .where(and(inArray(taskCompletions.taskId, generated.map((t) => t.id)), isNull(taskCompletions.voidedAt)))
          ).map((r) => r.taskId)
        : [],
    );
    const stale = generated.filter(
      (t) => (PENDING as readonly string[]).includes(t.status) && !t.pinned && !completedIds.has(t.id) && !wantedKeys.has(key(t.source, t.sourceId)),
    );
    if (stale.length) {
      await tx.delete(scheduleBlocks).where(and(inArray(scheduleBlocks.taskId, stale.map((t) => t.id)), eq(scheduleBlocks.status, "planned")));
      await tx.delete(tasks).where(inArray(tasks.id, stale.map((t) => t.id)));
    }

    // Add what's missing.
    const bounds = localDayBounds(day, tz);
    const fresh = kept.filter((w) => !existingKeys.has(key(w.source, w.c.sourceId)));
    if (fresh.length) {
      await tx
        .insert(tasks)
        .values(
          fresh.map(({ source, c }) => ({
            ownerId: userId,
            createdAt: new Date(s.now()),
            title: c.title,
            estimatedMinutes: c.estMinutes,
            priority: c.priority,
            preferredTime: c.preferredTime,
            splittable: c.estMinutes > 60,
            ...(c.estMinutes > 60 ? { minSessionMinutes: 25 } : {}),
            earliestStartAt: new Date(bounds.start),
            latestFinishAt: new Date(bounds.end),
            recurrence: { type: "none" as const },
            verification: c.verification ?? verificationFor(c),
            dueAt: c.dueAt ?? null,
            resourceUrl: c.url,
            source,
            sourceId: c.sourceId,
            planDay: day,
            sourceLabel: c.label,
            category: c.category,
            verifyFrom: c.verifyFrom,
          })),
        )
        .onConflictDoNothing();
    }

    const firstBuild = profile.lastPlannedDay !== day;
    if (firstBuild) await tx.update(profiles).set({ lastPlannedDay: day }).where(eq(profiles.userId, userId));
    return { day, added: fresh.length, removed: stale.length, deferred, firstBuild, autoPlan: prefs.planning.autoPlan, tz };
  });

  for (const fn of after) await fn();
  // Problems already solved since they were picked up are verified straight away (no network).
  if (result.added) {
    for (const p of s.platforms.all()) await verifyTasks(s, userId, p.provider);
  }

  const today = instantToLocalDate(s.now(), result.tz);
  const changed = result.added > 0 || result.removed > 0;
  let scheduled = false;
  if (result.autoPlan && day === today && (changed || result.firstBuild || opts.forceSchedule)) {
    await generateUserSchedule(s, userId, day);
    scheduled = true;
  }
  return { day, added: result.added, removed: result.removed, deferred: result.deferred, scheduled };
}

/**
 * Minutes still free on `day` from now on: working windows minus classes/commitments and blocks
 * that stay put (locked, running, done), minus the user's own tasks due that day.
 */
export async function freeMinutesLeft(db: Tx, userId: string, day: string, now: number): Promise<number> {
  const state = await buildPlanningState(db, userId, day, day, now, { includeTasks: false });
  const windows = computeWorkWindows(state.spec, state.tz, day, day);
  const free = computeFreeIntervals(windows, busyToIntervals(state.input.busy), state.input.notBefore);
  const minutes = free.reduce((n, f) => n + (f.end - f.start) / 60_000, 0);
  const bounds = localDayBounds(day, state.tz);
  const ownDue = await db
    .select({ minutes: tasks.estimatedMinutes })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, userId),
        eq(tasks.source, "manual"),
        notInArray(tasks.status, ["completed", "cancelled", "skipped"]),
        gte(tasks.dueAt, new Date(Math.max(now, bounds.start))),
        lte(tasks.dueAt, new Date(bounds.end)),
      ),
    );
  return Math.max(0, minutes - ownDue.reduce((n, t) => n + t.minutes, 0));
}

/** Unfinished generated work from earlier days is cancelled; its items go back to their queues. */
async function rollOver(tx: Tx, userId: string, day: string) {
  const old = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, userId),
        ne(tasks.source, "manual"),
        lt(tasks.planDay, day),
        notInArray(tasks.status, ["completed", "cancelled", "skipped"]),
      ),
    );
  if (!old.length) return;
  await tx.update(tasks).set({ status: "cancelled" }).where(inArray(tasks.id, old.map((t) => t.id)));
  await tx
    .update(scheduleBlocks)
    .set({ status: "missed" })
    .where(and(inArray(scheduleBlocks.taskId, old.map((t) => t.id)), eq(scheduleBlocks.status, "planned")));
}

/** Today's plan for a user, building it first if needed. */
export async function ensureToday(s: Services, userId: string) {
  const tz = (await s.db.query.profiles.findFirst({ where: eq(profiles.userId, userId), columns: { timezone: true } }))?.timezone ?? "UTC";
  return ensureDay(s, userId, instantToLocalDate(s.now(), tz));
}

/**
 * Re-plans today after something changed (settings, follows, tasks, availability): rebuilds the
 * day's list and re-places the rest of the day. Finished, running, locked and moved blocks stay.
 */
export async function replanToday(s: Services, userId: string): Promise<PlanResult> {
  const tz = (await s.db.query.profiles.findFirst({ where: eq(profiles.userId, userId), columns: { timezone: true } }))?.timezone ?? "UTC";
  return ensureDay(s, userId, instantToLocalDate(s.now(), tz), { forceSchedule: true });
}

/** Generated tasks for a day (helper for sources and the Today view). */
export async function generatedTasksFor(db: Tx, userId: string, day: string): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.ownerId, userId), eq(tasks.planDay, day), ne(tasks.source, "manual")));
}
