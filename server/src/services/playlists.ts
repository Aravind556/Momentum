import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import {
  assertValidSchedule,
  dateRange,
  generateSchedule,
  isoWeekday,
  localDayBounds,
  type SchedulerTask,
} from "@cadence/shared";
import type { Tx } from "../db/index.js";
import { goals, playlistItems, playlists, scheduleBlocks, taskDependencies, tasks } from "../db/schema.js";
import { badRequest, HttpError, notFound } from "../lib/http.js";
import { fetchPlaylist, parsePlaylistId } from "../integrations/youtube.js";
import { IntegrationError } from "../integrations/types.js";
import type { Services } from "./context.js";
import { completeTask, reopenTask } from "./completions.js";
import { buildPlanningState } from "./schedules.js";
import { publishActivity } from "./social.js";

export interface PlanConfig {
  targetDate: string;
  startDate: string;
  studyWeekdays: number[];
  dailyMinutes: number;
  sessionMinutes: number;
  allowSplitVideos: boolean;
  inOrder: boolean;
  revisionMinutes: number;
}

async function createPlaylistRecord(
  s: Services,
  userId: string,
  data: { source: "youtube" | "manual"; title: string; url?: string; externalId?: string; items: Array<{ title: string; durationSeconds: number; url?: string }> },
) {
  return s.db.transaction(async (tx) => {
    const [goal] = await tx
      .insert(goals)
      .values({
        ownerId: userId,
        title: data.title,
        category: "course",
        recurrence: { type: "none" },
        progressMethod: "tasks",
        description: data.source === "youtube" ? `Imported from YouTube (${data.items.length} videos)` : null,
      })
      .returning();
    const [pl] = await tx
      .insert(playlists)
      .values({ ownerId: userId, goalId: goal!.id, source: data.source, title: data.title, url: data.url ?? null, externalId: data.externalId ?? null })
      .returning();
    await tx.insert(playlistItems).values(
      data.items.map((it, i) => ({ playlistId: pl!.id, position: i + 1, title: it.title, durationSeconds: it.durationSeconds, url: it.url ?? null })),
    );
    return pl!;
  });
}

/** Imports a YouTube playlist. Fails with a clear message (and a manual fallback) when metadata is unavailable. */
export async function importYoutubePlaylist(s: Services, userId: string, url: string) {
  const id = parsePlaylistId(url);
  if (!id) throw badRequest("That doesn't look like a YouTube playlist URL (it needs a ?list= parameter)", "invalid_playlist_url");
  try {
    const meta = await fetchPlaylist(id, s.integrations.fetch);
    const pl = await createPlaylistRecord(s, userId, {
      source: "youtube",
      title: meta.title,
      url,
      externalId: id,
      items: meta.items.map((i) => ({ title: i.title, durationSeconds: i.durationSeconds, url: i.url })),
    });
    return { playlist: await getPlaylist(s, userId, pl.id), skipped: meta.skipped };
  } catch (err) {
    if (err instanceof IntegrationError) {
      const code = err.message.includes("not configured") ? "youtube_not_configured" : `youtube_${err.kind}`;
      throw new HttpError(err.kind === "not_found" ? 404 : 502, err.message, code);
    }
    throw err;
  }
}

export async function createManualPlaylist(s: Services, userId: string, input: { title: string; lessons: Array<{ title: string; minutes: number; url?: string }> }) {
  const pl = await createPlaylistRecord(s, userId, {
    source: "manual",
    title: input.title,
    items: input.lessons.map((l) => ({ title: l.title, durationSeconds: l.minutes * 60, ...(l.url ? { url: l.url } : {}) })),
  });
  return { playlist: await getPlaylist(s, userId, pl.id), skipped: 0 };
}

async function ownedPlaylist(db: Tx, userId: string, id: string) {
  const pl = await db.query.playlists.findFirst({ where: and(eq(playlists.id, id), eq(playlists.ownerId, userId)) });
  if (!pl) throw notFound("Playlist");
  return pl;
}

export async function getPlaylist(s: Services, userId: string, id: string) {
  const pl = await ownedPlaylist(s.db, userId, id);
  const items = await s.db.select().from(playlistItems).where(eq(playlistItems.playlistId, id)).orderBy(asc(playlistItems.position));
  const totalSeconds = items.reduce((a, i) => a + i.durationSeconds, 0);
  const remainingSeconds = items.reduce((a, i) => a + (i.status === "completed" ? 0 : Math.max(0, i.durationSeconds - i.positionSeconds)), 0);
  return {
    ...pl,
    items,
    stats: {
      videos: items.length,
      completed: items.filter((i) => i.status === "completed").length,
      totalMinutes: Math.round(totalSeconds / 60),
      remainingMinutes: Math.round(remainingSeconds / 60),
    },
  };
}

export async function listPlaylists(s: Services, userId: string) {
  const rows = await s.db.select().from(playlists).where(eq(playlists.ownerId, userId)).orderBy(asc(playlists.createdAt));
  return Promise.all(rows.map((r) => getPlaylist(s, userId, r.id)));
}

const remainingMinutes = (i: typeof playlistItems.$inferSelect) => Math.max(1, Math.ceil((i.durationSeconds - i.positionSeconds) / 60));

/**
 * Computes a multi-day plan for the remaining videos using real durations, the user's availability
 * (restricted to study weekdays), existing commitments and blocks, a daily budget and video order.
 */
async function computePlan(s: Services, tx: Tx, userId: string, playlistId: string, cfg: PlanConfig) {
  const now = s.now();
  if (cfg.targetDate < cfg.startDate) throw badRequest("Target date must be on or after the start date");
  if (DateTime.fromISO(cfg.targetDate).diff(DateTime.fromISO(cfg.startDate), "days").days > 180) {
    throw badRequest("Plan at most 180 days ahead");
  }
  const items = (await tx.select().from(playlistItems).where(eq(playlistItems.playlistId, playlistId)).orderBy(asc(playlistItems.position))).filter(
    (i) => i.status !== "completed",
  );
  if (!items.length) throw badRequest("Every video in this playlist is already completed", "nothing_to_plan");

  const playlistTaskIds = new Set(items.map((i) => i.taskId).filter((x): x is string => !!x));

  const plan = async (endDate: string) => {
    const state = await buildPlanningState(tx, userId, cfg.startDate, endDate, now, { includeTasks: false, replaceExisting: false });
    // Non-study days are unavailable for this plan.
    const extraOff = dateRange(cfg.startDate, endDate)
      .filter((d) => !cfg.studyWeekdays.includes(isoWeekday(d)))
      .map((date) => ({ date, off: true }));
    state.input.availability = { ...state.spec, overrides: [...state.spec.overrides.filter((o) => !extraOff.some((x) => x.date === o.date)), ...extraOff] };
    // Planned (not yet done) blocks of this playlist are replaced by the new plan.
    state.input.busy = state.input.busy.filter((b) => !(b.taskId && playlistTaskIds.has(b.taskId) && b.kind !== "completed"));

    const group = `playlist:${playlistId}`;
    const sTasks: SchedulerTask[] = [];
    let prev: string | null = null;
    items.forEach((it, idx) => {
      const id = it.taskId ?? `item:${it.id}`;
      const minutes = remainingMinutes(it);
      sTasks.push({
        id,
        title: it.title,
        remainingMinutes: minutes,
        priority: 2,
        splittable: cfg.allowSplitVideos && minutes > cfg.sessionMinutes,
        preferredSessionMinutes: cfg.sessionMinutes,
        maxSessionMinutes: Math.max(cfg.sessionMinutes, 10),
        minSessionMinutes: Math.min(20, minutes),
        groupId: group,
        earliestStart: localDayBounds(cfg.startDate, state.tz).start,
        order: it.position,
        ...(cfg.inOrder && prev ? { dependsOn: [prev] } : {}),
      });
      prev = id;
      if (cfg.revisionMinutes > 0 && ((idx + 1) % 5 === 0 || idx === items.length - 1)) {
        const rid = `revision:${it.id}`;
        sTasks.push({
          id: rid,
          title: `Revise up to "${it.title}"`,
          remainingMinutes: cfg.revisionMinutes,
          priority: 2,
          splittable: false,
          groupId: group,
          dependsOn: [id],
          order: it.position + 0.5,
        });
      }
    });
    state.input.tasks = sTasks;
    state.input.groupBudgets = { [group]: cfg.dailyMinutes };
    state.input.endDate = endDate;
    const result = generateSchedule(state.input);
    assertValidSchedule(state.input, result);
    return { result, state, sTasks };
  };

  const main = await plan(cfg.targetDate);
  const total = main.sTasks.reduce((a, t) => a + t.remainingMinutes, 0);
  const studyDays = dateRange(cfg.startDate, cfg.targetDate).filter((d) => cfg.studyWeekdays.includes(isoWeekday(d))).length;
  let projectedFinish: string | null = null;
  if (main.result.unscheduled.length) {
    const extended = await plan(DateTime.fromISO(cfg.targetDate).plus({ days: 120 }).toISODate()!);
    if (!extended.result.unscheduled.length) {
      projectedFinish = extended.result.blocks.filter((b) => b.kind !== "break").reduce((m, b) => (b.day > m ? b.day : m), cfg.startDate);
    }
  } else {
    projectedFinish = main.result.blocks.filter((b) => b.kind !== "break").reduce((m, b) => (b.day > m ? b.day : m), cfg.startDate);
  }
  const titles = new Map(main.sTasks.map((t) => [t.id, t.title]));
  return {
    items,
    sTasks: main.sTasks,
    result: main.result,
    summary: {
      feasible: main.result.unscheduled.length === 0,
      totalMinutes: total,
      studyDays,
      neededDailyMinutes: studyDays ? Math.ceil(total / studyDays) : null,
      projectedFinish,
      unscheduled: main.result.unscheduled.map((u) => ({ ...u, title: titles.get(u.taskId) ?? "Video" })),
      blocks: main.result.blocks
        .filter((b) => b.kind !== "break")
        .map((b) => ({ title: titles.get(b.taskId ?? "") ?? "", start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString(), day: b.day, segment: b.segment ?? null })),
    },
  };
}

export async function previewPlan(s: Services, userId: string, playlistId: string, cfg: PlanConfig) {
  await ownedPlaylist(s.db, userId, playlistId);
  return (await computePlan(s, s.db, userId, playlistId, cfg)).summary;
}

/** Creates/updates tasks for each remaining video and writes the planned blocks atomically. */
export async function applyPlan(s: Services, userId: string, playlistId: string, cfg: PlanConfig) {
  const now = s.now();
  return s.db.transaction(async (tx) => {
    const pl = await ownedPlaylist(tx, userId, playlistId);
    const pending = (await tx.select().from(playlistItems).where(eq(playlistItems.playlistId, playlistId)).orderBy(asc(playlistItems.position))).filter(
      (i) => i.status !== "completed",
    );
    const tz = (await tx.query.profiles.findFirst({ where: (p, { eq: e }) => e(p.userId, userId) }))!.timezone;
    const group = `playlist:${playlistId}`;
    let prev: string | null = null;
    const ordered: string[] = [];
    for (const it of pending) {
      const minutes = remainingMinutes(it);
      const fields = {
        title: it.title,
        estimatedMinutes: minutes,
        splittable: cfg.allowSplitVideos && minutes > cfg.sessionMinutes,
        preferredSessionMinutes: cfg.sessionMinutes,
        maxSessionMinutes: Math.max(cfg.sessionMinutes, 10),
        minSessionMinutes: Math.min(20, minutes),
        groupKey: group,
        groupDailyMinutes: cfg.dailyMinutes,
        earliestStartAt: new Date(localDayBounds(cfg.startDate, tz).start),
        dueAt: new Date(localDayBounds(cfg.targetDate, tz).end),
        resourceUrl: it.url,
      };
      let taskId = it.taskId;
      if (taskId) {
        await tx.update(tasks).set(fields).where(eq(tasks.id, taskId));
      } else {
        const [t] = await tx
          .insert(tasks)
          .values({ ...fields, ownerId: userId, goalId: pl.goalId, priority: 2, recurrence: { type: "none" }, verification: { provider: "none" }, sortOrder: it.position })
          .returning();
        taskId = t!.id;
        await tx.update(playlistItems).set({ taskId }).where(eq(playlistItems.id, it.id));
      }
      await tx.delete(taskDependencies).where(eq(taskDependencies.taskId, taskId));
      if (cfg.inOrder && prev) await tx.insert(taskDependencies).values({ taskId, dependsOnId: prev });
      prev = taskId;
      ordered.push(taskId);
    }
    if (ordered.length) {
      await tx
        .delete(scheduleBlocks)
        .where(and(inArray(scheduleBlocks.taskId, ordered), eq(scheduleBlocks.status, "planned"), gt(scheduleBlocks.startAt, new Date(now))));
    }

    const { result, summary, sTasks } = await computePlan(s, tx, userId, playlistId, cfg);
    const titles = new Map(sTasks.map((t) => [t.id, t.title]));
    const rows = result.blocks
      .filter((b) => !(b.taskId ?? "").startsWith("revision:"))
      .map((b) => ({
        userId,
        taskId: b.taskId,
        kind: b.kind,
        title: b.kind === "break" ? "Break" : (titles.get(b.taskId ?? "") ?? "Video"),
        startAt: new Date(b.start),
        endAt: new Date(b.end),
        day: b.day,
        source: "auto" as const,
        segment: b.segment ?? null,
      }));
    // Revision sessions become their own one-off tasks so they can be tracked and completed.
    for (const b of result.blocks.filter((x) => (x.taskId ?? "").startsWith("revision:"))) {
      const [rt] = await tx
        .insert(tasks)
        .values({
          ownerId: userId,
          goalId: pl.goalId,
          title: titles.get(b.taskId!) ?? "Revision",
          estimatedMinutes: Math.round((b.end - b.start) / 60_000),
          priority: 2,
          recurrence: { type: "none" },
          verification: { provider: "none" },
          status: "scheduled",
        })
        .returning();
      rows.push({ userId, taskId: rt!.id, kind: "focus", title: rt!.title, startAt: new Date(b.start), endAt: new Date(b.end), day: b.day, source: "auto", segment: null });
    }
    if (rows.length) await tx.insert(scheduleBlocks).values(rows);
    const scheduled = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))];
    if (scheduled.length) await tx.update(tasks).set({ status: "scheduled" }).where(and(inArray(tasks.id, scheduled), eq(tasks.status, "not_started")));
    await tx.update(playlists).set({ plan: { ...cfg, appliedAt: new Date(now).toISOString() } }).where(eq(playlists.id, playlistId));
    return summary;
  });
}

/**
 * Updates self-reported video progress. Completion is recorded as a manual completion of the
 * linked task — playback is never claimed as verified.
 */
export async function updateItemProgress(s: Services, userId: string, itemId: string, input: { status: "not_started" | "partial" | "completed"; positionSeconds?: number }) {
  const item = await s.db.query.playlistItems.findFirst({ where: eq(playlistItems.id, itemId) });
  if (!item) throw notFound("Video");
  const pl = await ownedPlaylist(s.db, userId, item.playlistId);
  const position = input.status === "completed" ? item.durationSeconds : Math.min(input.positionSeconds ?? item.positionSeconds, item.durationSeconds);
  await s.db
    .update(playlistItems)
    .set({ status: input.status, positionSeconds: input.status === "not_started" ? 0 : position })
    .where(eq(playlistItems.id, itemId));

  if (item.taskId) {
    const task = await s.db.query.tasks.findFirst({ where: eq(tasks.id, item.taskId) });
    if (input.status === "completed" && task && task.status !== "completed") {
      await completeTask(s, userId, item.taskId, { outcome: "completed", note: "Video marked as watched (self-reported)" });
    } else if (input.status !== "completed" && task?.status === "completed") {
      await reopenTask(s, userId, item.taskId).catch(() => undefined);
    }
  }

  const all = await s.db.select({ status: playlistItems.status }).from(playlistItems).where(eq(playlistItems.playlistId, pl.id));
  if (all.every((i) => i.status === "completed") && pl.goalId) {
    const goal = await s.db.query.goals.findFirst({ where: eq(goals.id, pl.goalId) });
    await s.db.update(goals).set({ status: "completed" }).where(eq(goals.id, pl.goalId));
    if (goal?.visibility === "circle" && goal.circleId) {
      await publishActivity(s.db, userId, [goal.circleId], {
        type: "playlist_finished",
        data: { title: pl.title, videos: all.length },
        resourceType: "playlist",
        resourceId: pl.id,
        dedupeKey: `playlist-finished:${pl.id}`,
      });
    }
  }
  return getPlaylist(s, userId, pl.id);
}

export async function deletePlaylist(s: Services, userId: string, id: string) {
  await ownedPlaylist(s.db, userId, id);
  await s.db.delete(playlists).where(eq(playlists.id, id));
}
