import { boolean, index, integer, jsonb, pgTable, real, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ts, updatedAt } from "../../core/db/columns.js";
import { user } from "../../core/db/core-schema.js";
import { roadmapItems } from "../roadmaps/schema.js";

/**
 * One spaced-repetition card per user and problem. The algorithm's state lives in typed columns
 * for SM-2 (ef, reps, base_interval) plus `state` for other algorithms (e.g. FSRS) later.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: text("item_id").references(() => roadmapItems.id, { onDelete: "set null" }),
    /** Stable identity: "<platform>:<problemKey>" or "item:<itemId>" for non-platform items. */
    subject: text("subject").notNull(),
    category: text("category").notNull(),
    platform: text("platform"),
    problemKey: text("problem_key"),
    title: text("title").notNull(),
    url: text("url"),
    algorithm: text("algorithm").notNull().default("sm2"),
    ef: real("ef").notNull().default(2.5),
    reps: integer("reps").notNull().default(0),
    baseInterval: integer("base_interval").notNull().default(1),
    state: jsonb("state").$type<Record<string, unknown> | null>(),
    /** The learner's revision setting for this card (copied from the follow, kept in sync). */
    multiplier: real("multiplier").notNull().default(1),
    maxPerDay: integer("max_per_day").notNull().default(3),
    /** True while the learner has revisions turned off for the roadmap. */
    suspended: boolean("suspended").notNull().default(false),
    lastReviewedOn: text("last_reviewed_on").notNull(),
    dueDate: text("due_date").notNull(),
    lastQuality: integer("last_quality"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("reviews_user_subject").on(t.userId, t.subject), index("reviews_user_due").on(t.userId, t.dueDate)],
);
