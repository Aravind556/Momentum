import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { Recurrence, TaskReminder, TimeRange, VerificationConfig } from "@momentum/shared";
import { createdAt, id, ts, updatedAt } from "../../core/db/columns.js";
import { user } from "../../core/db/core-schema.js";

/** Plain goals group the user's own tasks (projects, assignments, exams). */
export const goals = pgTable(
  "goals",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull().default("other"),
    startDate: text("start_date"),
    deadline: text("deadline"),
    targetQuantity: integer("target_quantity"),
    targetUnit: text("target_unit"),
    recurrence: jsonb("recurrence").$type<Recurrence>().notNull(),
    priority: integer("priority").notNull().default(2),
    progressMethod: text("progress_method", { enum: ["tasks", "quantity", "minutes"] }).notNull().default("tasks"),
    status: text("status", { enum: ["active", "completed", "archived"] }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("goals_owner_idx").on(t.ownerId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    estimatedMinutes: integer("estimated_minutes").notNull(),
    priority: integer("priority").notNull().default(2),
    dueAt: ts("due_at"),
    earliestStartAt: ts("earliest_start_at"),
    latestFinishAt: ts("latest_finish_at"),
    timeWindow: jsonb("time_window").$type<TimeRange | null>(),
    preferredTime: text("preferred_time", { enum: ["morning", "afternoon", "evening"] }),
    splittable: boolean("splittable").notNull().default(false),
    minSessionMinutes: integer("min_session_minutes"),
    maxSessionMinutes: integer("max_session_minutes"),
    preferredSessionMinutes: integer("preferred_session_minutes"),
    maxMinutesPerDay: integer("max_minutes_per_day"),
    recurrence: jsonb("recurrence").$type<Recurrence>().notNull(),
    verification: jsonb("verification").$type<VerificationConfig>().notNull(),
    /** Per-task reminder, sent only while the task is still open (see notify/task-reminders.ts). */
    reminder: jsonb("reminder").$type<TaskReminder | null>(),
    completionCriteria: text("completion_criteria"),
    resourceUrl: text("resource_url"),
    status: text("status", {
      enum: ["not_started", "scheduled", "in_progress", "completed", "partial", "skipped", "cancelled"],
    })
      .notNull()
      .default("not_started"),
    /** Tasks sharing a group share a daily minute budget. */
    groupKey: text("group_key"),
    groupDailyMinutes: integer("group_daily_minutes"),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Where the task came from: written by the user ("manual") or generated for a day plan from a
     * roadmap item, a revision, or a group task. Generated tasks carry `sourceId` and `planDay`.
     */
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
    planDay: text("plan_day"),
    /** Shown on the day plan: roadmap title, "Revision", or group name. */
    sourceLabel: text("source_label"),
    /** leetcode | codeforces | codechef | other — groups the day's list and limits swaps. */
    category: text("category"),
    /** The user picked this one (e.g. swapped it in): automatic re-planning never removes it. */
    pinned: boolean("pinned").notNull().default(false),
    /** Accepted submissions only count from this moment (defaults to when the task opened). */
    verifyFrom: ts("verify_from"),
    /** Optimistic-concurrency counter. */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_owner_status_idx").on(t.ownerId, t.status),
    index("tasks_goal_idx").on(t.goalId),
    index("tasks_owner_plan_day_idx").on(t.ownerId, t.planDay),
    uniqueIndex("tasks_generated_unique").on(t.ownerId, t.source, t.sourceId, t.planDay).where(sql`source <> 'manual'`),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnId: text("depends_on_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnId] })],
);

export const taskCompletions = pgTable(
  "task_completions",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "once" for one-off tasks, or the local date for recurring occurrences. */
    occurrenceKey: text("occurrence_key").notNull(),
    /** Local date of completion (user timezone) for analytics. */
    day: text("day").notNull(),
    completedAt: ts("completed_at").notNull().defaultNow(),
    outcome: text("outcome", { enum: ["completed", "partial"] }).notNull(),
    method: text("method", { enum: ["manual", "integration", "evidence"] }).notNull(),
    verificationStatus: text("verification_status", {
      enum: ["verified", "manual", "evidence", "pending", "unavailable", "failed"],
    }).notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown> | null>(),
    note: text("note"),
    voidedAt: ts("voided_at"),
  },
  (t) => [
    uniqueIndex("completion_unique_active").on(t.taskId, t.occurrenceKey).where(sql`voided_at is null`),
    index("completions_user_day_idx").on(t.userId, t.day),
  ],
);
