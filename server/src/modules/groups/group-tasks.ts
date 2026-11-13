import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  addDays,
  basePoints,
  defaultMinutes,
  groupTaskInputSchema,
  instantToLocalDate,
  isoWeekday,
  localDayBounds,
  localToInstant,
  parseHHMM,
  type GroupTaskInput,
} from "@momentum/shared";
import type { Services } from "../../core/context.js";
import type { Tx } from "../../core/db/index.js";
import { groupMembers, groupPoints, groupTasks, groups } from "../../core/db/schema.js";
import { badRequest, forbidden, notFound } from "../../core/http.js";
import { tzOf } from "../planning/schedules.js";
import type { DailyCandidate, DailySource, DayContext, ForecastEntry } from "../planning/sources.js";
import { providerDayEnd, resolveProblem } from "../platforms/service.js";
import { openCarriedTasks } from "../planning/daily.js";
import { profilesByIds, publicProfile } from "../profile/service.js";
import { finishedAt } from "../tasks/completions.js";
import { viewerTasks } from "./my-tasks.js";
import { recordGroupTaskPoints } from "./points.js";
import { activeMemberIds, requireMember } from "./service.js";

export type GroupTask = typeof groupTasks.$inferSelect;

export function occursOn(t: Pick<GroupTask, "repeat" | "startDate" | "endDate">, day: string): boolean {
  if (day < t.startDate || (t.endDate && day > t.endDate)) return false;
  if (t.repeat === "once") return day === t.startDate;
  if (t.repeat === "weekdays") return isoWeekday(day) <= 5;
  return true;
}

async function requireAdmin(db: Tx, groupId: string, userId: string) {
  const m = await requireMember(db, groupId, userId);
  if (m.role === "member") throw forbidden("Only the group's owner or admins can set group tasks");
  return m;
}

/** Fills in title, platform, difficulty and points from the task type and problem link. */
async function describe(s: Services, groupId: string, input: GroupTaskInput) {
  const group = (await s.db.query.groups.findFirst({ where: eq(groups.id, groupId) }))!;
  if (input.kind === "potd") {
    return {
      title: input.title || "LeetCode Problem of the Day",
      category: "leetcode",
      platform: "leetcode",
      problemKey: null,
      url: "https://leetcode.com/problemset/",
      difficulty: null,
      points: input.points ?? group.points.medium,
      estMinutes: input.estMinutes ?? 40,
    };
  }
  if (input.kind === "problem") {
    const p = await resolveProblem(s, input.url!);
    if (!p.problemKey) throw badRequest("Paste a LeetCode, Codeforces or CodeChef problem link", "invalid_problem");
    return {
      title: input.title || p.title,
      category: p.category,
      platform: p.platform,
      problemKey: p.problemKey,
      url: p.url,
      difficulty: p.difficulty,
      points: input.points ?? basePoints(p.difficulty, group.points),
      estMinutes: input.estMinutes ?? p.estMinutes,
    };
  }
  return {
    title: input.title!,
    category: "other",
    platform: null,
    problemKey: null,
    url: input.url ?? null,
    difficulty: null,
    points: input.points ?? group.points.other,
    estMinutes: input.estMinutes ?? 30,
  };
}

export async function createGroupTask(s: Services, userId: string, groupId: string, raw: unknown) {
  await requireAdmin(s.db, groupId, userId);
  const input = groupTaskInputSchema.parse(raw);
  const d = await describe(s, groupId, input);
  const [row] = await s.db
    .insert(groupTasks)
    .values({
      groupId,
      creatorId: userId,
      kind: input.kind,
      description: input.description ?? null,
      repeat: input.repeat,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      dueTime: input.dueTime,
      ...d,
    })
    .returning();
  await s.events.emit("group.tasks_changed", { groupId });
  return row!;
}

export async function updateGroupTask(s: Services, userId: string, groupId: string, taskId: string, raw: unknown) {
  await requireAdmin(s.db, groupId, userId);
  const current = await s.db.query.groupTasks.findFirst({ where: and(eq(groupTasks.id, taskId), eq(groupTasks.groupId, groupId)) });
  if (!current) throw notFound("Group task");
  const input = groupTaskInputSchema.parse(raw);
  const d = await describe(s, groupId, input);
  const [row] = await s.db
    .update(groupTasks)
    .set({ kind: input.kind, description: input.description ?? null, repeat: input.repeat, startDate: input.startDate, endDate: input.endDate ?? null, dueTime: input.dueTime, ...d })
    .where(eq(groupTasks.id, taskId))
    .returning();
  await s.events.emit("group.tasks_changed", { groupId });
  return row!;
}

/** Archiving stops future occurrences; points already earned stay. */
export async function archiveGroupTask(s: Services, userId: string, groupId: string, taskId: string) {
  await requireAdmin(s.db, groupId, userId);
  const [row] = await s.db
    .update(groupTasks)
    .set({ archivedAt: new Date(s.now()) })
    .where(and(eq(groupTasks.id, taskId), eq(groupTasks.groupId, groupId)))
    .returning({ id: groupTasks.id });
  if (!row) throw notFound("Group task");
  await s.events.emit("group.tasks_changed", { groupId });
}

export async function listGroupTasks(s: Services, userId: string, groupId: string) {
  await requireMember(s.db, groupId, userId);
  return s.db
    .select()
    .from(groupTasks)
    .where(and(eq(groupTasks.groupId, groupId), isNull(groupTasks.archivedAt)))
    .orderBy(asc(groupTasks.createdAt));
}

/**
 * Today's group tasks with every member's status: done (when, points, verified) or pending.
 * Yesterday's occurrence is listed too while the task's platform day is still running (LeetCode's
 * Problem of the Day until 05:30 IST), marked with `openUntil`, so a solve after midnight can still
 * be checked here. It's the same "still open from yesterday" rule Today uses (openCarriedTasks).
 */
export async function groupToday(s: Services, userId: string, groupId: string) {
  await requireMember(s.db, groupId, userId);
  const tz = await tzOf(s.db, userId);
  const day = instantToLocalDate(s.now(), tz);
  const yesterday = addDays(day, -1);
  const all = await listGroupTasks(s, userId, groupId);
  const todays = all.filter((t) => occursOn(t, day));
  // Yesterday's group work still open for the viewer (their own day-plan tasks), keyed by group task.
  const carried = (await openCarriedTasks(s, userId, day)).filter((t) => t.source === "group");
  const earlier = all.filter((t) => carried.some((c) => c.sourceId === t.id));
  const entries = [
    ...todays.map((t) => ({ t, day, openUntil: null as string | null })),
    ...earlier.map((t) => ({ t, day: yesterday, openUntil: new Date(providerDayEnd(s, carried.find((c) => c.sourceId === t.id)!)!).toISOString() })),
  ];
  const members = await activeMemberIds(s.db, groupId);
  const profs = await profilesByIds(s.db, members);
  const finished = entries.length
    ? await s.db
        .select()
        .from(groupPoints)
        .where(
          and(
            eq(groupPoints.groupId, groupId),
            eq(groupPoints.sourceType, "group_task"),
            inArray(groupPoints.sourceId, entries.map((e) => e.t.id)),
            inArray(groupPoints.occurrence, earlier.length ? [day, yesterday] : [day]),
          ),
        )
    : [];
  const mineToday = await viewerTasks(s, userId, "group", todays.map((t) => t.id));
  const mineEarlier = new Map(
    carried.map((c) => [c.sourceId!, { taskId: c.id, done: c.status === "completed", check: c.verification.provider === "none" ? ("self" as const) : ("submission" as const) }]),
  );
  return {
    day,
    tasks: entries.map(({ t, day: occurrence, openUntil }) => {
      const rows = finished.filter((f) => f.sourceId === t.id && f.occurrence === occurrence);
      return {
        ...t,
        occurrence,
        openUntil,
        mine: (openUntil ? mineEarlier : mineToday).get(t.id) ?? null,
        dueAt: new Date(localToInstant(occurrence, parseHHMM(t.dueTime), tz)).toISOString(),
        doneCount: rows.length,
        memberCount: members.length,
        members: members
          .map((id) => {
            const r = rows.find((x) => x.userId === id);
            return {
              user: publicProfile(profs.get(id)!),
              done: !!r,
              completedAt: r?.completedAt ?? null,
              rank: r?.rank ?? null,
              points: r?.points ?? null,
              verifiedBy: r?.verifiedBy ?? null,
            };
          })
          .sort((a, b) => Number(b.done) - Number(a.done) || (a.rank ?? 99) - (b.rank ?? 99) || a.user.displayName.localeCompare(b.user.displayName)),
      };
    }),
  };
}

/* ---------------------------------------------------------------- day-plan source */

async function myGroupTasks(db: Tx, userId: string) {
  return db
    .select({ task: groupTasks, groupName: groups.name })
    .from(groupTasks)
    .innerJoin(groups, eq(groups.id, groupTasks.groupId))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groupTasks.groupId), eq(groupMembers.userId, userId), eq(groupMembers.status, "active")))
    .where(isNull(groupTasks.archivedAt));
}

function toCandidate(t: GroupTask, groupName: string, day: string, tz: string): DailyCandidate {
  return {
    sourceId: t.id,
    title: t.title,
    url: t.url,
    category: t.category,
    platform: t.platform,
    problemKey: t.problemKey,
    estMinutes: t.estMinutes || defaultMinutes(t.difficulty),
    preferredTime: null,
    label: groupName,
    kind: "due",
    verifyFrom: new Date(localDayBounds(day, tz).start),
    priority: 4,
    dueAt: new Date(localToInstant(day, parseHHMM(t.dueTime), tz)),
    ...(t.kind === "potd" ? { verification: { provider: "leetcode" as const, mode: "potd" as const, count: 1, difficulty: "Any" as const } } : {}),
    ...(t.kind === "custom" ? { verification: { provider: "none" as const } } : {}),
  };
}

/**
 * Group tasks join every member's day plan on the days they occur. They are "due" work (never
 * moved by the load guard) and can't be swapped for something else.
 */
export const groupDailySource: DailySource = {
  key: "group",
  fixed: true,
  async desired(ctx: DayContext) {
    const closed = new Set(ctx.todays.filter((t) => ["completed", "cancelled", "skipped"].includes(t.status)).map((t) => t.sourceId));
    return (await myGroupTasks(ctx.db, ctx.userId))
      .filter(({ task }) => occursOn(task, ctx.day) && !closed.has(task.id))
      .map(({ task, groupName }) => toCandidate(task, groupName, ctx.day, ctx.tz));
  },
  async onComplete(s, task, verified) {
    const gt = await s.db.query.groupTasks.findFirst({ where: eq(groupTasks.id, task.sourceId!) });
    if (!gt) return;
    // The accepted submission's time when verified; otherwise when it was ticked.
    const completedAt = (await finishedAt(s.db, task.id)) ?? new Date(s.now());
    await recordGroupTaskPoints(s.db, {
      groupId: gt.groupId,
      userId: task.ownerId,
      groupTaskId: gt.id,
      occurrence: task.planDay ?? instantToLocalDate(s.now(), await tzOf(s.db, task.ownerId)),
      completedAt,
      verifiedBy: verified ? "submission" : "self",
      base: gt.points,
    });
  },
  async forecast(ctx, days) {
    const mine = await myGroupTasks(ctx.db, ctx.userId);
    const out: ForecastEntry[] = [];
    for (const day of days) {
      for (const { task, groupName } of mine) if (occursOn(task, day)) out.push({ day, candidate: toCandidate(task, groupName, day, ctx.tz) });
    }
    return out;
  },
};
