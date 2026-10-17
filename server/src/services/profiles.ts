import { and, eq, inArray } from "drizzle-orm";
import {
  DEFAULT_PREFERENCES,
  preferencesSchema,
  type AvailabilityInput,
  type AvailabilitySpec,
  type Preferences,
} from "@cadence/shared";
import { randomBytes } from "node:crypto";
import type { DB, Tx } from "../db/index.js";
import { availabilityOverrides, availabilityRules, circleMemberships, integrationConnections, profiles } from "../db/schema.js";
import { conflict, isUniqueViolation } from "../lib/http.js";

export type Profile = typeof profiles.$inferSelect;

/** Default weekday 09:00–21:00, weekends 10:00–18:00 — editable during onboarding or in settings. */
export const DEFAULT_AVAILABILITY: AvailabilityInput = {
  weekly: {
    "1": [{ start: "09:00", end: "21:00" }],
    "2": [{ start: "09:00", end: "21:00" }],
    "3": [{ start: "09:00", end: "21:00" }],
    "4": [{ start: "09:00", end: "21:00" }],
    "5": [{ start: "09:00", end: "21:00" }],
    "6": [{ start: "10:00", end: "18:00" }],
    "7": [{ start: "10:00", end: "18:00" }],
  },
  blocked: [{ start: "13:00", end: "13:45", weekdays: [1, 2, 3, 4, 5, 6, 7], label: "Lunch" }],
  overrides: [],
};

function baseUsername(email: string, name: string): string {
  const raw = (name || email.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9_]/g, "");
  return (raw || "user").slice(0, 16).padEnd(3, "0");
}

export async function getOrCreateProfile(db: DB, u: { id: string; email: string; name: string }): Promise<Profile> {
  const existing = await db.query.profiles.findFirst({ where: eq(profiles.userId, u.id) });
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = attempt === 0 ? "" : `_${randomBytes(2).toString("hex")}`;
    try {
      const [created] = await db
        .insert(profiles)
        .values({
          userId: u.id,
          username: baseUsername(u.email, u.name) + suffix,
          displayName: u.name || u.email.split("@")[0] || "New user",
          preferences: DEFAULT_PREFERENCES,
        })
        .onConflictDoNothing({ target: profiles.userId })
        .returning();
      if (created) {
        await saveAvailability(db, u.id, DEFAULT_AVAILABILITY);
        return created;
      }
      const raced = await db.query.profiles.findFirst({ where: eq(profiles.userId, u.id) });
      if (raced) return raced;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // username taken — retry with a suffix
    }
  }
  throw new Error("Could not allocate a username");
}

export function mergePreferences(current: Preferences, patch: Partial<Preferences>): Preferences {
  return preferencesSchema.parse({
    ...current,
    ...patch,
    notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
    privacy: { ...current.privacy, ...(patch.privacy ?? {}) },
  });
}

export async function updateProfile(
  db: DB,
  userId: string,
  patch: {
    displayName?: string;
    username?: string;
    avatar?: string;
    bio?: string;
    timezone?: string;
    preferences?: Partial<Preferences>;
    completeOnboarding?: boolean;
  },
  now: number,
): Promise<Profile> {
  const current = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!current) throw new Error("Profile missing");
  try {
    const [updated] = await db
      .update(profiles)
      .set({
        displayName: patch.displayName ?? current.displayName,
        username: patch.username ?? current.username,
        avatar: patch.avatar ?? current.avatar,
        bio: patch.bio ?? current.bio,
        timezone: patch.timezone ?? current.timezone,
        preferences: patch.preferences ? mergePreferences(current.preferences, patch.preferences) : current.preferences,
        onboardedAt: patch.completeOnboarding && !current.onboardedAt ? new Date(now) : current.onboardedAt,
      })
      .where(eq(profiles.userId, userId))
      .returning();
    return updated!;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That username is taken", "username_taken");
    throw err;
  }
}

export async function loadAvailability(db: Tx, userId: string): Promise<AvailabilityInput> {
  const rules = await db.select().from(availabilityRules).where(and(eq(availabilityRules.userId, userId), eq(availabilityRules.active, true)));
  const overrides = await db.select().from(availabilityOverrides).where(eq(availabilityOverrides.userId, userId));
  const weekly: AvailabilityInput["weekly"] = {};
  const blocked: AvailabilityInput["blocked"] = [];
  for (const r of rules) {
    if (r.kind === "work") {
      for (const d of r.weekdays) (weekly[String(d)] ??= []).push({ start: r.startTime, end: r.endTime });
    } else {
      blocked.push({ start: r.startTime, end: r.endTime, weekdays: r.weekdays, ...(r.label ? { label: r.label } : {}) });
    }
  }
  for (const k of Object.keys(weekly)) weekly[k]!.sort((a, b) => a.start.localeCompare(b.start));
  return {
    weekly,
    blocked,
    overrides: overrides
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((o) => ({ date: o.date, ...(o.off ? { off: true } : {}), ...(o.windows ? { windows: o.windows } : {}) })),
  };
}

export function toSpec(a: AvailabilityInput): AvailabilitySpec {
  const weekly: AvailabilitySpec["weekly"] = {};
  for (const [k, v] of Object.entries(a.weekly)) weekly[Number(k)] = v;
  return { weekly, blocked: a.blocked, overrides: a.overrides };
}

/** Replaces the user's availability atomically. */
export async function saveAvailability(db: DB, userId: string, a: AvailabilityInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(availabilityRules).where(eq(availabilityRules.userId, userId));
    await tx.delete(availabilityOverrides).where(eq(availabilityOverrides.userId, userId));
    const rows: (typeof availabilityRules.$inferInsert)[] = [];
    for (const [day, ranges] of Object.entries(a.weekly)) {
      for (const r of ranges) rows.push({ userId, kind: "work", weekdays: [Number(day)], startTime: r.start, endTime: r.end });
    }
    for (const b of a.blocked) {
      rows.push({ userId, kind: "blocked", weekdays: b.weekdays, startTime: b.start, endTime: b.end, label: b.label ?? null });
    }
    if (rows.length) await tx.insert(availabilityRules).values(rows);
    const seen = new Set<string>();
    const ovs = a.overrides.filter((o) => !seen.has(o.date) && seen.add(o.date));
    if (ovs.length) {
      await tx
        .insert(availabilityOverrides)
        .values(ovs.map((o) => ({ userId, date: o.date, off: !!o.off, windows: o.windows ?? null })));
    }
  });
}

/** Fields of a profile that other Circle members may see. */
export function publicProfile(p: Profile) {
  return { userId: p.userId, username: p.username, displayName: p.displayName, avatar: p.avatar, bio: p.bio };
}

export async function profileSummary(db: DB, userId: string) {
  const memberships = await db
    .select({ circleId: circleMemberships.circleId, role: circleMemberships.role })
    .from(circleMemberships)
    .where(and(eq(circleMemberships.userId, userId), eq(circleMemberships.status, "active")));
  const connections = await db
    .select({ provider: integrationConnections.provider, status: integrationConnections.status })
    .from(integrationConnections)
    .where(eq(integrationConnections.userId, userId));
  return { memberships, connections };
}

export async function profilesByIds(db: Tx, ids: string[]): Promise<Map<string, Profile>> {
  if (!ids.length) return new Map();
  const rows = await db.select().from(profiles).where(inArray(profiles.userId, ids));
  return new Map(rows.map((r) => [r.userId, r]));
}
