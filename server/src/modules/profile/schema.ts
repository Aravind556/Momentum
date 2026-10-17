import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { Preferences, TimeRange } from "@cadence/shared";
import { createdAt, id, ts, updatedAt } from "../../core/db/columns.js";
import { user } from "../../core/db/core-schema.js";

export const profiles = pgTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatar: text("avatar").notNull().default("🙂"),
  bio: text("bio"),
  timezone: text("timezone").notNull().default("UTC"),
  preferences: jsonb("preferences").$type<Preferences>().notNull(),
  onboardedAt: ts("onboarded_at"),
  /** Incremented on every schedule generation. */
  scheduleVersion: integer("schedule_version").notNull().default(0),
  /** Unscheduled tasks and warnings from the most recent generation. */
  lastScheduleReport: jsonb("last_schedule_report").$type<Record<string, unknown> | null>(),
  /** Last local day the automatic day plan was built for (see planning/daily.ts). */
  lastPlannedDay: text("last_planned_day"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** work = allowed working range; blocked = recurring unavailable range. */
    kind: text("kind", { enum: ["work", "blocked"] }).notNull(),
    weekdays: integer("weekdays").array().notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    label: text("label"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("availability_user_idx").on(t.userId)],
);

export const availabilityOverrides = pgTable(
  "availability_overrides",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    off: boolean("off").notNull().default(false),
    windows: jsonb("windows").$type<TimeRange[]>(),
  },
  (t) => [uniqueIndex("availability_override_unique").on(t.userId, t.date)],
);
