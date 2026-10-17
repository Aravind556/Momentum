import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { GoalInput } from "@cadence/shared";
import type { DB } from "../../core/db/index.js";
import { goals, taskCompletions, tasks } from "../../core/db/schema.js";
import { badRequest, notFound } from "../../core/http.js";
import { workedMinutes } from "./tasks.js";

function toRow(input: GoalInput) {
  return {
    title: input.title,
    description: input.description ?? null,
    category: input.category,
    startDate: input.startDate ?? null,
    deadline: input.deadline ?? null,
    targetQuantity: input.targetQuantity ?? null,
    targetUnit: input.targetUnit ?? null,
    recurrence: input.recurrence,
    priority: input.priority,
    progressMethod: input.progressMethod,
  };
}

export async function createGoal(db: DB, userId: string, input: GoalInput) {
  const [row] = await db.insert(goals).values({ ...toRow(input), ownerId: userId }).returning();
  return row!;
}

export async function updateGoal(db: DB, userId: string, goalId: string, input: GoalInput & { status?: "active" | "completed" | "archived" }) {
  const [row] = await db
    .update(goals)
    .set({ ...toRow(input), ...(input.status ? { status: input.status } : {}) })
    .where(and(eq(goals.id, goalId), eq(goals.ownerId, userId)))
    .returning();
  if (!row) throw notFound("Goal");
  return row;
}

/** Archives rather than deletes so linked tasks and history stay intact. */
export async function archiveGoal(db: DB, userId: string, goalId: string) {
  const [row] = await db
    .update(goals)
    .set({ status: "archived" })
    .where(and(eq(goals.id, goalId), eq(goals.ownerId, userId)))
    .returning();
  if (!row) throw notFound("Goal");
  return row;
}

/**
 * Progress per goal, according to its method:
 *  - tasks:    completed tasks / all non-cancelled tasks
 *  - quantity: completions of the goal's tasks / target quantity
 *  - minutes:  recorded work minutes / target minutes
 */
export async function listGoalsWithProgress(db: DB, userId: string, includeArchived = false) {
  const rows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.ownerId, userId), includeArchived ? undefined : ne(goals.status, "archived")))
    .orderBy(desc(goals.priority), desc(goals.createdAt));
  if (!rows.length) return [];
  const goalTasks = await db
    .select({ id: tasks.id, goalId: tasks.goalId, status: tasks.status })
    .from(tasks)
    .where(and(inArray(tasks.goalId, rows.map((g) => g.id)), ne(tasks.status, "cancelled")));
  const taskIds = goalTasks.map((t) => t.id);
  const completions = taskIds.length
    ? await db
        .select({ taskId: taskCompletions.taskId, outcome: taskCompletions.outcome })
        .from(taskCompletions)
        .where(and(inArray(taskCompletions.taskId, taskIds), isNull(taskCompletions.voidedAt)))
    : [];
  const worked = await workedMinutes(db, taskIds);

  return rows.map((g) => {
    const gt = goalTasks.filter((t) => t.goalId === g.id);
    const ids = new Set(gt.map((t) => t.id));
    const doneTasks = gt.filter((t) => t.status === "completed").length;
    const completionCount = completions.filter((c) => ids.has(c.taskId) && c.outcome === "completed").length;
    const minutes = gt.reduce((s, t) => s + (worked.get(t.id) ?? 0), 0);
    let current = 0;
    let target = 0;
    if (g.progressMethod === "tasks") {
      current = doneTasks;
      target = gt.length;
    } else if (g.progressMethod === "quantity") {
      current = completionCount;
      target = g.targetQuantity ?? 0;
    } else {
      current = minutes;
      target = g.targetQuantity ?? 0;
    }
    return {
      ...g,
      progress: { current, target, ratio: target > 0 ? Math.min(1, current / target) : 0, taskCount: gt.length, minutes },
    };
  });
}
