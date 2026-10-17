import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import type { TaskInput, TaskStatus } from "@cadence/shared";
import type { DB, Tx } from "../db/index.js";
import { focusSessions, goals, scheduleBlocks, taskCompletions, taskDependencies, tasks } from "../db/schema.js";
import { badRequest, conflict, notFound } from "../lib/http.js";

export type Task = typeof tasks.$inferSelect;

export const SCHEDULABLE_STATUSES: TaskStatus[] = ["not_started", "scheduled", "in_progress", "partial"];

export async function getOwnedTask(db: Tx, userId: string, taskId: string): Promise<Task> {
  const t = await db.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.ownerId, userId)) });
  if (!t) throw notFound("Task");
  return t;
}

function toRow(input: TaskInput) {
  return {
    title: input.title,
    description: input.description ?? null,
    goalId: input.goalId ?? null,
    challengeId: input.challengeId ?? null,
    estimatedMinutes: input.estimatedMinutes,
    priority: input.priority,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    earliestStartAt: input.earliestStartAt ? new Date(input.earliestStartAt) : null,
    latestFinishAt: input.latestFinishAt ? new Date(input.latestFinishAt) : null,
    timeWindow: input.timeWindow ?? null,
    preferredTime: input.preferredTime ?? null,
    splittable: input.splittable,
    minSessionMinutes: input.minSessionMinutes ?? null,
    maxSessionMinutes: input.maxSessionMinutes ?? null,
    preferredSessionMinutes: input.preferredSessionMinutes ?? null,
    maxMinutesPerDay: input.maxMinutesPerDay ?? null,
    recurrence: input.recurrence,
    verification: input.verification,
    completionCriteria: input.completionCriteria ?? null,
    resourceUrl: input.resourceUrl ?? null,
  };
}

async function assertGoalOwned(db: Tx, userId: string, goalId: string | null | undefined) {
  if (!goalId) return;
  const g = await db.query.goals.findFirst({ where: and(eq(goals.id, goalId), eq(goals.ownerId, userId)) });
  if (!g) throw badRequest("Goal not found", "invalid_goal");
}

/** Validates dependency ids (owned, not self) and rejects cycles. */
async function setDependencies(db: Tx, userId: string, taskId: string, dependsOn: string[]) {
  const unique = [...new Set(dependsOn)].filter((d) => d !== taskId);
  if (dependsOn.includes(taskId)) throw badRequest("A task cannot depend on itself", "invalid_dependency");
  if (unique.length) {
    const owned = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.ownerId, userId), inArray(tasks.id, unique)));
    if (owned.length !== unique.length) throw badRequest("Unknown prerequisite task", "invalid_dependency");
  }
  // Cycle check over the user's dependency graph with the proposed edges.
  const edges = await db
    .select({ taskId: taskDependencies.taskId, dependsOnId: taskDependencies.dependsOnId })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
    .where(eq(tasks.ownerId, userId));
  const graph = new Map<string, string[]>();
  for (const e of edges) if (e.taskId !== taskId) graph.set(e.taskId, [...(graph.get(e.taskId) ?? []), e.dependsOnId]);
  graph.set(taskId, unique);
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (graph.get(from) ?? []).some((n) => reaches(n, target, seen));
  };
  if (unique.some((d) => reaches(d, taskId))) throw badRequest("These dependencies would create a cycle", "dependency_cycle");

  await db.delete(taskDependencies).where(eq(taskDependencies.taskId, taskId));
  if (unique.length) await db.insert(taskDependencies).values(unique.map((d) => ({ taskId, dependsOnId: d })));
}

export async function createTask(db: DB, userId: string, input: TaskInput, extra: Partial<typeof tasks.$inferInsert> = {}) {
  return db.transaction(async (tx) => {
    await assertGoalOwned(tx, userId, input.goalId);
    const [{ maxOrder } = { maxOrder: 0 }] = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${tasks.sortOrder}), 0)` })
      .from(tasks)
      .where(eq(tasks.ownerId, userId));
    const [row] = await tx
      .insert(tasks)
      .values({ ...toRow(input), ownerId: userId, sortOrder: Number(maxOrder) + 1, ...extra })
      .returning();
    await setDependencies(tx, userId, row!.id, input.dependsOn);
    return row!;
  });
}

export async function updateTask(db: DB, userId: string, taskId: string, input: TaskInput, expectedVersion?: number) {
  return db.transaction(async (tx) => {
    const current = await getOwnedTask(tx, userId, taskId);
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw conflict("This task was changed elsewhere. Reload and try again.", "stale_version");
    }
    await assertGoalOwned(tx, userId, input.goalId);
    const [row] = await tx
      .update(tasks)
      .set({ ...toRow(input), version: current.version + 1 })
      .where(and(eq(tasks.id, taskId), eq(tasks.version, current.version)))
      .returning();
    if (!row) throw conflict("This task was changed elsewhere. Reload and try again.", "stale_version");
    await setDependencies(tx, userId, taskId, input.dependsOn);
    return row;
  });
}

export async function setTaskStatus(db: Tx, taskId: string, status: TaskStatus) {
  await db
    .update(tasks)
    .set({ status, version: sql`${tasks.version} + 1` })
    .where(eq(tasks.id, taskId));
}

/**
 * Deletes a task that has no recorded history. Tasks with completions or focus time are archived
 * (status "cancelled") instead so that history is never silently lost. Future planned blocks are removed.
 */
export async function deleteTask(db: DB, userId: string, taskId: string, now: number) {
  return db.transaction(async (tx) => {
    await getOwnedTask(tx, userId, taskId);
    await tx
      .delete(scheduleBlocks)
      .where(and(eq(scheduleBlocks.taskId, taskId), eq(scheduleBlocks.status, "planned"), gt(scheduleBlocks.startAt, new Date(now))));
    const [hasCompletion] = await tx.select({ id: taskCompletions.id }).from(taskCompletions).where(eq(taskCompletions.taskId, taskId)).limit(1);
    const [hasFocus] = await tx.select({ id: focusSessions.id }).from(focusSessions).where(eq(focusSessions.taskId, taskId)).limit(1);
    if (hasCompletion || hasFocus) {
      await setTaskStatus(tx, taskId, "cancelled");
      return { archived: true };
    }
    await tx.delete(tasks).where(eq(tasks.id, taskId));
    return { archived: false };
  });
}

export async function dependencyMap(db: Tx, taskIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!taskIds.length) return map;
  const rows = await db.select().from(taskDependencies).where(inArray(taskDependencies.taskId, taskIds));
  for (const r of rows) map.set(r.taskId, [...(map.get(r.taskId) ?? []), r.dependsOnId]);
  return map;
}

/**
 * Minutes of real work recorded per task: actual minutes of completed/partial blocks plus focus
 * sessions that were not attached to a block. Optionally restricted to one local day.
 */
export async function workedMinutes(db: Tx, taskIds: string[], day?: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!taskIds.length) return out;
  const blockRows = await db
    .select({
      taskId: scheduleBlocks.taskId,
      minutes: sql<number>`coalesce(sum(coalesce(${scheduleBlocks.actualMinutes}, extract(epoch from ${scheduleBlocks.endAt} - ${scheduleBlocks.startAt}) / 60)), 0)`,
    })
    .from(scheduleBlocks)
    .where(
      and(
        inArray(scheduleBlocks.taskId, taskIds),
        inArray(scheduleBlocks.status, ["completed", "partial"]),
        day ? eq(scheduleBlocks.day, day) : undefined,
      ),
    )
    .groupBy(scheduleBlocks.taskId);
  for (const r of blockRows) if (r.taskId) out.set(r.taskId, Math.round(Number(r.minutes)));

  const sessionRows = await db
    .select({ taskId: focusSessions.taskId, seconds: sql<number>`coalesce(sum(${focusSessions.activeSeconds}), 0)` })
    .from(focusSessions)
    .where(
      and(
        inArray(focusSessions.taskId, taskIds),
        isNull(focusSessions.blockId),
        eq(focusSessions.kind, "focus"),
        ne(focusSessions.status, "active"),
      ),
    )
    .groupBy(focusSessions.taskId);
  for (const r of sessionRows) if (r.taskId) out.set(r.taskId, (out.get(r.taskId) ?? 0) + Math.round(Number(r.seconds) / 60));
  return out;
}

export async function listTasks(db: DB, userId: string, opts: { status?: string; goalId?: string; includeArchived?: boolean }) {
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, userId),
        opts.status ? eq(tasks.status, opts.status as TaskStatus) : undefined,
        opts.goalId ? eq(tasks.goalId, opts.goalId) : undefined,
        opts.includeArchived || opts.status ? undefined : ne(tasks.status, "cancelled"),
      ),
    )
    .orderBy(desc(tasks.priority), asc(tasks.sortOrder));
  const ids = rows.map((r) => r.id);
  const [deps, worked, completions] = await Promise.all([
    dependencyMap(db, ids),
    workedMinutes(db, ids),
    ids.length
      ? db
          .select({
            taskId: taskCompletions.taskId,
            occurrenceKey: taskCompletions.occurrenceKey,
            outcome: taskCompletions.outcome,
            verificationStatus: taskCompletions.verificationStatus,
            completedAt: taskCompletions.completedAt,
          })
          .from(taskCompletions)
          .where(and(inArray(taskCompletions.taskId, ids), isNull(taskCompletions.voidedAt)))
          .orderBy(desc(taskCompletions.completedAt))
      : Promise.resolve([]),
  ]);
  const latest = new Map<string, (typeof completions)[number]>();
  for (const c of completions) if (!latest.has(c.taskId)) latest.set(c.taskId, c);
  return rows.map((t) => ({
    ...t,
    dependsOn: deps.get(t.id) ?? [],
    workedMinutes: worked.get(t.id) ?? 0,
    lastCompletion: latest.get(t.id) ?? null,
  }));
}
