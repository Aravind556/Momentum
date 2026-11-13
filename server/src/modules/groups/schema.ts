import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { PointsConfig } from "@momentum/shared";
import { createdAt, id, ts } from "../../core/db/columns.js";
import { user } from "../../core/db/core-schema.js";
import { roadmaps } from "../roadmaps/schema.js";

export const groups = pgTable("groups", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** How points are awarded (see shared/points.ts). */
  points: jsonb("points")
    .$type<PointsConfig>()
    .notNull()
    .default(sql`'{"easy":10,"medium":20,"hard":30,"other":10,"bonus":[50,30,10]}'::jsonb`),
  createdAt: createdAt(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    id: id(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
    status: text("status", { enum: ["active", "left", "removed"] }).notNull().default("active"),
    joinedAt: ts("joined_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("group_member_unique").on(t.groupId, t.userId), index("group_member_user_idx").on(t.userId)],
);

export const groupInvites = pgTable("group_invites", {
  id: id(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  maxUses: integer("max_uses").notNull().default(1000),
  uses: integer("uses").notNull().default(0),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

/** A roadmap offered to a group. Members choose for themselves whether to subscribe. */
export const roadmapShares = pgTable(
  "roadmap_shares",
  {
    id: id(),
    roadmapId: text("roadmap_id")
      .notNull()
      .references(() => roadmaps.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    sharedBy: text("shared_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sharedAt: ts("shared_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("roadmap_share_unique").on(t.roadmapId, t.groupId), index("roadmap_share_group_idx").on(t.groupId)],
);

/** Work set for the whole group (a problem, a custom task, or LeetCode's daily problem). */
export const groupTasks = pgTable(
  "group_tasks",
  {
    id: id(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["problem", "custom", "potd"] }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    platform: text("platform"),
    problemKey: text("problem_key"),
    url: text("url"),
    difficulty: text("difficulty"),
    repeat: text("repeat", { enum: ["once", "daily", "weekdays"] }).notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    dueTime: text("due_time").notNull().default("23:59"),
    points: integer("points").notNull(),
    estMinutes: integer("est_minutes").notNull(),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [index("group_tasks_group_idx").on(t.groupId)],
);

/**
 * The points ledger behind the leaderboard: one row per member per completed group-task
 * occurrence or shared-roadmap item. `rank` is the finishing place among members (group tasks).
 */
export const groupPoints = pgTable(
  "group_points",
  {
    id: id(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceType: text("source_type", { enum: ["group_task", "roadmap_item", "assigned_item"] }).notNull(),
    sourceId: text("source_id").notNull(),
    /** Local date for group-task occurrences; "-" for roadmap items (earned once). */
    occurrence: text("occurrence").notNull(),
    completedAt: ts("completed_at").notNull(),
    verifiedBy: text("verified_by", { enum: ["submission", "self"] }).notNull(),
    basePoints: integer("base_points").notNull(),
    rank: integer("rank"),
    points: integer("points").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("group_points_unique").on(t.groupId, t.userId, t.sourceType, t.sourceId, t.occurrence),
    index("group_points_group_time").on(t.groupId, t.completedAt),
  ],
);

/**
 * A roadmap assigned to the whole group by an admin, at one pace for everyone. Each group day the
 * next items become every member's work for that day (see assigned-roadmaps.ts).
 */
export const groupRoadmaps = pgTable(
  "group_roadmaps",
  {
    id: id(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    roadmapId: text("roadmap_id")
      .notNull()
      .references(() => roadmaps.id, { onDelete: "cascade" }),
    assignedBy: text("assigned_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemsPerDay: integer("items_per_day").notNull(),
    /** ISO weekdays (1 = Monday) that are group days. */
    weekdays: jsonb("weekdays").$type<number[]>().notNull(),
    /** First group day (local date). Moved to the resume day when a paused assignment resumes. */
    startDate: text("start_date").notNull(),
    dueTime: text("due_time").notNull().default("23:59"),
    /** Revisions for members who don't follow the roadmap themselves: frequent | decent | rare | off. */
    revision: text("revision").notNull().default("decent"),
    /** Whose calendar defines the group's "day" (the admin's timezone when assigned). */
    timezone: text("timezone").notNull(),
    status: text("status", { enum: ["active", "paused", "ended"] }).notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("group_roadmap_unique").on(t.groupId, t.roadmapId), index("group_roadmaps_roadmap_idx").on(t.roadmapId)],
);

/**
 * Which items each group day got, fixed the first time that day is needed, so later edits to the
 * roadmap never rewrite past days and everyone always sees the same items for a day.
 */
export const groupRoadmapDays = pgTable(
  "group_roadmap_days",
  {
    id: id(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => groupRoadmaps.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    itemIds: jsonb("item_ids").$type<string[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("group_roadmap_day_unique").on(t.assignmentId, t.day)],
);
