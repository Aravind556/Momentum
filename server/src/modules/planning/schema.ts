import { boolean, index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import type { Recurrence, TimeRange } from "@cadence/shared";
import { createdAt, id, ts, updatedAt } from "../../core/db/columns.js";
import { user } from "../../core/db/core-schema.js";
import { tasks } from "../tasks/schema.js";

/** Classes, meetings and other commitments the schedule works around. */
export const commitments = pgTable(
  "commitments",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    flexible: boolean("flexible").notNull().default(false),
    startAt: ts("start_at"),
    endAt: ts("end_at"),
    date: text("date"),
    window: jsonb("window").$type<TimeRange>(),
    durationMinutes: integer("duration_minutes"),
    recurrence: jsonb("recurrence").$type<Recurrence>().notNull(),
    until: text("until"),
    createdAt: createdAt(),
  },
  (t) => [index("commitments_user_idx").on(t.userId)],
);

export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    commitmentId: text("commitment_id").references(() => commitments.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["focus", "break", "commitment"] }).notNull(),
    /** Snapshot so history survives task deletion. */
    title: text("title").notNull(),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    /** Local working day (user timezone) this block belongs to. */
    day: text("day").notNull(),
    status: text("status", { enum: ["planned", "in_progress", "completed", "partial", "skipped", "missed"] })
      .notNull()
      .default("planned"),
    locked: boolean("locked").notNull().default(false),
    source: text("source", { enum: ["auto", "manual"] }).notNull().default("auto"),
    version: integer("version").notNull().default(0),
    segment: integer("segment"),
    /** Minutes of real work recorded against this block. */
    actualMinutes: integer("actual_minutes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("blocks_user_start_idx").on(t.userId, t.startAt),
    index("blocks_user_day_idx").on(t.userId, t.day),
    index("blocks_task_idx").on(t.taskId),
  ],
);
