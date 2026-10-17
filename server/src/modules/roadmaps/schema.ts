import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { FollowSettings } from "@cadence/shared";
import { createdAt, id, ts, updatedAt } from "../../core/db/columns.js";
import { user } from "../../core/db/core-schema.js";

/**
 * A roadmap is a definition (ordered items) owned by one person. Everyone who follows it —
 * including the owner — has their own settings (roadmap_follows) and progress (item_progress),
 * so one roadmap can be shared and followed at different paces.
 */
export const roadmaps = pgTable(
  "roadmaps",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /** Set when the owner deletes a roadmap others still follow: read-only for them. */
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("roadmaps_owner_idx").on(t.ownerId)],
);

export const roadmapItems = pgTable(
  "roadmap_items",
  {
    id: id(),
    roadmapId: text("roadmap_id")
      .notNull()
      .references(() => roadmaps.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    /** leetcode | codeforces | codechef | other (validated in code, so new platforms need no migration). */
    category: text("category").notNull(),
    /** Set when the item can be auto-verified (platform with an adapter). */
    platform: text("platform"),
    problemKey: text("problem_key"),
    difficulty: text("difficulty"),
    estMinutes: integer("est_minutes").notNull(),
    /** Optional topic heading, e.g. "Graphs". */
    section: text("section"),
    createdAt: createdAt(),
  },
  (t) => [index("roadmap_items_roadmap_idx").on(t.roadmapId, t.position)],
);

export const roadmapFollows = pgTable(
  "roadmap_follows",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roadmapId: text("roadmap_id")
      .notNull()
      .references(() => roadmaps.id, { onDelete: "cascade" }),
    /** The group the roadmap was subscribed through, if any. */
    viaGroupId: text("via_group_id"),
    settings: jsonb("settings").$type<FollowSettings>().notNull(),
    active: boolean("active").notNull().default(true),
    startedAt: ts("started_at").notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roadmap_follow_unique").on(t.userId, t.roadmapId), index("roadmap_follow_roadmap_idx").on(t.roadmapId)],
);

export const itemProgress = pgTable(
  "item_progress",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => roadmapItems.id, { onDelete: "cascade" }),
    /** Items without a row are queued. "active" = currently on someone's day plan. */
    status: text("status", { enum: ["active", "done", "skipped"] }).notNull(),
    doneAt: ts("done_at"),
    verifiedBy: text("verified_by", { enum: ["submission", "self"] }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("item_progress_unique").on(t.userId, t.itemId)],
);
