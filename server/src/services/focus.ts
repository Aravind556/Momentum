import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { focusDurations } from "@cadence/shared";
import type { Tx } from "../db/index.js";
import { focusPauses, focusSessions, profiles, scheduleBlocks, tasks } from "../db/schema.js";
import { badRequest, conflict, isUniqueViolation, notFound } from "../lib/http.js";
import type { Services } from "./context.js";
import { completeTask } from "./completions.js";
import { publishActivity } from "./social.js";
import { getOwnedTask, setTaskStatus } from "./tasks.js";

type Session = typeof focusSessions.$inferSelect;
type Pause = typeof focusPauses.$inferSelect;

export function serializeSession(session: Session, pauses: Pause[], now: number, taskTitle?: string | null) {
  const d = focusDurations(
    {
      startedAt: session.startedAt.getTime(),
      endedAt: session.endedAt?.getTime() ?? null,
      pauses: pauses.map((p) => ({ pausedAt: p.pausedAt.getTime(), resumedAt: p.resumedAt?.getTime() ?? null })),
    },
    now,
  );
  return {
    ...session,
    taskTitle: taskTitle ?? null,
    pauses,
    serverNow: new Date(now).toISOString(),
    elapsedSeconds: Math.round(d.elapsedMs / 1000),
    activeSeconds: session.activeSeconds ?? Math.round(d.activeMs / 1000),
    pausedSeconds: session.pausedSeconds ?? Math.round(d.pausedMs / 1000),
    isPaused: d.isPaused,
    remainingSeconds: Math.round(session.plannedMinutes * 60 - d.activeMs / 1000),
  };
}

async function loadSession(db: Tx, userId: string, sessionId: string) {
  const session = await db.query.focusSessions.findFirst({
    where: and(eq(focusSessions.id, sessionId), eq(focusSessions.userId, userId)),
  });
  if (!session) throw notFound("Focus session");
  const pauses = await db.select().from(focusPauses).where(eq(focusPauses.sessionId, sessionId)).orderBy(focusPauses.pausedAt);
  return { session, pauses };
}

async function titleOf(db: Tx, taskId: string | null) {
  if (!taskId) return null;
  const t = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId), columns: { title: true } });
  return t?.title ?? null;
}

export async function getActiveSession(s: Services, userId: string) {
  const session = await s.db.query.focusSessions.findFirst({
    where: and(eq(focusSessions.userId, userId), eq(focusSessions.status, "active")),
  });
  if (!session) return null;
  const pauses = await s.db.select().from(focusPauses).where(eq(focusPauses.sessionId, session.id)).orderBy(focusPauses.pausedAt);
  return serializeSession(session, pauses, s.now(), await titleOf(s.db, session.taskId));
}

export async function startSession(
  s: Services,
  userId: string,
  input: { taskId?: string | null; blockId?: string | null; plannedMinutes: number; kind: "focus" | "break" },
) {
  const now = s.now();
  try {
    return await s.db.transaction(async (tx) => {
      let taskId = input.taskId ?? null;
      if (input.blockId) {
        const block = await tx.query.scheduleBlocks.findFirst({
          where: and(eq(scheduleBlocks.id, input.blockId), eq(scheduleBlocks.userId, userId)),
        });
        if (!block) throw notFound("Schedule block");
        if (["completed", "partial"].includes(block.status)) throw conflict("This block is already done", "block_done");
        taskId = taskId ?? block.taskId;
        await tx.update(scheduleBlocks).set({ status: "in_progress" }).where(eq(scheduleBlocks.id, block.id));
      }
      if (taskId) {
        const task = await getOwnedTask(tx, userId, taskId);
        if (input.kind === "focus" && ["not_started", "scheduled", "partial"].includes(task.status)) {
          await setTaskStatus(tx, taskId, "in_progress");
        }
      }
      const [session] = await tx
        .insert(focusSessions)
        .values({
          userId,
          taskId,
          blockId: input.blockId ?? null,
          kind: input.kind,
          plannedMinutes: input.plannedMinutes,
          startedAt: new Date(now),
        })
        .returning();
      return serializeSession(session!, [], now, await titleOf(tx, taskId));
    });
  } catch (err) {
    // Partial unique index: at most one active session per user.
    if (isUniqueViolation(err)) throw conflict("You already have a running session", "session_active");
    throw err;
  }
}

export async function pauseSession(s: Services, userId: string, sessionId: string) {
  const now = s.now();
  return s.db.transaction(async (tx) => {
    const { session, pauses } = await loadSession(tx, userId, sessionId);
    if (session.status !== "active") throw conflict("Session is not running", "session_not_active");
    if (pauses.some((p) => p.resumedAt === null)) return serializeSession(session, pauses, now, await titleOf(tx, session.taskId));
    const [p] = await tx.insert(focusPauses).values({ sessionId, pausedAt: new Date(now) }).returning();
    return serializeSession(session, [...pauses, p!], now, await titleOf(tx, session.taskId));
  });
}

export async function resumeSession(s: Services, userId: string, sessionId: string) {
  const now = s.now();
  return s.db.transaction(async (tx) => {
    const { session } = await loadSession(tx, userId, sessionId);
    if (session.status !== "active") throw conflict("Session is not running", "session_not_active");
    await tx
      .update(focusPauses)
      .set({ resumedAt: new Date(now) })
      .where(and(eq(focusPauses.sessionId, sessionId), isNull(focusPauses.resumedAt)));
    const { pauses } = await loadSession(tx, userId, sessionId);
    return serializeSession(session, pauses, now, await titleOf(tx, session.taskId));
  });
}

export async function extendSession(s: Services, userId: string, sessionId: string, minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw badRequest("Extend by 1–120 minutes");
  const now = s.now();
  return s.db.transaction(async (tx) => {
    const { session, pauses } = await loadSession(tx, userId, sessionId);
    if (session.status !== "active") throw conflict("Session is not running", "session_not_active");
    const [updated] = await tx
      .update(focusSessions)
      .set({ plannedMinutes: session.plannedMinutes + minutes })
      .where(eq(focusSessions.id, sessionId))
      .returning();
    return serializeSession(updated!, pauses, now, await titleOf(tx, session.taskId));
  });
}

/**
 * Ends a session. Timer completion is recorded separately from task completion: the task outcome
 * is only recorded when the user explicitly reports one, and it is never marked externally verified.
 */
export async function finishSession(
  s: Services,
  userId: string,
  sessionId: string,
  input: { note?: string | null; taskOutcome: "none" | "completed" | "partial" },
) {
  const now = s.now();
  const result = await s.db.transaction(async (tx) => {
    const { session, pauses } = await loadSession(tx, userId, sessionId);
    if (session.status !== "active") throw conflict("Session already ended", "session_not_active");
    await tx
      .update(focusPauses)
      .set({ resumedAt: new Date(now) })
      .where(and(eq(focusPauses.sessionId, sessionId), isNull(focusPauses.resumedAt)));
    const closed = pauses.map((p) => ({ ...p, resumedAt: p.resumedAt ?? new Date(now) }));
    const d = focusDurations(
      {
        startedAt: session.startedAt.getTime(),
        endedAt: now,
        pauses: closed.map((p) => ({ pausedAt: p.pausedAt.getTime(), resumedAt: p.resumedAt.getTime() })),
      },
      now,
    );
    const reachedPlan = d.activeMs >= session.plannedMinutes * 60_000 - 30_000;
    const [updated] = await tx
      .update(focusSessions)
      .set({
        endedAt: new Date(now),
        status: reachedPlan ? "completed" : "stopped",
        activeSeconds: Math.round(d.activeMs / 1000),
        pausedSeconds: Math.round(d.pausedMs / 1000),
        note: input.note ?? null,
        taskOutcome: input.taskOutcome,
      })
      .where(eq(focusSessions.id, sessionId))
      .returning();

    if (session.blockId) {
      const block = await tx.query.scheduleBlocks.findFirst({ where: eq(scheduleBlocks.id, session.blockId) });
      if (block) {
        const activeMinutes = Math.round(d.activeMs / 60_000);
        await tx
          .update(scheduleBlocks)
          .set({
            status: session.kind === "break" ? "completed" : reachedPlan ? "completed" : "partial",
            actualMinutes: (block.actualMinutes ?? 0) + activeMinutes,
          })
          .where(eq(scheduleBlocks.id, block.id));
      }
    }
    if (session.taskId && input.taskOutcome === "none") {
      const t = await tx.query.tasks.findFirst({ where: eq(tasks.id, session.taskId) });
      if (t?.status === "in_progress") await setTaskStatus(tx, t.id, "scheduled");
    }

    const profile = (await tx.query.profiles.findFirst({ where: eq(profiles.userId, userId) }))!;
    if (session.kind === "focus" && profile.preferences.privacy.shareFocusSessions && d.activeMs >= 10 * 60_000) {
      await publishActivity(tx, userId, "all", {
        type: "focus_session",
        data: { minutes: Math.round(d.activeMs / 60_000) },
        resourceType: "focus_session",
        resourceId: sessionId,
        dedupeKey: `focus:${sessionId}`,
      });
    }
    return { session: updated!, pauses: closed, overran: d.activeMs > session.plannedMinutes * 60_000 + 60_000 };
  });

  let completion = null;
  if (result.session.taskId && input.taskOutcome !== "none") {
    completion = (await completeTask(s, userId, result.session.taskId, { outcome: input.taskOutcome, note: input.note ?? null }))
      .completion;
  }
  return {
    session: serializeSession(result.session, result.pauses, now, await titleOf(s.db, result.session.taskId)),
    overran: result.overran,
    completion,
  };
}

export async function listSessions(s: Services, userId: string, limit = 30) {
  const rows = await s.db
    .select()
    .from(focusSessions)
    .where(eq(focusSessions.userId, userId))
    .orderBy(desc(focusSessions.startedAt))
    .limit(Math.min(limit, 100));
  const ids = rows.map((r) => r.id);
  const pauses = ids.length ? await s.db.select().from(focusPauses).where(inArray(focusPauses.sessionId, ids)) : [];
  const taskIds = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))];
  const titles = taskIds.length
    ? new Map((await s.db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, taskIds))).map((t) => [t.id, t.title]))
    : new Map<string, string>();
  const now = s.now();
  return rows.map((r) =>
    serializeSession(
      r,
      pauses.filter((p) => p.sessionId === r.id),
      now,
      r.taskId ? titles.get(r.taskId) : null,
    ),
  );
}
