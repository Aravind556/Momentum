import { index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ts } from "../../core/db/columns.js";
import { user } from "../../core/db/core-schema.js";

/**
 * A user's public handle on a coding platform. `platform` is plain text validated against the
 * adapter registry, so adding a platform needs no migration.
 */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    status: text("status", { enum: ["connected", "error", "disconnected"] }).notNull().default("connected"),
    lastSyncAt: ts("last_sync_at"),
    /** Last sync a person asked for; "Sync now" has a short cooldown to protect provider limits. */
    lastManualSyncAt: ts("last_manual_sync_at"),
    lastError: text("last_error"),
    failureCount: integer("failure_count").notNull().default(0),
    nextSyncAfter: ts("next_sync_after"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("integration_user_provider").on(t.userId, t.provider)],
);

/** Accepted submissions (and provider reference data such as LeetCode's daily problem), deduplicated. */
export const externalEvents = pgTable(
  "external_events",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    type: text("type").notNull(),
    occurredAt: ts("occurred_at").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("external_event_unique").on(t.userId, t.provider, t.externalId),
    index("external_events_user_time").on(t.userId, t.occurredAt),
  ],
);
