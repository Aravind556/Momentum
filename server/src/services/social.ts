import { and, eq, inArray } from "drizzle-orm";
import type { NotificationCategory } from "@cadence/shared";
import type { Tx } from "../db/index.js";
import { activities, circleMemberships, notifications, profiles } from "../db/schema.js";

export interface ActivityInput {
  type: string;
  data: Record<string, unknown>;
  resourceType?: string;
  resourceId?: string;
  dedupeKey?: string;
}

/**
 * Posts an activity to the given Circles, restricted to Circles where the actor is an active member.
 * Callers decide what is shareable (privacy settings); this never adds private details itself.
 */
export async function publishActivity(db: Tx, actorId: string, circleIds: string[] | "all", a: ActivityInput) {
  const memberships = await db
    .select({ circleId: circleMemberships.circleId })
    .from(circleMemberships)
    .where(and(eq(circleMemberships.userId, actorId), eq(circleMemberships.status, "active")));
  const allowed = memberships.map((m) => m.circleId).filter((id) => circleIds === "all" || circleIds.includes(id));
  if (!allowed.length) return;
  await db
    .insert(activities)
    .values(
      allowed.map((circleId) => ({
        actorId,
        circleId,
        type: a.type,
        data: a.data,
        resourceType: a.resourceType ?? null,
        resourceId: a.resourceId ?? null,
        dedupeKey: a.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing();
}

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
