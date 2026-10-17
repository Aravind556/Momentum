import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { instantToLocalDate, type VerificationStatus } from "@cadence/shared";
import type { Tx } from "../db/index.js";
import {
  challengeParticipants,
  challenges,
  goals,
  integrationConnections,
  profiles,
  scheduleBlocks,
  taskCompletions,
  tasks,
} from "../db/schema.js";
import { badRequest } from "../lib/http.js";
import type { Services } from "./context.js";
import { computeStreak } from "./analytics.js";
import { challengeProgressFor } from "./challenges.js";
import { isRecurring } from "./recurrence.js";
import { notifyMany, publishActivity } from "./social.js";
import { getOwnedTask, setTaskStatus, type Task } from "./tasks.js";

export type Completion = typeof taskCompletions.$inferSelect;

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365];

export interface CompleteOptions {
  outcome: "completed" | "partial";
  occurrenceDate?: string;
  note?: string | null;
  evidenceUrl?: string | null;
  /** Set only by integration verification. */
  integrationEvidence?: Record<string, unknown>;
}

async function verificationFor(db: Tx, task: Task, userId: string, opts: CompleteOptions): Promise<VerificationStatus> {
  if (opts.integrationEvidence) return "verified";
  if (task.verification.provider !== "none") {
    const conn = await db.query.integrationConnections.findFirst({
      where: and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, task.verification.provider)),
    });
    // A manual completion of an integration-verified task waits for the next sync; it is never auto-verified.
    return conn && conn.status !== "disconnected" ? "pending" : "unavailable";
  }
  return opts.evidenceUrl ? "evidence" : "manual";
}

/**
 * Records a task outcome. Idempotent per (task, occurrence): a duplicate request returns the existing
 * completion. Completing a focus session never calls this implicitly — the user (or a verified
 * integration event) must record the outcome.
 */
export async function completeTask(s: Services, userId: string, taskId: string, opts: CompleteOptions) {
  const now = s.now();
  return s.db.transaction(async (tx) => {
    const task = await getOwnedTask(tx, userId, taskId);
    if (task.status === "cancelled") throw badRequest("This task is archived");
    const profile = (await tx.query.profiles.findFirst({ where: eq(profiles.userId, userId) }))!;
    const today = instantToLocalDate(now, profile.timezone);
    const recurring = isRecurring(task.recurrence);
    const occurrenceKey = recurring ? (opts.occurrenceDate ?? today) : "once";
    const verificationStatus = await verificationFor(tx, task, userId, opts);
    const method = opts.integrationEvidence ? "integration" : opts.evidenceUrl ? "evidence" : "manual";

    const [inserted] = await tx
      .insert(taskCompletions)
      .values({
        taskId,
        userId,
        occurrenceKey,
        day: recurring ? occurrenceKey : today,
        completedAt: new Date(now),
        outcome: opts.outcome,
        method,
        verificationStatus,
        evidence: opts.integrationEvidence ?? (opts.evidenceUrl ? { url: opts.evidenceUrl } : null),
        note: opts.note ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (!inserted) {
      const existing = (await tx.query.taskCompletions.findFirst({
        where: and(eq(taskCompletions.taskId, taskId), eq(taskCompletions.occurrenceKey, occurrenceKey), isNull(taskCompletions.voidedAt)),
      }))!;
      // An integration may upgrade an unverified completion; nothing ever downgrades one.
      if (opts.integrationEvidence && existing.verificationStatus !== "verified") {
        const [upgraded] = await tx
          .update(taskCompletions)
          .set({ verificationStatus: "verified", method: "integration", evidence: opts.integrationEvidence })
          .where(eq(taskCompletions.id, existing.id))
          .returning();
        return { completion: upgraded!, duplicate: true };
      }
      // Upgrading a partial outcome to completed is allowed.
      if (existing.outcome === "partial" && opts.outcome === "completed") {
        const [upgraded] = await tx
          .update(taskCompletions)
          .set({ outcome: "completed", completedAt: new Date(now) })
          .where(eq(taskCompletions.id, existing.id))
          .returning();
        if (!recurring) await setTaskStatus(tx, taskId, "completed");
        return { completion: upgraded!, duplicate: false };
      }
      return { completion: existing, duplicate: true };
    }

    if (!recurring) {
      await setTaskStatus(tx, taskId, opts.outcome === "completed" ? "completed" : "partial");
      if (opts.outcome === "completed") {
        // The work is done: free the future slots that were reserved for it.
        await tx
          .delete(scheduleBlocks)
          .where(and(eq(scheduleBlocks.taskId, taskId), eq(scheduleBlocks.status, "planned"), gt(scheduleBlocks.startAt, new Date(now))));
      }
    }

    await afterCompletion(tx, userId, task, inserted, today, now);
    return { completion: inserted, duplicate: false };
  });
}

/** Social side-effects, respecting the user's privacy settings. */
async function afterCompletion(tx: Tx, userId: string, task: Task, completion: Completion, today: string, now: number) {
  const profile = (await tx.query.profiles.findFirst({ where: eq(profiles.userId, userId) }))!;
  const privacy = profile.preferences.privacy;

  // Only tasks explicitly shared with a Circle (via a shared goal or a challenge) are posted, by title.
  const sharedCircles = new Set<string>();
  let challenge: typeof challenges.$inferSelect | undefined;
  if (task.goalId) {
    const g = await tx.query.goals.findFirst({ where: eq(goals.id, task.goalId) });
    if (g?.visibility === "circle" && g.circleId) sharedCircles.add(g.circleId);
  }
  if (task.challengeId) {
    challenge = await tx.query.challenges.findFirst({ where: eq(challenges.id, task.challengeId) });
    if (challenge) sharedCircles.add(challenge.circleId);
  }
  if (privacy.shareCompletions && sharedCircles.size && completion.outcome === "completed") {
    await publishActivity(tx, userId, [...sharedCircles], {
      type: "task_completed",
      data: { title: task.title, verified: completion.verificationStatus === "verified" },
      resourceType: "task",
      resourceId: task.id,
      dedupeKey: `completion:${completion.id}`,
    });
  }

  if (challenge && completion.outcome === "completed" && challenge.individualTarget) {
    const progress = await challengeProgressFor(tx, challenge, [userId]);
    const mine = progress.get(userId) ?? 0;
    if (mine >= challenge.individualTarget) {
      await publishActivity(tx, userId, [challenge.circleId], {
        type: "challenge_milestone",
        data: { challengeTitle: challenge.title, target: challenge.individualTarget },
        resourceType: "challenge",
        resourceId: challenge.id,
        dedupeKey: `challenge-target:${challenge.id}:${userId}`,
      });
      const others = await tx
        .select({ userId: challengeParticipants.userId })
        .from(challengeParticipants)
        .where(and(eq(challengeParticipants.challengeId, challenge.id), eq(challengeParticipants.status, "joined"), ne(challengeParticipants.userId, userId)));
      await notifyMany(
        tx,
        others.map((o) => o.userId),
        "friend_milestone",
        { message: `${profile.displayName} reached the target in "${challenge.title}"`, challengeId: challenge.id },
        `challenge-target:${challenge.id}:${userId}`,
      );
    }
  }

  if (privacy.shareStreaks) {
    const streak = await computeStreak(tx, userId, profile.timezone, now);
    if (STREAK_MILESTONES.includes(streak.current)) {
      await publishActivity(tx, userId, "all", {
        type: "streak_milestone",
        data: { days: streak.current },
        dedupeKey: `streak:${streak.current}:${today}`,
      });
    }
  }
}

/** Reopens a completed task by voiding (not deleting) its completion record. */
export async function reopenTask(s: Services, userId: string, taskId: string, occurrenceDate?: string) {
  const now = s.now();
  return s.db.transaction(async (tx) => {
    const task = await getOwnedTask(tx, userId, taskId);
    const profile = (await tx.query.profiles.findFirst({ where: eq(profiles.userId, userId) }))!;
    const key = isRecurring(task.recurrence) ? (occurrenceDate ?? instantToLocalDate(now, profile.timezone)) : "once";
    const [voided] = await tx
      .update(taskCompletions)
      .set({ voidedAt: new Date(now) })
      .where(and(eq(taskCompletions.taskId, taskId), eq(taskCompletions.occurrenceKey, key), isNull(taskCompletions.voidedAt)))
      .returning();
    if (!voided) throw badRequest("This task is not completed", "not_completed");
    if (!isRecurring(task.recurrence)) {
      const [future] = await tx
        .select({ id: scheduleBlocks.id })
        .from(scheduleBlocks)
        .where(and(eq(scheduleBlocks.taskId, taskId), eq(scheduleBlocks.status, "planned")))
        .limit(1);
      await setTaskStatus(tx, taskId, future ? "scheduled" : "not_started");
    }
    return voided;
  });
}

/** Skips a task (or one occurrence of a recurring task). Its planned future blocks are marked skipped. */
export async function skipTask(s: Services, userId: string, taskId: string, occurrenceDate?: string) {
  const now = s.now();
  return s.db.transaction(async (tx) => {
    const task = await getOwnedTask(tx, userId, taskId);
    const recurring = isRecurring(task.recurrence);
    await tx
      .update(scheduleBlocks)
      .set({ status: "skipped" })
      .where(
        and(
          eq(scheduleBlocks.taskId, taskId),
          eq(scheduleBlocks.status, "planned"),
          gt(scheduleBlocks.endAt, new Date(now)),
          recurring && occurrenceDate ? eq(scheduleBlocks.day, occurrenceDate) : undefined,
        ),
      );
    if (!recurring) await setTaskStatus(tx, taskId, "skipped");
    return { ok: true };
  });
}

export async function unskipTask(s: Services, userId: string, taskId: string) {
  return s.db.transaction(async (tx) => {
    const task = await getOwnedTask(tx, userId, taskId);
    if (task.status !== "skipped") throw badRequest("Task is not skipped");
    await tx.update(tasks).set({ status: "not_started" }).where(eq(tasks.id, taskId));
    return { ok: true };
  });
}
