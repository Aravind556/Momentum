import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { instantToLocalDate, localDayBounds } from "@cadence/shared";
import type { DB, Tx } from "../db/index.js";
import { challengeParticipants, challenges, circleMemberships, focusSessions, taskCompletions, tasks } from "../db/schema.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";
import type { Services } from "./context.js";
import { publishActivity, notifyMany } from "./social.js";
import { publicProfile, profilesByIds } from "./profiles.js";
import { requireMember } from "./circles.js";
import { tzOf } from "./schedules.js";

type Challenge = typeof challenges.$inferSelect;

export function challengeStatus(c: Challenge, today: string): "upcoming" | "active" | "completed" {
  if (today < c.startDate) return "upcoming";
  if (today > c.endDate) return "completed";
  return "active";
}

/**
 * Per-participant progress using only tasks linked to the challenge (never unrelated personal tasks).
 *  completions   — completed occurrences of linked tasks within the challenge dates
 *  verified      — the same, counting only integration-verified completions
 *  focus_minutes — focus minutes on linked tasks within the dates (UTC day bounds)
 */
export async function challengeProgressFor(db: Tx, c: Challenge, userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>(userIds.map((u) => [u, 0]));
  if (!userIds.length) return out;
  if (c.metric === "focus_minutes") {
    // Coarse SQL window (±1 day covers every timezone), then exact filtering by each user's local date.
    const rows = await db
      .select({ userId: focusSessions.userId, startedAt: focusSessions.startedAt, seconds: focusSessions.activeSeconds })
      .from(focusSessions)
      .innerJoin(tasks, eq(tasks.id, focusSessions.taskId))
      .where(
        and(
          eq(tasks.challengeId, c.id),
          eq(focusSessions.kind, "focus"),
          inArray(focusSessions.userId, userIds),
          gte(focusSessions.startedAt, new Date(localDayBounds(c.startDate, "UTC").start - 86_400_000)),
          lt(focusSessions.startedAt, new Date(localDayBounds(c.endDate, "UTC").end + 86_400_000)),
        ),
      );
    const zones = new Map((await profilesByIds(db, userIds)).entries());
    const seconds = new Map<string, number>();
    for (const r of rows) {
      const day = instantToLocalDate(r.startedAt.getTime(), zones.get(r.userId)?.timezone ?? "UTC");
      if (day < c.startDate || day > c.endDate) continue;
      seconds.set(r.userId, (seconds.get(r.userId) ?? 0) + (r.seconds ?? 0));
    }
    for (const [u, sec] of seconds) out.set(u, Math.round(sec / 60));
    return out;
  }
  const rows = await db
    .select({ userId: taskCompletions.userId, n: sql<number>`count(*)` })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        eq(tasks.challengeId, c.id),
        inArray(taskCompletions.userId, userIds),
        isNull(taskCompletions.voidedAt),
        eq(taskCompletions.outcome, "completed"),
        gte(taskCompletions.day, c.startDate),
        lte(taskCompletions.day, c.endDate),
        c.metric === "verified" ? eq(taskCompletions.verificationStatus, "verified") : undefined,
      ),
    )
    .groupBy(taskCompletions.userId);
  for (const r of rows) out.set(r.userId, Number(r.n));
  return out;
}

export async function createChallenge(
  s: Services,
  userId: string,
  input: {
    circleId: string;
    title: string;
    description?: string | null;
    startDate: string;
    endDate: string;
    metric: "completions" | "focus_minutes" | "verified";
    individualTarget?: number | null;
    collectiveTarget?: number | null;
    taskTemplate?: { title: string; estimatedMinutes: number; splittable: boolean } | null;
  },
) {
  await requireMember(s.db, input.circleId, userId);
  return s.db.transaction(async (tx) => {
    const [c] = await tx
      .insert(challenges)
      .values({
        circleId: input.circleId,
        creatorId: userId,
        title: input.title,
        description: input.description ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        metric: input.metric,
        individualTarget: input.individualTarget ?? null,
        collectiveTarget: input.collectiveTarget ?? null,
        taskTemplate: input.taskTemplate ?? null,
      })
      .returning();
    await joinInTx(tx, c!, userId);
    await publishActivity(tx, userId, [input.circleId], {
      type: "challenge_created",
      data: { challengeTitle: c!.title, startDate: c!.startDate, endDate: c!.endDate },
      resourceType: "challenge",
      resourceId: c!.id,
      dedupeKey: `challenge-created:${c!.id}`,
    });
    const members = await tx
      .select({ userId: circleMemberships.userId })
      .from(circleMemberships)
      .where(and(eq(circleMemberships.circleId, input.circleId), eq(circleMemberships.status, "active")));
    await notifyMany(
      tx,
      members.map((m) => m.userId).filter((u) => u !== userId),
      "challenge",
      { message: `New challenge: ${c!.title}`, challengeId: c!.id, circleId: input.circleId },
      `challenge-created:${c!.id}`,
    );
    return c!;
  });
}

/** Joining creates the participant row and, if the challenge has a task template, a linked recurring task. */
async function joinInTx(tx: Tx, c: Challenge, userId: string) {
  await tx
    .insert(challengeParticipants)
    .values({ challengeId: c.id, userId })
    .onConflictDoUpdate({ target: [challengeParticipants.challengeId, challengeParticipants.userId], set: { status: "joined" } });
  if (c.taskTemplate) {
    const [existing] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.ownerId, userId), eq(tasks.challengeId, c.id)))
      .limit(1);
    if (!existing) {
      const tz = await tzOf(tx, userId);
      await tx.insert(tasks).values({
        ownerId: userId,
        challengeId: c.id,
        title: c.taskTemplate.title,
        estimatedMinutes: c.taskTemplate.estimatedMinutes,
        splittable: c.taskTemplate.splittable,
        priority: 3,
        recurrence: { type: "daily" },
        verification: { provider: "none" },
        earliestStartAt: new Date(localDayBounds(c.startDate, tz).start),
        latestFinishAt: new Date(localDayBounds(c.endDate, tz).end),
      });
    }
  }
}

async function getChallengeForMember(db: DB, userId: string, challengeId: string) {
  const c = await db.query.challenges.findFirst({ where: eq(challenges.id, challengeId) });
  if (!c) throw notFound("Challenge");
  await requireMember(db, c.circleId, userId);
  return c;
}

export async function joinChallenge(s: Services, userId: string, challengeId: string) {
  const c = await getChallengeForMember(s.db, userId, challengeId);
  const today = instantToLocalDate(s.now(), await tzOf(s.db, userId));
  if (challengeStatus(c, today) === "completed") throw badRequest("This challenge has ended");
  await s.db.transaction((tx) => joinInTx(tx, c, userId));
  return { ok: true };
}

export async function leaveChallenge(s: Services, userId: string, challengeId: string) {
  const c = await getChallengeForMember(s.db, userId, challengeId);
  await s.db
    .update(challengeParticipants)
    .set({ status: "left" })
    .where(and(eq(challengeParticipants.challengeId, c.id), eq(challengeParticipants.userId, userId)));
  return { ok: true };
}

export async function deleteChallenge(s: Services, userId: string, challengeId: string) {
  const c = await getChallengeForMember(s.db, userId, challengeId);
  const m = await requireMember(s.db, c.circleId, userId);
  if (c.creatorId !== userId && m.role === "member") throw forbidden("Only the creator or a Circle admin can delete this");
  await s.db.delete(challenges).where(eq(challenges.id, c.id));
}

export async function challengeDetail(s: Services, userId: string, challengeId: string) {
  const c = await getChallengeForMember(s.db, userId, challengeId);
  const today = instantToLocalDate(s.now(), await tzOf(s.db, userId));
  const participants = await s.db
    .select()
    .from(challengeParticipants)
    .where(and(eq(challengeParticipants.challengeId, c.id), eq(challengeParticipants.status, "joined")));
  const ids = participants.map((p) => p.userId);
  const progress = await challengeProgressFor(s.db, c, ids);
  const profs = await profilesByIds(s.db, ids);
  const board = ids
    .map((id) => ({
      user: publicProfile(profs.get(id)!),
      progress: progress.get(id) ?? 0,
      ratio: c.individualTarget ? Math.min(1, (progress.get(id) ?? 0) / c.individualTarget) : null,
    }))
    .sort((a, b) => b.progress - a.progress);
  const collective = board.reduce((sum, b) => sum + b.progress, 0);
  return {
    ...c,
    status: challengeStatus(c, today),
    joined: ids.includes(userId),
    leaderboard: board,
    collective: { value: collective, target: c.collectiveTarget, ratio: c.collectiveTarget ? Math.min(1, collective / c.collectiveTarget) : null },
  };
}

/** Challenges across all of the user's Circles, grouped by status. */
export async function listUserChallenges(s: Services, userId: string) {
  const today = instantToLocalDate(s.now(), await tzOf(s.db, userId));
  const memberships = await s.db
    .select({ circleId: circleMemberships.circleId })
    .from(circleMemberships)
    .where(and(eq(circleMemberships.userId, userId), eq(circleMemberships.status, "active")));
  if (!memberships.length) return [];
  const rows = await s.db
    .select()
    .from(challenges)
    .where(inArray(challenges.circleId, memberships.map((m) => m.circleId)))
    .orderBy(desc(challenges.startDate));
  const out = [];
  for (const c of rows) {
    const participants = await s.db
      .select({ userId: challengeParticipants.userId })
      .from(challengeParticipants)
      .where(and(eq(challengeParticipants.challengeId, c.id), eq(challengeParticipants.status, "joined")));
    const ids = participants.map((p) => p.userId);
    const progress = await challengeProgressFor(s.db, c, ids);
    out.push({
      ...c,
      status: challengeStatus(c, today),
      participantCount: ids.length,
      joined: ids.includes(userId),
      myProgress: progress.get(userId) ?? 0,
      collective: [...progress.values()].reduce((a, b) => a + b, 0),
    });
  }
  return out;
}
