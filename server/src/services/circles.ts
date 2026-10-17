import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { addDays, instantToLocalDate, scoreMember, type RankingMode } from "@cadence/shared";
import type { DB, Tx } from "../db/index.js";
import {
  activities,
  activityComments,
  activityReactions,
  challenges,
  circleInvitations,
  circleMemberships,
  circles,
  focusSessions,
  goals,
  profiles,
} from "../db/schema.js";
import { inviteCode } from "../lib/crypto.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";
import type { Services } from "./context.js";
import { computeStreak, memberStats } from "./analytics.js";
import { challengeProgressFor, challengeStatus } from "./challenges.js";
import { publicProfile, profilesByIds } from "./profiles.js";
import { notifyMany, publishActivity } from "./social.js";
import { tzOf } from "./schedules.js";

export type Membership = typeof circleMemberships.$inferSelect;

export async function isActiveMember(db: Tx, circleId: string, userId: string): Promise<boolean> {
  const m = await db.query.circleMemberships.findFirst({
    where: and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.userId, userId), eq(circleMemberships.status, "active")),
  });
  return !!m;
}

/** Server-side authorization for everything inside a Circle. Non-members get 404 (no existence leak). */
export async function requireMember(db: Tx, circleId: string, userId: string): Promise<Membership> {
  const m = await db.query.circleMemberships.findFirst({
    where: and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.userId, userId), eq(circleMemberships.status, "active")),
  });
  if (!m) throw notFound("Circle");
  return m;
}

async function requireAdmin(db: Tx, circleId: string, userId: string) {
  const m = await requireMember(db, circleId, userId);
  if (m.role === "member") throw forbidden("Only the Circle owner or admins can do this");
  return m;
}

export async function createCircle(s: Services, userId: string, input: { name: string; description?: string | null; rankingMode: RankingMode }) {
  return s.db.transaction(async (tx) => {
    const [c] = await tx
      .insert(circles)
      .values({ name: input.name, description: input.description ?? null, ownerId: userId, settings: { rankingMode: input.rankingMode } })
      .returning();
    await tx.insert(circleMemberships).values({ circleId: c!.id, userId, role: "owner" });
    return c!;
  });
}

export async function listMyCircles(s: Services, userId: string) {
  const rows = await s.db
    .select({ circle: circles, role: circleMemberships.role })
    .from(circleMemberships)
    .innerJoin(circles, eq(circles.id, circleMemberships.circleId))
    .where(and(eq(circleMemberships.userId, userId), eq(circleMemberships.status, "active")))
    .orderBy(asc(circles.name));
  if (!rows.length) return [];
  const counts = await s.db
    .select({ circleId: circleMemberships.circleId, n: sql<number>`count(*)` })
    .from(circleMemberships)
    .where(and(inArray(circleMemberships.circleId, rows.map((r) => r.circle.id)), eq(circleMemberships.status, "active")))
    .groupBy(circleMemberships.circleId);
  const countMap = new Map(counts.map((c) => [c.circleId, Number(c.n)]));
  return rows.map((r) => ({ ...r.circle, role: r.role, memberCount: countMap.get(r.circle.id) ?? 0 }));
}

export async function updateCircle(
  s: Services,
  userId: string,
  circleId: string,
  patch: { name?: string; description?: string | null; rankingMode?: RankingMode },
) {
  await requireAdmin(s.db, circleId, userId);
  const current = (await s.db.query.circles.findFirst({ where: eq(circles.id, circleId) }))!;
  const [row] = await s.db
    .update(circles)
    .set({
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      settings: { ...current.settings, ...(patch.rankingMode ? { rankingMode: patch.rankingMode } : {}) },
    })
    .where(eq(circles.id, circleId))
    .returning();
  return row!;
}

export async function deleteCircle(s: Services, userId: string, circleId: string) {
  const m = await requireMember(s.db, circleId, userId);
  if (m.role !== "owner") throw forbidden("Only the owner can delete a Circle");
  await s.db.delete(circles).where(eq(circles.id, circleId));
}

export async function createInvitation(s: Services, userId: string, circleId: string, opts: { days?: number; maxUses?: number }) {
  await requireMember(s.db, circleId, userId);
  const days = Math.min(Math.max(opts.days ?? 7, 1), 30);
  const maxUses = Math.min(Math.max(opts.maxUses ?? 10, 1), 100);
  const [inv] = await s.db
    .insert(circleInvitations)
    .values({ circleId, inviterId: userId, code: inviteCode(), expiresAt: new Date(s.now() + days * 86_400_000), maxUses })
    .returning();
  return inv!;
}

export async function listInvitations(s: Services, userId: string, circleId: string) {
  await requireMember(s.db, circleId, userId);
  return s.db
    .select()
    .from(circleInvitations)
    .where(and(eq(circleInvitations.circleId, circleId), sql`${circleInvitations.revokedAt} is null`, gte(circleInvitations.expiresAt, new Date(s.now()))))
    .orderBy(desc(circleInvitations.createdAt));
}

export async function revokeInvitation(s: Services, userId: string, invitationId: string) {
  const inv = await s.db.query.circleInvitations.findFirst({ where: eq(circleInvitations.id, invitationId) });
  if (!inv) throw notFound("Invitation");
  const m = await requireMember(s.db, inv.circleId, userId);
  if (inv.inviterId !== userId && m.role === "member") throw forbidden("Only the inviter or an admin can revoke this");
  await s.db.update(circleInvitations).set({ revokedAt: new Date(s.now()) }).where(eq(circleInvitations.id, invitationId));
}

/** Public preview of an invitation code: only the Circle name and member count. */
export async function previewInvitation(s: Services, code: string) {
  const inv = await s.db.query.circleInvitations.findFirst({ where: eq(circleInvitations.code, code.toUpperCase()) });
  if (!inv || inv.revokedAt || inv.expiresAt.getTime() < s.now() || inv.uses >= inv.maxUses) {
    throw notFound("Invitation");
  }
  const c = (await s.db.query.circles.findFirst({ where: eq(circles.id, inv.circleId) }))!;
  const [{ n } = { n: 0 }] = await s.db
    .select({ n: sql<number>`count(*)` })
    .from(circleMemberships)
    .where(and(eq(circleMemberships.circleId, c.id), eq(circleMemberships.status, "active")));
  return { circleId: c.id, name: c.name, description: c.description, memberCount: Number(n) };
}

/** Validates and redeems an invitation atomically (row lock prevents over-use under concurrency). */
export async function acceptInvitation(s: Services, userId: string, code: string) {
  const now = s.now();
  return s.db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(circleInvitations)
      .where(eq(circleInvitations.code, code.trim().toUpperCase()))
      .for("update");
    if (!inv || inv.revokedAt) throw notFound("Invitation");
    if (inv.expiresAt.getTime() < now) throw badRequest("This invitation has expired", "invite_expired");
    if (inv.uses >= inv.maxUses) throw badRequest("This invitation has been used up", "invite_exhausted");

    const existing = await tx.query.circleMemberships.findFirst({
      where: and(eq(circleMemberships.circleId, inv.circleId), eq(circleMemberships.userId, userId)),
    });
    if (existing?.status === "active") return { circleId: inv.circleId, alreadyMember: true };
    if (existing?.status === "removed") throw forbidden("You were removed from this Circle. Ask an admin to re-add you.");
    if (existing) {
      await tx
        .update(circleMemberships)
        .set({ status: "active", role: "member", joinedAt: new Date(now) })
        .where(eq(circleMemberships.id, existing.id));
    } else {
      await tx.insert(circleMemberships).values({ circleId: inv.circleId, userId, role: "member" });
    }
    await tx.update(circleInvitations).set({ uses: inv.uses + 1 }).where(eq(circleInvitations.id, inv.id));

    const profile = await tx.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
    await publishActivity(tx, userId, [inv.circleId], {
      type: "member_joined",
      data: {},
      dedupeKey: `joined:${userId}:${now}`,
    });
    const admins = await tx
      .select({ userId: circleMemberships.userId })
      .from(circleMemberships)
      .where(and(eq(circleMemberships.circleId, inv.circleId), eq(circleMemberships.status, "active"), or(eq(circleMemberships.role, "owner"), eq(circleMemberships.role, "admin"))));
    await notifyMany(
      tx,
      admins.map((a) => a.userId).filter((id) => id !== userId),
      "circle",
      { message: `${profile?.displayName ?? "Someone"} joined your Circle`, circleId: inv.circleId },
      `joined:${inv.circleId}:${userId}:${now}`,
    );
    return { circleId: inv.circleId, alreadyMember: false };
  });
}

/** Leaving keeps history. An owner hands ownership to the longest-standing admin or member; a last member deletes the Circle. */
export async function leaveCircle(s: Services, userId: string, circleId: string) {
  return s.db.transaction(async (tx) => {
    const m = await requireMember(tx, circleId, userId);
    if (m.role === "owner") {
      const [successor] = await tx
        .select()
        .from(circleMemberships)
        .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.status, "active"), sql`${circleMemberships.userId} <> ${userId}`))
        .orderBy(sql`case ${circleMemberships.role} when 'admin' then 0 else 1 end`, asc(circleMemberships.joinedAt))
        .limit(1);
      if (!successor) {
        await tx.delete(circles).where(eq(circles.id, circleId));
        return { deleted: true };
      }
      await tx.update(circleMemberships).set({ role: "owner" }).where(eq(circleMemberships.id, successor.id));
      await tx.update(circles).set({ ownerId: successor.userId }).where(eq(circles.id, circleId));
    }
    await tx.update(circleMemberships).set({ status: "left", role: "member" }).where(eq(circleMemberships.id, m.id));
    return { deleted: false };
  });
}

export async function removeMember(s: Services, actorId: string, circleId: string, targetUserId: string) {
  return s.db.transaction(async (tx) => {
    const actor = await requireAdmin(tx, circleId, actorId);
    if (actorId === targetUserId) throw badRequest("Use 'leave' to leave a Circle");
    const target = await requireMember(tx, circleId, targetUserId).catch(() => {
      throw notFound("Member");
    });
    if (target.role === "owner") throw forbidden("The owner cannot be removed");
    if (target.role === "admin" && actor.role !== "owner") throw forbidden("Only the owner can remove an admin");
    await tx.update(circleMemberships).set({ status: "removed" }).where(eq(circleMemberships.id, target.id));
    return { ok: true };
  });
}

export async function setMemberRole(s: Services, actorId: string, circleId: string, targetUserId: string, role: "admin" | "member") {
  const actor = await requireMember(s.db, circleId, actorId);
  if (actor.role !== "owner") throw forbidden("Only the owner can change roles");
  const target = await requireMember(s.db, circleId, targetUserId);
  if (target.role === "owner") throw badRequest("The owner's role cannot be changed");
  await s.db.update(circleMemberships).set({ role }).where(eq(circleMemberships.id, target.id));
  return { ok: true };
}

function periodRange(period: "week" | "month", today: string) {
  const days = period === "week" ? 7 : 30;
  return { startDate: addDays(today, -(days - 1)), endDate: today, days };
}

/**
 * Leaderboard built from count-only statistics. Members who opted out of leaderboards are listed
 * as hidden. Each row carries the score breakdown so members can see why a score changed.
 */
export async function leaderboard(s: Services, userId: string, circleId: string, opts: { period?: "week" | "month"; mode?: RankingMode }) {
  await requireMember(s.db, circleId, userId);
  const circle = (await s.db.query.circles.findFirst({ where: eq(circles.id, circleId) }))!;
  const mode = opts.mode ?? circle.settings.rankingMode;
  const now = s.now();
  const tz = await tzOf(s.db, userId);
  const today = instantToLocalDate(now, tz);
  const { startDate, endDate, days } = periodRange(opts.period ?? "week", today);

  const members = await s.db
    .select()
    .from(circleMemberships)
    .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.status, "active")));
  const ids = members.map((m) => m.userId);
  const profs = await profilesByIds(s.db, ids);
  const visible = ids.filter((id) => profs.get(id)?.preferences.privacy.showOnLeaderboard !== false);
  const stats = await memberStats(s.db, visible, startDate, endDate, tz, now);

  // Challenge progress: average completion ratio across this Circle's active challenges with targets.
  const active = (await s.db.select().from(challenges).where(eq(challenges.circleId, circleId))).filter(
    (c) => challengeStatus(c, today) === "active" && c.individualTarget,
  );
  for (const c of active) {
    const p = await challengeProgressFor(s.db, c, visible);
    for (const id of visible) stats.get(id)!.challengeProgress += Math.min(1, (p.get(id) ?? 0) / c.individualTarget!) / active.length;
  }

  const maxCompletions = Math.max(0, ...[...stats.values()].map((x) => x.completions));
  const rows = visible
    .map((id) => {
      const st = stats.get(id)!;
      const score = scoreMember(mode, st, { periodDays: days, maxCompletions });
      return {
        user: publicProfile(profs.get(id)!),
        score: score.score,
        breakdown: score.parts,
        stats: {
          completions: st.completions,
          verifiedCompletions: st.verifiedCompletions,
          activeDays: st.activeDays,
          focusMinutes: st.focusMinutes,
          plannedSessions: st.plannedOccurrences,
          completedSessions: st.completedOccurrences,
        },
      };
    })
    .sort((a, b) => b.score - a.score || b.stats.activeDays - a.stats.activeDays);
  let rank = 0;
  let prevScore: number | null = null;
  const ranked = rows.map((r, i) => {
    if (r.score !== prevScore) rank = i + 1;
    prevScore = r.score;
    return { rank, ...r };
  });
  return {
    mode,
    period: opts.period ?? "week",
    startDate,
    endDate,
    rows: ranked,
    hiddenCount: ids.length - visible.length,
    explanation: MODE_EXPLANATIONS[mode],
  };
}

const MODE_EXPLANATIONS: Record<RankingMode, string> = {
  consistency:
    "Share of scheduled focus sessions that were completed (partial = ½). Days with nothing scheduled are not counted.",
  volume: "Number of completed tasks. Task sizes differ between members, so compare with care.",
  challenge: "Average progress toward the individual targets of this Circle's active challenges.",
  balanced: "50% consistency + 30% completed tasks relative to the top member + 20% active days.",
};

export async function circleDashboard(s: Services, userId: string, circleId: string) {
  const me = await requireMember(s.db, circleId, userId);
  const circle = (await s.db.query.circles.findFirst({ where: eq(circles.id, circleId) }))!;
  const now = s.now();
  const tz = await tzOf(s.db, userId);
  const today = instantToLocalDate(now, tz);

  const members = await s.db
    .select()
    .from(circleMemberships)
    .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.status, "active")))
    .orderBy(asc(circleMemberships.joinedAt));
  const ids = members.map((m) => m.userId);
  const profs = await profilesByIds(s.db, ids);
  const todayStats = await memberStats(s.db, ids, today, today, tz, now);
  const weekStart = addDays(today, -6);
  const weekStats = await memberStats(s.db, ids, weekStart, today, tz, now);
  const focusing = await s.db
    .select({ userId: focusSessions.userId })
    .from(focusSessions)
    .where(and(inArray(focusSessions.userId, ids), eq(focusSessions.status, "active"), eq(focusSessions.kind, "focus")));
  const focusingSet = new Set(focusing.map((f) => f.userId));

  const memberRows = [];
  for (const m of members) {
    const p = profs.get(m.userId)!;
    const privacy = p.preferences.privacy;
    const t = todayStats.get(m.userId)!;
    const streak = privacy.shareStreaks ? (await computeStreak(s.db, m.userId, p.timezone, now)).current : null;
    memberRows.push({
      ...publicProfile(p),
      role: m.role,
      joinedAt: m.joinedAt,
      streak,
      // Today's progress is count-only; no task titles or times are exposed.
      today: privacy.showOnLeaderboard
        ? { completedSessions: t.completedOccurrences, plannedSessions: t.plannedOccurrences, completions: t.completions }
        : null,
      focusingNow: privacy.shareFocusPresence ? focusingSet.has(m.userId) : null,
    });
  }

  const challengeRows = (await s.db.select().from(challenges).where(eq(challenges.circleId, circleId)).orderBy(asc(challenges.endDate)))
    .map((c) => ({ ...c, status: challengeStatus(c, today) }))
    .filter((c) => c.status !== "completed");

  const sharedGoals = await s.db
    .select({ id: goals.id, title: goals.title, deadline: goals.deadline, ownerId: goals.ownerId })
    .from(goals)
    .where(and(eq(goals.circleId, circleId), eq(goals.visibility, "circle"), eq(goals.status, "active")));
  const deadlines = [
    ...challengeRows.map((c) => ({ kind: "challenge" as const, id: c.id, title: c.title, date: c.endDate })),
    ...sharedGoals
      .filter((g) => g.deadline && g.deadline >= today)
      .map((g) => ({
        kind: "goal" as const,
        id: g.id,
        title: g.title,
        date: g.deadline!,
        owner: profs.get(g.ownerId)?.displayName ?? null,
      })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);

  const week = [...weekStats.entries()].filter(([id]) => profs.get(id)?.preferences.privacy.showOnLeaderboard !== false);
  const weekly = week.reduce(
    (a, [, st]) => ({
      plannedSessions: a.plannedSessions + st.plannedOccurrences,
      completedSessions: a.completedSessions + st.completedOccurrences,
      completions: a.completions + st.completions,
      focusMinutes: a.focusMinutes + st.focusMinutes,
    }),
    { plannedSessions: 0, completedSessions: 0, completions: 0, focusMinutes: 0 },
  );

  return {
    circle: { ...circle, myRole: me.role },
    members: memberRows,
    challenges: challengeRows,
    deadlines,
    weekly: { ...weekly, startDate: weekStart, endDate: today },
  };
}

export async function listActivities(s: Services, userId: string, circleId: string, cursor?: string, limit = 20) {
  await requireMember(s.db, circleId, userId);
  const take = Math.min(Math.max(limit, 1), 50);
  let cursorCond;
  if (cursor) {
    const [ts, id] = Buffer.from(cursor, "base64url").toString().split("|");
    if (!ts || !id) throw badRequest("Invalid cursor");
    cursorCond = or(lt(activities.createdAt, new Date(ts)), and(eq(activities.createdAt, new Date(ts)), lt(activities.id, id)));
  }
  const rows = await s.db
    .select()
    .from(activities)
    .where(and(eq(activities.circleId, circleId), cursorCond))
    .orderBy(desc(activities.createdAt), desc(activities.id))
    .limit(take + 1);
  const page = rows.slice(0, take);
  const ids = page.map((r) => r.id);
  const reactions = ids.length ? await s.db.select().from(activityReactions).where(inArray(activityReactions.activityId, ids)) : [];
  const comments = ids.length
    ? await s.db.select().from(activityComments).where(inArray(activityComments.activityId, ids)).orderBy(asc(activityComments.createdAt))
    : [];
  const people = await profilesByIds(s.db, [...new Set([...page.map((r) => r.actorId), ...comments.map((c) => c.userId)])]);
  const last = page[page.length - 1];
  return {
    items: page.map((a) => {
      const mine = reactions.filter((r) => r.activityId === a.id);
      const grouped = new Map<string, { emoji: string; count: number; reacted: boolean }>();
      for (const r of mine) {
        const g = grouped.get(r.emoji) ?? { emoji: r.emoji, count: 0, reacted: false };
        g.count += 1;
        if (r.userId === userId) g.reacted = true;
        grouped.set(r.emoji, g);
      }
      const actor = people.get(a.actorId);
      return {
        id: a.id,
        type: a.type,
        data: a.data,
        createdAt: a.createdAt,
        actor: actor ? publicProfile(actor) : null,
        reactions: [...grouped.values()],
        comments: comments
          .filter((c) => c.activityId === a.id)
          .map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, author: people.get(c.userId) ? publicProfile(people.get(c.userId)!) : null })),
      };
    }),
    nextCursor: rows.length > take && last ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString("base64url") : null,
  };
}

async function activityForMember(db: DB, userId: string, activityId: string) {
  const a = await db.query.activities.findFirst({ where: eq(activities.id, activityId) });
  if (!a) throw notFound("Activity");
  await requireMember(db, a.circleId, userId);
  return a;
}

const ALLOWED_REACTIONS = ["👏", "🔥", "💪", "🎉", "❤️"];

export async function toggleReaction(s: Services, userId: string, activityId: string, emoji: string) {
  if (!ALLOWED_REACTIONS.includes(emoji)) throw badRequest("Unsupported reaction");
  await activityForMember(s.db, userId, activityId);
  const existing = await s.db.query.activityReactions.findFirst({
    where: and(eq(activityReactions.activityId, activityId), eq(activityReactions.userId, userId), eq(activityReactions.emoji, emoji)),
  });
  if (existing) {
    await s.db.delete(activityReactions).where(eq(activityReactions.id, existing.id));
    return { reacted: false };
  }
  await s.db.insert(activityReactions).values({ activityId, userId, emoji }).onConflictDoNothing();
  return { reacted: true };
}

export async function addComment(s: Services, userId: string, activityId: string, body: string) {
  const text = body.trim();
  if (!text || text.length > 500) throw badRequest("Comments must be 1–500 characters");
  await activityForMember(s.db, userId, activityId);
  const [c] = await s.db.insert(activityComments).values({ activityId, userId, body: text }).returning();
  return c!;
}

export async function deleteComment(s: Services, userId: string, commentId: string) {
  const c = await s.db.query.activityComments.findFirst({ where: eq(activityComments.id, commentId) });
  if (!c || c.userId !== userId) throw notFound("Comment");
  await s.db.delete(activityComments).where(eq(activityComments.id, commentId));
}

/** Members can publish a count-only weekly recap to a Circle by choice. */
export async function shareWeeklyRecap(s: Services, userId: string, circleId: string, recap: { completedSessions: number; plannedSessions: number; focusMinutes: number; completions: number }) {
  await requireMember(s.db, circleId, userId);
  const today = instantToLocalDate(s.now(), await tzOf(s.db, userId));
  await publishActivity(s.db, userId, [circleId], {
    type: "weekly_recap",
    data: recap,
    dedupeKey: `recap:${userId}:${today}`,
  });
  return { ok: true };
}

export async function circleMembers(s: Services, userId: string, circleId: string) {
  await requireMember(s.db, circleId, userId);
  const rows = await s.db
    .select()
    .from(circleMemberships)
    .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.status, "active")));
  const profs = await profilesByIds(s.db, rows.map((r) => r.userId));
  return rows.map((r) => ({ ...publicProfile(profs.get(r.userId)!), role: r.role, joinedAt: r.joinedAt }));
}

