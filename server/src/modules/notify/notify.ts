import { eq, inArray } from "drizzle-orm";
import type { NotificationCategory } from "@cadence/shared";
import type { Tx } from "../../core/db/index.js";
import { notifications, profiles } from "../../core/db/schema.js";

/** Creates an in-app notification unless the category is disabled; deduplicated per user + key. */
export async function notify(
  db: Tx,
  userId: string,
  category: NotificationCategory,
  payload: Record<string, unknown>,
  dedupeKey: string,
) {
  const p = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId), columns: { preferences: true } });
  if (p?.preferences.notifications?.[category] === false) return;
  await db.insert(notifications).values({ userId, type: category, payload, dedupeKey }).onConflictDoNothing();
}

export async function notifyMany(
  db: Tx,
  userIds: string[],
  category: NotificationCategory,
  payload: Record<string, unknown>,
  dedupeKey: string,
) {
  if (!userIds.length) return;
  const rows = await db
    .select({ userId: profiles.userId, preferences: profiles.preferences })
    .from(profiles)
    .where(inArray(profiles.userId, userIds));
  const enabled = rows.filter((r) => r.preferences.notifications?.[category] !== false).map((r) => r.userId);
  if (!enabled.length) return;
  await db
    .insert(notifications)
    .values(enabled.map((userId) => ({ userId, type: category, payload, dedupeKey })))
    .onConflictDoNothing();
}
