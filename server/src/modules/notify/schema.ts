import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ts } from "../../core/db/columns.js";
import { user } from "../../core/db/core-schema.js";

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe").on(t.userId, t.dedupeKey),
    index("notifications_user_time").on(t.userId, t.createdAt),
  ],
);

/** Every reminder email sent, keyed so the same reminder is never sent twice. */
export const emailLog = pgTable(
  "email_log",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    channel: text("channel").notNull(),
    sentAt: ts("sent_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("email_log_unique").on(t.userId, t.key, t.channel)],
);

/** A browser that agreed to receive push notifications (one row per device/browser). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSentAt: ts("last_sent_at"),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);
