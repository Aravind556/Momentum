import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import {
  assertValidSchedule,
  computeWorkWindows,
  generateSchedule as runScheduler,
  instantToLocalDate,
  localDayBounds,
  MINUTE,
  overlaps,
  type AvailabilitySpec,
  type BusyInterval,
  type ScheduleResult,
  type SchedulerInput,
  type SchedulerTask,
  type UnscheduledTask,
  type ScheduleWarning,
} from "@cadence/shared";
import type { DB, Tx } from "../db/index.js";
import { profiles, scheduleBlocks, taskCompletions, tasks } from "../db/schema.js";
import { badRequest, conflict, notFound } from "../lib/http.js";
import type { Services } from "./context.js";
import { expandCommitments, listCommitments, windowMinutes, type FixedOccurrence } from "./commitments.js";
import { loadAvailability, toSpec } from "./profiles.js";
import { isRecurring, occursOn } from "./recurrence.js";
import { dependencyMap, SCHEDULABLE_STATUSES, workedMinutes, type Task } from "./tasks.js";

export type Block = typeof scheduleBlocks.$inferSelect;

const PREFERRED_WINDOWS = {
  morning: { startMinute: 6 * 60, endMinute: 12 * 60 },
  afternoon: { startMinute: 12 * 60, endMinute: 17 * 60 },
  evening: { startMinute: 17 * 60, endMinute: 23 * 60 },
} as const;

const RECURRING_SEP = "@";
const COMMITMENT_PREFIX = "commitment:";

export interface ScheduleReport {
  version: number;
  generatedAt: string;
  startDate: string;
  endDate: string;
  placedBlocks: number;
  unscheduled: Array<UnscheduledTask & { title: string; occurrenceDate?: string }>;
  warnings: ScheduleWarning[];
  availableMinutes: number;
  requestedMinutes: number;
}

/** Marks past planned focus blocks as missed — a missed block is never treated as done. */
export async function markMissedBlocks(db: Tx, userId: string, now: number) {
  await db
    .update(scheduleBlocks)
    .set({ status: "missed" })
    .where(
      and(
        eq(scheduleBlocks.userId, userId),
        eq(scheduleBlocks.status, "planned"),
        eq(scheduleBlocks.kind, "focus"),
        lt(scheduleBlocks.startAt, new Date(now)),
      ),
    );
}

export interface PlanningState {
  tz: string;
  spec: AvailabilitySpec;
  focusMinutes: number;
  breakMinutes: number;
  fixed: FixedOccurrence[];
  input: SchedulerInput;
  /** Blocks that the new plan replaces. */
  replaceIds: string[];
  taskTitles: Map<string, string>;
}

/**
 * Builds the scheduler input for a user and date range from persisted data.
 * Preserves completed, in-progress, locked and past blocks; everything else in range is replaceable.
 */
export async function buildPlanningState(
  db: Tx,
  userId: string,
  startDate: string,
  endDate: string,
  now: number,
  opts: { includeTasks?: boolean; replaceExisting?: boolean } = {},
): Promise<PlanningState> {
  const includeTasks = opts.includeTasks ?? true;
  const replaceExisting = opts.replaceExisting ?? true;
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!profile) throw notFound("Profile");
  const tz = profile.timezone;
  const spec = toSpec(await loadAvailability(db, userId));
  const rangeStart = localDayBounds(startDate, tz).start;
  const rangeEnd = localDayBounds(endDate, tz).end;
  const notBefore = Math.ceil(now / (5 * MINUTE)) * 5 * MINUTE;

  const commitmentRows = await listCommitments(db, userId);
  const { fixed, flexible } = expandCommitments(commitmentRows, tz, startDate, endDate);

  // All blocks that could matter: in range (plus a day of slack for overnight windows) or in the future.
  const blocks = await db
    .select()
    .from(scheduleBlocks)
    .where(and(eq(scheduleBlocks.userId, userId), gte(scheduleBlocks.endAt, new Date(Math.min(rangeStart, now) - 24 * 3600_000))));

  const inRange = (b: Block) => b.day >= startDate && b.day <= endDate;
  const replaceable = (b: Block) =>
    replaceExisting && inRange(b) && b.status === "planned" && !b.locked && b.startAt.getTime() >= now;
  const replaceIds = blocks.filter(replaceable).map((b) => b.id);
  const kept = blocks.filter((b) => !replaceable(b));

  const busy: BusyInterval[] = fixed
    .filter((f) => f.end > rangeStart - 24 * 3600_000 && f.start < rangeEnd + 24 * 3600_000)
    .map((f) => ({ start: f.start, end: f.end, kind: "commitment" as const, label: f.title }));
  for (const b of kept) {
    if (b.endAt.getTime() <= notBefore || b.status === "skipped" || b.status === "missed") continue;
    const kind: BusyInterval["kind"] =
      b.status === "completed" || b.status === "partial"
        ? "completed"
        : b.status === "in_progress"
          ? "in_progress"
          : b.kind === "break"
            ? "break"
            : b.kind === "commitment"
              ? "commitment"
              : "locked";
    busy.push({
      start: b.startAt.getTime(),
      end: b.endAt.getTime(),
      kind,
      label: b.title,
      ...(b.taskId && b.kind === "focus" ? { taskId: b.taskId } : {}),
    });
  }

  const schedulerTasks: SchedulerTask[] = [];
  const taskTitles = new Map<string, string>();
  const groupBudgets: Record<string, number> = {};
  let satisfiedTaskIds: string[] = [];

  if (includeTasks) {
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.ownerId, userId), inArray(tasks.status, SCHEDULABLE_STATUSES)));
    const ids = rows.map((t) => t.id);
    const deps = await dependencyMap(db, ids);
    const worked = await workedMinutes(db, ids);

    const depIds = [...new Set([...deps.values()].flat())];
    if (depIds.length) {
      const depRows = await db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(inArray(tasks.id, depIds));
      satisfiedTaskIds = depRows.filter((d) => d.status === "completed").map((d) => d.id);
    }

    // Minutes already reserved by preserved blocks (locked / in progress / planned outside the range).
    const reserved = new Map<string, number>();
    const reservedEnd = new Map<string, number>();
    for (const b of kept) {
      if (!b.taskId || b.kind !== "focus") continue;
      if (b.status === "skipped" || b.status === "missed") continue;
      const end = b.endAt.getTime();
      reservedEnd.set(b.taskId, Math.max(reservedEnd.get(b.taskId) ?? -Infinity, end));
      if (b.status === "completed" || b.status === "partial") continue; // already in worked minutes
      if (end <= now) continue;
      reserved.set(`${b.taskId}|${b.day}`, (reserved.get(`${b.taskId}|${b.day}`) ?? 0) + (end - b.startAt.getTime()) / MINUTE);
      reserved.set(b.taskId, (reserved.get(b.taskId) ?? 0) + (end - b.startAt.getTime()) / MINUTE);
    }

    const recurringIds = rows.filter((t) => isRecurring(t.recurrence)).map((t) => t.id);
    const recurringDone = new Set<string>();
    if (recurringIds.length) {
      const done = await db
        .select({ taskId: taskCompletions.taskId, key: taskCompletions.occurrenceKey })
        .from(taskCompletions)
        .where(and(inArray(taskCompletions.taskId, recurringIds), isNull(taskCompletions.voidedAt)));
      for (const d of done) recurringDone.add(`${d.taskId}|${d.key}`);
    }

    const base = (t: Task): Omit<SchedulerTask, "id" | "remainingMinutes"> => ({
      title: t.title,
      priority: t.priority,
      splittable: t.splittable,
      ...(t.minSessionMinutes ? { minSessionMinutes: t.minSessionMinutes } : {}),
      ...(t.maxSessionMinutes ? { maxSessionMinutes: t.maxSessionMinutes } : {}),
      ...(t.preferredSessionMinutes ? { preferredSessionMinutes: t.preferredSessionMinutes } : {}),
      ...(t.maxMinutesPerDay ? { maxMinutesPerDay: t.maxMinutesPerDay } : {}),
      ...(t.preferredTime ? { preferredWindow: PREFERRED_WINDOWS[t.preferredTime] } : {}),
      ...(t.timeWindow ? { allowedWindow: windowMinutes(t.timeWindow) } : {}),
      ...(t.groupKey ? { groupId: t.groupKey } : {}),
      order: t.sortOrder,
    });

    for (const t of rows) {
      taskTitles.set(t.id, t.title);
      if (t.groupKey && t.groupDailyMinutes) groupBudgets[t.groupKey] = t.groupDailyMinutes;
      if (isRecurring(t.recurrence)) {
        const firstDay = instantToLocalDate((t.earliestStartAt ?? t.createdAt).getTime(), tz);
        const lastDay = t.latestFinishAt ? instantToLocalDate(t.latestFinishAt.getTime(), tz) : null;
        for (const d of datesBetween(startDate, endDate)) {
          if (d < firstDay || (lastDay && d > lastDay) || !occursOn(t.recurrence, d)) continue;
          if (recurringDone.has(`${t.id}|${d}`)) continue;
          const day = localDayBounds(d, tz);
          const workedToday = (await workedMinutes(db, [t.id], d)).get(t.id) ?? 0;
          const remaining = Math.max(0, t.estimatedMinutes - workedToday - Math.round(reserved.get(`${t.id}|${d}`) ?? 0));
          if (remaining <= 0) continue;
          const id = `${t.id}${RECURRING_SEP}${d}`;
          taskTitles.set(id, t.title);
          schedulerTasks.push({
            ...base(t),
            id,
            remainingMinutes: remaining,
            earliestStart: day.start,
            latestEnd: day.end + 6 * 3600_000, // allow overnight windows of that day
          });
        }
        continue;
      }
      if (t.earliestStartAt && t.earliestStartAt.getTime() >= rangeEnd) continue;
      const remaining = Math.max(
        0,
        t.estimatedMinutes - (worked.get(t.id) ?? 0) - Math.round(reserved.get(t.id) ?? 0),
      );
      schedulerTasks.push({
        ...base(t),
        id: t.id,
        remainingMinutes: remaining,
        ...(t.earliestStartAt ? { earliestStart: t.earliestStartAt.getTime() } : {}),
        ...(t.latestFinishAt ? { latestEnd: t.latestFinishAt.getTime() } : {}),
        ...(t.dueAt ? { deadline: t.dueAt.getTime() } : {}),
        ...(reservedEnd.has(t.id) ? { existingBlocksEnd: reservedEnd.get(t.id)! } : {}),
        dependsOn: (deps.get(t.id) ?? []).filter((d) => !recurringIds.includes(d)),
      });
    }

    // Flexible commitments become movable, indivisible items inside their window.
    for (const f of flexible) {
      if (f.date < startDate || f.date > endDate) continue;
      const already = kept.some((b) => b.commitmentId === f.commitmentId && b.day === f.date && b.status !== "skipped");
      if (already) continue;
      const id = `${COMMITMENT_PREFIX}${f.commitmentId}${RECURRING_SEP}${f.date}`;
      taskTitles.set(id, f.title);
      schedulerTasks.push({
        id,
        title: f.title,
        kind: "commitment",
        remainingMinutes: f.durationMinutes,
        priority: 4,
        splittable: false,
        allowedWindow: windowMinutes(f.window),
        earliestStart: localDayBounds(f.date, tz).start,
        latestEnd: localDayBounds(f.date, tz).end + 6 * 3600_000,
      });
    }
  }

  const input: SchedulerInput = {
    timezone: tz,
    startDate,
    endDate,
    notBefore,
    availability: spec,
    busy,
    tasks: schedulerTasks,
    satisfiedTaskIds,
    preferences: { focusMinutes: profile.preferences.focusMinutes, breakMinutes: profile.preferences.breakMinutes },
    groupBudgets,
  };
  return {
    tz,
    spec,
    focusMinutes: profile.preferences.focusMinutes,
    breakMinutes: profile.preferences.breakMinutes,
    fixed,
    input,
    replaceIds,
    taskTitles,
  };
}

function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = DateTime.fromISO(start); d.toISODate()! <= end; d = d.plus({ days: 1 })) out.push(d.toISODate()!);
  return out;
}

export function splitSchedulerId(id: string): { taskId: string | null; commitmentId: string | null; date?: string } {
  if (id.startsWith(COMMITMENT_PREFIX)) {
    const [cid, date] = id.slice(COMMITMENT_PREFIX.length).split(RECURRING_SEP);
    return { taskId: null, commitmentId: cid!, ...(date ? { date } : {}) };
  }
  const [taskId, date] = id.split(RECURRING_SEP);
  return { taskId: taskId!, commitmentId: null, ...(date ? { date } : {}) };
}

export function toReport(
  result: ScheduleResult,
  titles: Map<string, string>,
  meta: { version: number; startDate: string; endDate: string; now: number },
): ScheduleReport {
  return {
    version: meta.version,
    generatedAt: new Date(meta.now).toISOString(),
    startDate: meta.startDate,
    endDate: meta.endDate,
    placedBlocks: result.blocks.filter((b) => b.kind !== "break").length,
    unscheduled: result.unscheduled.map((u) => {
      const { date } = splitSchedulerId(u.taskId);
      return { ...u, title: titles.get(u.taskId) ?? "Task", ...(date ? { occurrenceDate: date } : {}) };
    }),
    warnings: result.warnings,
    availableMinutes: result.availableMinutes,
    requestedMinutes: result.requestedMinutes,
  };
}

/**
 * Generates (or regenerates) the schedule for a date range. Runs in one transaction with the
 * user's profile row locked, so concurrent generations cannot interleave or double-book.
 */
export async function generateUserSchedule(s: Services, userId: string, startDate: string, endDate = startDate) {
  const now = s.now();
  const profile = await s.db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!profile) throw notFound("Profile");
  const today = instantToLocalDate(now, profile.timezone);
  if (endDate < startDate) throw badRequest("End date must be on or after start date");
  if (endDate < today) throw badRequest("Cannot plan a day that has already passed", "past_date");
  if (DateTime.fromISO(endDate).diff(DateTime.fromISO(startDate), "days").days > 62) {
    throw badRequest("Plan at most 62 days at a time");
  }
  const effectiveStart = startDate < today ? today : startDate;

  return s.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).for("update");
    const version = (locked?.scheduleVersion ?? 0) + 1;
    await markMissedBlocks(tx, userId, now);
    const state = await buildPlanningState(tx, userId, effectiveStart, endDate, now);
    const result = runScheduler(state.input);
    assertValidSchedule(state.input, result);

    if (state.replaceIds.length) await tx.delete(scheduleBlocks).where(inArray(scheduleBlocks.id, state.replaceIds));
    const rows: (typeof scheduleBlocks.$inferInsert)[] = result.blocks.map((b) => {
      const ref = b.taskId ? splitSchedulerId(b.taskId) : { taskId: null, commitmentId: null };
      return {
        userId,
        taskId: ref.taskId,
        commitmentId: ref.commitmentId,
        kind: b.kind,
        title: b.kind === "break" ? "Break" : (state.taskTitles.get(b.taskId!) ?? "Task"),
        startAt: new Date(b.start),
        endAt: new Date(b.end),
        day: b.day,
        source: "auto" as const,
        version,
        segment: b.segment ?? null,
      };
    });
    if (rows.length) await tx.insert(scheduleBlocks).values(rows);

    const scheduledTaskIds = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))];
    if (scheduledTaskIds.length) {
      await tx
        .update(tasks)
        .set({ status: "scheduled" })
        .where(and(inArray(tasks.id, scheduledTaskIds), eq(tasks.status, "not_started")));
    }
    const report = toReport(result, state.taskTitles, { version, startDate: effectiveStart, endDate, now });
    await tx
      .update(profiles)
      .set({ scheduleVersion: version, lastScheduleReport: report as unknown as Record<string, unknown> })
      .where(eq(profiles.userId, userId));
    return report;
  });
}

/** Day/week view: blocks, fixed commitments, working windows and work that still needs a slot. */
export async function getScheduleView(s: Services, userId: string, startDate: string, endDate: string) {
  const now = s.now();
  const profile = await s.db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!profile) throw notFound("Profile");
  await markMissedBlocks(s.db, userId, now);
  const tz = profile.timezone;
  const blocks = await s.db
    .select()
    .from(scheduleBlocks)
    .where(and(eq(scheduleBlocks.userId, userId), gte(scheduleBlocks.day, startDate), lte(scheduleBlocks.day, endDate)))
    .orderBy(asc(scheduleBlocks.startAt));
  const state = await buildPlanningState(s.db, userId, startDate, endDate, now, { replaceExisting: false });
  const windows = computeWorkWindows(state.spec, tz, startDate, endDate);

  // Work still needing a slot = what the scheduler would try to place on top of existing blocks.
  const needs = state.input.tasks.filter((t) => t.remainingMinutes > 0);
  const lastReport = profile.lastScheduleReport as unknown as ScheduleReport | null;
  const reasons = new Map((lastReport?.unscheduled ?? []).map((u) => [u.taskId, u]));
  const unscheduled = needs.map((t) => {
    const ref = splitSchedulerId(t.id);
    const r = reasons.get(t.id);
    return {
      schedulerId: t.id,
      taskId: ref.taskId,
      commitmentId: ref.commitmentId,
      occurrenceDate: ref.date ?? null,
      title: t.title,
      remainingMinutes: t.remainingMinutes,
      priority: t.priority,
      splittable: t.splittable,
      reason: r?.reason ?? null,
      suggestion: r?.suggestion ?? null,
      code: r?.code ?? null,
    };
  });

  return {
    timezone: tz,
    startDate,
    endDate,
    now: new Date(now).toISOString(),
    blocks,
    commitments: state.fixed
      .filter((f) => f.date >= startDate && f.date <= endDate)
      .map((f) => ({ ...f, start: new Date(f.start).toISOString(), end: new Date(f.end).toISOString() })),
    windows: windows.map((w) => ({ day: w.day, start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() })),
    unscheduled,
    lastReport,
  };
}

async function ownedBlock(db: Tx, userId: string, blockId: string): Promise<Block> {
  const b = await db.query.scheduleBlocks.findFirst({ where: and(eq(scheduleBlocks.id, blockId), eq(scheduleBlocks.userId, userId)) });
  if (!b) throw notFound("Schedule block");
  return b;
}

/**
 * Moves/resizes a block manually. Rejects overlaps with fixed commitments and other active blocks;
 * automatic breaks in the way are removed. Manually placed blocks become locked.
 */
export async function moveBlock(s: Services, userId: string, blockId: string, startAt: Date, endAt: Date) {
  if (endAt <= startAt) throw badRequest("End must be after start");
  if (endAt.getTime() - startAt.getTime() > 12 * 3600_000) throw badRequest("A block can be at most 12 hours long");
  return s.db.transaction(async (tx) => {
    const block = await ownedBlock(tx, userId, blockId);
    if (["completed", "partial", "in_progress"].includes(block.status)) {
      throw conflict("Completed or running blocks cannot be moved", "block_immutable");
    }
    const profile = (await tx.query.profiles.findFirst({ where: eq(profiles.userId, userId) }))!;
    const tz = profile.timezone;
    const range = { start: startAt.getTime(), end: endAt.getTime() };
    const day = instantToLocalDate(range.start, tz);

    const { fixed } = expandCommitments(await listCommitments(tx, userId), tz, day, day);
    const hitCommitment = fixed.find((f) => overlaps(f, range));
    if (hitCommitment) throw conflict(`Overlaps "${hitCommitment.title}"`, "overlap_commitment");

    const others = await tx
      .select()
      .from(scheduleBlocks)
      .where(
        and(
          eq(scheduleBlocks.userId, userId),
          ne(scheduleBlocks.id, blockId),
          notInArray(scheduleBlocks.status, ["skipped", "missed"]),
          lt(scheduleBlocks.startAt, endAt),
          sql`${scheduleBlocks.endAt} > ${startAt.toISOString()}`,
        ),
      );
    const blocking = others.filter((o) => !(o.kind === "break" && o.source === "auto" && o.status === "planned"));
    if (blocking.length) throw conflict(`Overlaps "${blocking[0]!.title}"`, "overlap_block");
    const breaksInWay = others.filter((o) => o.kind === "break" && o.source === "auto" && o.status === "planned");
    if (breaksInWay.length) await tx.delete(scheduleBlocks).where(inArray(scheduleBlocks.id, breaksInWay.map((b) => b.id)));

    const windows = computeWorkWindows(toSpec(await loadAvailability(tx, userId)), tz, day, day);
    const inWindow = windows.some((w) => w.start <= range.start && range.end <= w.end);
    const [updated] = await tx
      .update(scheduleBlocks)
      .set({ startAt, endAt, day, locked: true, source: "manual" })
      .where(eq(scheduleBlocks.id, blockId))
      .returning();
    return { block: updated!, warnings: inWindow ? [] : ["outside_working_hours"] };
  });
}

export async function updateBlockState(
  s: Services,
  userId: string,
  blockId: string,
  patch: { locked?: boolean; status?: "planned" | "completed" | "partial" | "skipped" },
) {
  return s.db.transaction(async (tx) => {
    const block = await ownedBlock(tx, userId, blockId);
    const set: Partial<typeof scheduleBlocks.$inferInsert> = {};
    if (patch.locked !== undefined) set.locked = patch.locked;
    if (patch.status) {
      if (block.status === "in_progress") throw conflict("Finish the running focus session first", "session_running");
      set.status = patch.status;
      if ((patch.status === "completed" || patch.status === "partial") && block.actualMinutes === null && block.kind === "focus") {
        const full = Math.round((block.endAt.getTime() - block.startAt.getTime()) / MINUTE);
        set.actualMinutes = patch.status === "completed" ? full : Math.round(full / 2);
      }
      if (patch.status === "planned") set.actualMinutes = null;
    }
    const [updated] = await tx.update(scheduleBlocks).set(set).where(eq(scheduleBlocks.id, blockId)).returning();
    return updated!;
  });
}

export async function createManualBlock(
  s: Services,
  userId: string,
  input: { taskId?: string | null; title?: string; startAt: Date; endAt: Date; kind: "focus" | "break" },
) {
  let title = input.title ?? (input.kind === "break" ? "Break" : "Focus");
  if (input.taskId) {
    const t = await s.db.query.tasks.findFirst({ where: and(eq(tasks.id, input.taskId), eq(tasks.ownerId, userId)) });
    if (!t) throw notFound("Task");
    title = t.title;
  }
  const profile = (await s.db.query.profiles.findFirst({ where: eq(profiles.userId, userId) }))!;
  const [row] = await s.db
    .insert(scheduleBlocks)
    .values({
      userId,
      taskId: input.taskId ?? null,
      kind: input.kind,
      title,
      startAt: input.startAt,
      endAt: input.startAt,
      day: instantToLocalDate(input.startAt.getTime(), profile.timezone),
      locked: true,
      source: "manual",
    })
    .returning();
  // Reuse the overlap checks of moveBlock for the real interval.
  try {
    return await moveBlock(s, userId, row!.id, input.startAt, input.endAt);
  } catch (err) {
    await s.db.delete(scheduleBlocks).where(eq(scheduleBlocks.id, row!.id));
    throw err;
  }
}

export async function deleteBlock(s: Services, userId: string, blockId: string) {
  const block = await ownedBlock(s.db, userId, blockId);
  if (!["planned", "skipped"].includes(block.status)) {
    throw conflict("Blocks with recorded work are kept as history", "block_immutable");
  }
  await s.db.delete(scheduleBlocks).where(eq(scheduleBlocks.id, blockId));
}

/** Skip or extend a break, then regenerate the rest of the day around it. */
export async function adjustBreak(s: Services, userId: string, blockId: string, action: "skip" | "extend", minutes = 5) {
  const now = s.now();
  const block = await ownedBlock(s.db, userId, blockId);
  if (block.kind !== "break") throw badRequest("Only breaks can be skipped or extended");
  if (action === "skip") {
    await s.db.update(scheduleBlocks).set({ status: "skipped" }).where(eq(scheduleBlocks.id, blockId));
  } else {
    const base = Math.max(block.endAt.getTime(), now);
    await s.db
      .update(scheduleBlocks)
      .set({ endAt: new Date(base + minutes * MINUTE), locked: true, source: "manual" })
      .where(eq(scheduleBlocks.id, blockId));
  }
  const today = instantToLocalDate(now, await tzOf(s.db, userId));
  return generateUserSchedule(s, userId, block.day < today ? today : block.day);
}

export async function tzOf(db: DB | Tx, userId: string): Promise<string> {
  const p = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId), columns: { timezone: true } });
  return p?.timezone ?? "UTC";
}
