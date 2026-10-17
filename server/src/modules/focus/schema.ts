import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ts } from "../../core/db/columns.js";
import { user } from "../../core/db/core-schema.js";
import { scheduleBlocks } from "../planning/schema.js";
import { tasks } from "../tasks/schema.js";

export const focusSessions = pgTable(
  "focus_sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    blockId: text("block_id").references(() => scheduleBlocks.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["focus", "break"] }).notNull().default("focus"),
    plannedMinutes: integer("planned_minutes").notNull(),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at"),
    status: text("status", { enum: ["active", "completed", "stopped", "abandoned"] }).notNull().default("active"),
    activeSeconds: integer("active_seconds"),
    pausedSeconds: integer("paused_seconds"),
    note: text("note"),
    taskOutcome: text("task_outcome", { enum: ["none", "completed", "partial"] }),
    createdAt: createdAt(),
  },
  (t) => [
    index("focus_user_started_idx").on(t.userId, t.startedAt),
    uniqueIndex("focus_one_active_per_user").on(t.userId).where(sql`status = 'active'`),
  ],
);

export const focusPauses = pgTable(
  "focus_pauses",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => focusSessions.id, { onDelete: "cascade" }),
    pausedAt: ts("paused_at").notNull(),
    resumedAt: ts("resumed_at"),
  },
  (t) => [index("pauses_session_idx").on(t.sessionId)],
);
