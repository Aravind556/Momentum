import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  addDays,
  basePoints,
  followSettingsSchema,
  groupDaysBetween,
  groupRoadmapInputSchema,
  groupRoadmapPatchSchema,
  instantToLocalDate,
  localDayBounds,
  localToInstant,
  nextGroupSlice,
  parseHHMM,
  revisionConfig,
  type RevisionConfig,
} from "@momentum/shared";
import type { Services } from "../../core/context.js";
import type { Tx } from "../../core/db/index.js";
import { groupMembers, groupPoints, groupRoadmapDays, groupRoadmaps, groups, itemProgress, roadmapItems, roadmaps, roadmapShares } from "../../core/db/schema.js";
import { conflict, forbidden, notFound } from "../../core/http.js";
import { tzOf } from "../planning/schedules.js";
import type { DailyCandidate, DailySource, DayContext, ForecastEntry } from "../planning/sources.js";
import { profilesByIds, publicProfile } from "../profile/service.js";
import { solvedAt } from "../roadmaps/daily-source.js";
import { completeItem, requireViewable } from "../roadmaps/service.js";
import { finishedAt } from "../tasks/completions.js";
import { recordAssignedItemPoints } from "./points.js";
import { activeMemberIds, requireMember } from "./service.js";

/**
 * Roadmaps assigned to a group: an admin picks a roadmap and one pace for everyone. On every group
 * day the next items become that day's work for every member (same items, a due time, points with
 * first-finisher bonuses). Missed items stay on the member's plan as overdue until done or skipped.
 *
 * Each group day's items are fixed the first time that day is needed (group_roadmap_days), so the
 * whole group always sees the same items and later edits to the roadmap don't rewrite past days.
 * Progress is the learner's ordinary roadmap progress (item_progress): finishing an item here or
 * through a personal follow of the same roadmap counts for both.
 */

export type Assignment = typeof groupRoadmaps.$inferSelect;
type DayRow = { day: string; itemIds: string[] };

/** At most this many overdue items per assignment on a member's day plan. */
const MAX_OVERDUE = 10;

async function requireAdmin(db: Tx, groupId: string, userId: string) {
  const m = await requireMember(db, groupId, userId);
  if (m.role === "member") throw forbidden("Only the group's owner or admins can assign roadmaps");
  return m;
}

async function requireAssignment(db: Tx, groupId: string, assignmentId: string): Promise<Assignment> {
  const a = await db.query.groupRoadmaps.findFirst({ where: and(eq(groupRoadmaps.id, assignmentId), eq(groupRoadmaps.groupId, groupId)) });
  if (!a) throw notFound("Assigned roadmap");
  return a;
}

/** Revisions for members without a personal follow, from the assignment's setting. */
export function groupRevision(a: Pick<Assignment, "revision">): RevisionConfig | null {
  return revisionConfig(followSettingsSchema.parse({ revision: a.revision }));
}

/** The group's own calendar day right now. */
const groupToday = (s: Services, a: Pick<Assignment, "timezone">) => instantToLocalDate(s.now(), a.timezone);

/** The member's first group day: the day they joined, on the group's calendar. */
const joinDayOf = (joinedAt: Date, a: Pick<Assignment, "timezone">) => instantToLocalDate(joinedAt.getTime(), a.timezone);

/* ---------------------------------------------------------------- admin actions */

export async function assignRoadmap(s: Services, userId: string, groupId: string, raw: unknown) {
  await requireAdmin(s.db, groupId, userId);
  const input = groupRoadmapInputSchema.parse(raw);
  const roadmap = await requireViewable(s.db, userId, input.roadmapId);
  if (roadmap.archivedAt) throw conflict("Archived roadmaps can't be assigned", "archived");
  const timezone = await tzOf(s.db, userId);
  const values = {
    itemsPerDay: input.itemsPerDay,
    weekdays: [...new Set(input.weekdays)].sort(),
    startDate: input.startDate,
    dueTime: input.dueTime,
    revision: input.revision,
    timezone,
    status: "active" as const,
    assignedBy: userId,
  };
  const existing = await s.db.query.groupRoadmaps.findFirst({ where: and(eq(groupRoadmaps.groupId, groupId), eq(groupRoadmaps.roadmapId, input.roadmapId)) });
  let row: Assignment;
  if (existing) {
    if (existing.status !== "ended") throw conflict("This roadmap is already assigned to the group", "already_assigned");
    // Re-assigning an ended one continues after the items it already covered.
    [row] = (await s.db.update(groupRoadmaps).set(values).where(eq(groupRoadmaps.id, existing.id)).returning()) as [Assignment];
  } else {
    [row] = (await s.db.insert(groupRoadmaps).values({ groupId, roadmapId: input.roadmapId, ...values, createdAt: new Date(s.now()) }).returning()) as [Assignment];
  }
  // Members need to be able to open the roadmap.
  await s.db.insert(roadmapShares).values({ roadmapId: input.roadmapId, groupId, sharedBy: userId }).onConflictDoNothing();
  await s.events.emit("group.tasks_changed", { groupId });
  return row;
}

/** Pace, due time, revisions, pause/resume. Changes apply to group days not scheduled yet. */
export async function updateAssignment(s: Services, userId: string, groupId: string, assignmentId: string, raw: unknown) {
  await requireAdmin(s.db, groupId, userId);
  const a = await requireAssignment(s.db, groupId, assignmentId);
  if (a.status === "ended") throw conflict("This assignment has ended", "ended");
  const patch = groupRoadmapPatchSchema.parse(raw);
  const set: Partial<Assignment> = {};
  if (patch.itemsPerDay !== undefined) set.itemsPerDay = patch.itemsPerDay;
  if (patch.weekdays !== undefined) set.weekdays = [...new Set(patch.weekdays)].sort();
  if (patch.dueTime !== undefined) set.dueTime = patch.dueTime;
  if (patch.revision !== undefined) set.revision = patch.revision;
  if (patch.status && patch.status !== a.status) {
    set.status = patch.status;
    // Resuming continues from today: the paused days are simply skipped.
    if (patch.status === "active") {
      const today = groupToday(s, a);
      if (today > a.startDate) set.startDate = today;
    }
  }
  const [row] = await s.db.update(groupRoadmaps).set(set).where(eq(groupRoadmaps.id, a.id)).returning();
  await s.events.emit("group.tasks_changed", { groupId });
  return row!;
}

/** Ends an assignment. Progress and points already earned stay. */
export async function endAssignment(s: Services, userId: string, groupId: string, assignmentId: string) {
  await requireAdmin(s.db, groupId, userId);
  const a = await requireAssignment(s.db, groupId, assignmentId);
  await s.db.update(groupRoadmaps).set({ status: "ended" }).where(eq(groupRoadmaps.id, a.id));
  await s.events.emit("group.tasks_changed", { groupId });
  return { ok: true };
}

/* ---------------------------------------------------------------- the group schedule */

async function scheduledDays(db: Tx, assignmentId: string): Promise<DayRow[]> {
  return db
    .select({ day: groupRoadmapDays.day, itemIds: groupRoadmapDays.itemIds })
    .from(groupRoadmapDays)
    .where(eq(groupRoadmapDays.assignmentId, assignmentId))
    .orderBy(asc(groupRoadmapDays.day));
}

/**
 * Fixes the items of every group day up to `through` that doesn't have them yet, and returns the
 * whole schedule. Safe to run concurrently: a day is written once (unique per assignment and day).
 */
export async function scheduleThrough(db: Tx, a: Assignment, through: string): Promise<DayRow[]> {
  const rows = await scheduledDays(db, a.id);
  if (a.status !== "active") return rows;
  const last = rows.at(-1)?.day;
  const from = last && addDays(last, 1) > a.startDate ? addDays(last, 1) : a.startDate;
  const days = groupDaysBetween(from, through, a.weekdays);
  if (!days.length) return rows;

  const order = (await db.select({ id: roadmapItems.id }).from(roadmapItems).where(eq(roadmapItems.roadmapId, a.roadmapId)).orderBy(asc(roadmapItems.position))).map((r) => r.id);
  const scheduled = new Set(rows.flatMap((r) => r.itemIds));
  const fresh: DayRow[] = [];
  for (const day of days) {
    const slice = nextGroupSlice(order, scheduled, a.itemsPerDay);
    if (!slice.length) break; // the roadmap is finished
    for (const id of slice) scheduled.add(id);
    fresh.push({ day, itemIds: slice });
  }
  if (!fresh.length) return rows;
  const inserted = await db
    .insert(groupRoadmapDays)
    .values(fresh.map((f) => ({ assignmentId: a.id, ...f })))
    .onConflictDoNothing()
    .returning({ day: groupRoadmapDays.day, itemIds: groupRoadmapDays.itemIds });
  if (inserted.length) await creditEarlyFinishers(db, a, inserted);
  return inserted.length === fresh.length ? [...rows, ...fresh] : scheduledDays(db, a.id);
}

/**
 * Members who already finished an item (say, through their personal follow) before its group day
 * was scheduled: it counts for the group as done, with points, the moment the day is scheduled.
 */
async function creditEarlyFinishers(db: Tx, a: Assignment, rows: DayRow[]) {
  const ids = rows.flatMap((r) => r.itemIds);
  const members = await db
    .select({ userId: groupMembers.userId, joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, a.groupId), eq(groupMembers.status, "active")));
  if (!ids.length || !members.length) return;
  const done = await db
    .select({ userId: itemProgress.userId, itemId: itemProgress.itemId, doneAt: itemProgress.doneAt, verifiedBy: itemProgress.verifiedBy })
    .from(itemProgress)
    .where(and(inArray(itemProgress.itemId, ids), inArray(itemProgress.userId, members.map((m) => m.userId)), eq(itemProgress.status, "done")));
  if (!done.length) return;
  const group = await db.query.groups.findFirst({ where: eq(groups.id, a.groupId) });
  const items = await db.select({ id: roadmapItems.id, difficulty: roadmapItems.difficulty }).from(roadmapItems).where(inArray(roadmapItems.id, ids));
  for (const d of done) {
    const row = rows.find((r) => r.itemIds.includes(d.itemId))!;
    const member = members.find((m) => m.userId === d.userId)!;
    if (row.day < joinDayOf(member.joinedAt, a)) continue;
    await recordAssignedItemPoints(db, {
      groupId: a.groupId,
      userId: d.userId,
      itemId: d.itemId,
      day: row.day,
      dayEnd: localDayBounds(row.day, a.timezone).end,
      completedAt: d.doneAt ?? new Date(),
      verifiedBy: d.verifiedBy ?? "self",
      base: basePoints(items.find((i) => i.id === d.itemId)?.difficulty ?? null, group?.points),
    });
  }
}

/** Active assignments in the groups the user is an active member of. */
async function myAssignments(db: Tx, userId: string) {
  return db
    .select({ a: groupRoadmaps, groupName: groups.name, roadmapTitle: roadmaps.title, joinedAt: groupMembers.joinedAt })
    .from(groupRoadmaps)
    .innerJoin(groups, eq(groups.id, groupRoadmaps.groupId))
    .innerJoin(roadmaps, eq(roadmaps.id, groupRoadmaps.roadmapId))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groupRoadmaps.groupId), eq(groupMembers.userId, userId), eq(groupMembers.status, "active")))
    .where(eq(groupRoadmaps.status, "active"))
    .orderBy(asc(groupRoadmaps.createdAt));
}

/** Items the user has finished or skipped (personal or group — it's the same progress). */
async function closedItems(db: Tx, userId: string, itemIds: string[]): Promise<Set<string>> {
  if (!itemIds.length) return new Set();
  const rows = await db
    .select({ itemId: itemProgress.itemId })
    .from(itemProgress)
    .where(and(eq(itemProgress.userId, userId), inArray(itemProgress.itemId, itemIds), ne(itemProgress.status, "active")));
  return new Set(rows.map((r) => r.itemId));
}

/**
 * What a member owes on `day` for each assignment: that day's items and, oldest first, earlier
 * ones still open since they joined (overdue). Items from before they joined are never included.
 */
async function memberWork(db: Tx, userId: string, day: string) {
  const out: Array<{ a: Assignment; groupName: string; roadmapTitle: string; today: string[]; overdue: string[] }> = [];
  for (const { a, groupName, roadmapTitle, joinedAt } of await myAssignments(db, userId)) {
    const rows = (await scheduleThrough(db, a, day)).filter((r) => r.day >= joinDayOf(joinedAt, a) && r.day <= day);
    const ids = rows.flatMap((r) => r.itemIds);
    const closed = await closedItems(db, userId, ids);
    const open = (r: DayRow) => r.itemIds.filter((id) => !closed.has(id));
    out.push({
      a,
      groupName,
      roadmapTitle,
      today: rows.filter((r) => r.day === day).flatMap(open),
      overdue: rows.filter((r) => r.day < day).flatMap(open).slice(0, MAX_OVERDUE),
    });
  }
  return out;
}

/** For the personal roadmap source: items the group already puts on this member's day. */
export async function itemsPlannedByGroups(db: Tx, userId: string, day: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const w of await memberWork(db, userId, day)) for (const id of [...w.today, ...w.overdue]) out.add(id);
  return out;
}

/* ---------------------------------------------------------------- day-plan source */

type ItemRow = typeof roadmapItems.$inferSelect;

function toCandidate(it: ItemRow, w: { a: Assignment; groupName: string; roadmapTitle: string }, day: string, tz: string, overdue: boolean): DailyCandidate {
  return {
    sourceId: it.id,
    title: it.title,
    url: it.url,
    category: it.category,
    platform: it.platform,
    problemKey: it.problemKey,
    estMinutes: it.estMinutes,
    preferredTime: null,
    label: `${overdue ? "Overdue · " : ""}${w.groupName} · ${w.roadmapTitle}`,
    kind: "due",
    verifyFrom: w.a.createdAt,
    priority: overdue ? 3 : 4,
    ...(overdue ? {} : { dueAt: new Date(localToInstant(day, parseHHMM(w.a.dueTime), tz)) }),
  };
}

export const assignedRoadmapSource: DailySource = {
  key: "group-roadmap",
  fixed: true,
  async desired(ctx: DayContext) {
    const work = await memberWork(ctx.db, ctx.userId, ctx.day);
    const ids = [...new Set(work.flatMap((w) => [...w.today, ...w.overdue]))];
    if (!ids.length) return [];
    const items = new Map((await ctx.db.select().from(roadmapItems).where(inArray(roadmapItems.id, ids))).map((i) => [i.id, i]));
    const solved = await solvedAt(ctx.db, ctx.userId);
    // Skipped or swapped out today: back tomorrow (as overdue), not again today.
    const closedToday = new Set(ctx.todays.filter((t) => ["completed", "cancelled", "skipped"].includes(t.status)).map((t) => t.sourceId));
    const seen = new Set<string>();
    const out: DailyCandidate[] = [];
    for (const w of work) {
      for (const [list, overdue] of [[w.today, false], [w.overdue, true]] as const) {
        for (const id of list) {
          const it = items.get(id);
          if (!it || seen.has(id) || closedToday.has(id)) continue;
          seen.add(id);
          // Already solved on the platform: it's done (and counts for the group), not new work.
          const at = it.platform && it.problemKey ? solved.get(`${it.platform}:${it.problemKey}`) : undefined;
          if (at !== undefined) {
            ctx.after.push(() => completeItem(ctx.s, ctx.userId, id, "submission", new Date(at), { revision: groupRevision(w.a) }));
            continue;
          }
          out.push(toCandidate(it, w, ctx.day, ctx.tz, overdue));
        }
      }
    }
    return out;
  },
  async onComplete(s, task, verified) {
    if (!task.sourceId) return;
    const item = await s.db.query.roadmapItems.findFirst({ where: eq(roadmapItems.id, task.sourceId) });
    if (!item) return;
    const a = (await myAssignments(s.db, task.ownerId)).find((x) => x.a.roadmapId === item.roadmapId)?.a;
    await completeItem(s, task.ownerId, item.id, verified ? "submission" : "self", (await finishedAt(s.db, task.id)) ?? undefined, {
      revision: a ? groupRevision(a) : null,
    });
  },
  async forecast(ctx, days) {
    const out: ForecastEntry[] = [];
    for (const { a, groupName, roadmapTitle, joinedAt } of await myAssignments(ctx.db, ctx.userId)) {
      // Read-only: simulate the coming group days from what's scheduled so far.
      const rows = await scheduledDays(ctx.db, a.id);
      const order = await ctx.db.select().from(roadmapItems).where(eq(roadmapItems.roadmapId, a.roadmapId)).orderBy(asc(roadmapItems.position));
      const scheduled = new Set(rows.flatMap((r) => r.itemIds));
      const closed = await closedItems(ctx.db, ctx.userId, order.map((i) => i.id));
      const joinDay = joinDayOf(joinedAt, a);
      for (const day of days) {
        if (day < a.startDate || day < joinDay || !a.weekdays.length) continue;
        let ids = rows.find((r) => r.day === day)?.itemIds;
        if (!ids) {
          if (!groupDaysBetween(day, day, a.weekdays).length) continue;
          ids = nextGroupSlice(order.map((i) => i.id), scheduled, a.itemsPerDay);
          for (const id of ids) scheduled.add(id);
        }
        for (const id of ids) {
          const it = order.find((i) => i.id === id);
          if (it && !closed.has(id)) out.push({ day, candidate: toCandidate(it, { a, groupName, roadmapTitle }, day, ctx.tz, false) });
        }
      }
    }
    return out;
  },
};

/* ---------------------------------------------------------------- points */

/**
 * An item was finished (on the day plan, the roadmap page, a personal follow or "Previous items").
 * In every group it's assigned in, on a day since the member joined, it earns points: ranked if
 * done by the end of that group day, base points if late. Items from before they joined: none.
 */
export async function creditAssignedItem(s: Services, e: { userId: string; roadmapId: string; itemId: string; verifiedBy: "submission" | "self"; at: Date }) {
  const mine = await s.db
    .select({ a: groupRoadmaps, joinedAt: groupMembers.joinedAt, points: groups.points })
    .from(groupRoadmaps)
    .innerJoin(groups, eq(groups.id, groupRoadmaps.groupId))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groupRoadmaps.groupId), eq(groupMembers.userId, e.userId), eq(groupMembers.status, "active")))
    .where(eq(groupRoadmaps.roadmapId, e.roadmapId));
  if (!mine.length) return;
  const item = await s.db.query.roadmapItems.findFirst({ where: eq(roadmapItems.id, e.itemId) });
  for (const { a, joinedAt, points } of mine) {
    const [row] = await s.db
      .select({ day: groupRoadmapDays.day })
      .from(groupRoadmapDays)
      .where(and(eq(groupRoadmapDays.assignmentId, a.id), sql`${groupRoadmapDays.itemIds} @> ${JSON.stringify([e.itemId])}::jsonb`))
      .limit(1);
    // Not scheduled yet: credited when its day is scheduled (creditEarlyFinishers).
    if (!row || row.day < joinDayOf(joinedAt, a)) continue;
    await recordAssignedItemPoints(s.db, {
      groupId: a.groupId,
      userId: e.userId,
      itemId: e.itemId,
      day: row.day,
      dayEnd: localDayBounds(row.day, a.timezone).end,
      completedAt: e.at,
      verifiedBy: e.verifiedBy,
      base: basePoints(item?.difficulty ?? null, points),
    });
  }
}

/** Groups where this roadmap is assigned (so shared-roadmap points aren't counted twice). */
export async function groupsAssigningRoadmap(db: Tx, roadmapId: string): Promise<Set<string>> {
  const rows = await db.select({ groupId: groupRoadmaps.groupId }).from(groupRoadmaps).where(eq(groupRoadmaps.roadmapId, roadmapId));
  return new Set(rows.map((r) => r.groupId));
}

/* ---------------------------------------------------------------- group view */

/**
 * Assigned roadmaps of a group: today's items with every member's status, how far the group is,
 * each member's progress since joining, and the viewer's overdue and "previous items" counts.
 */
export async function listAssignments(s: Services, userId: string, groupId: string) {
  const me = await requireMember(s.db, groupId, userId);
  const all = await s.db
    .select({ a: groupRoadmaps, title: roadmaps.title })
    .from(groupRoadmaps)
    .innerJoin(roadmaps, eq(roadmaps.id, groupRoadmaps.roadmapId))
    .where(and(eq(groupRoadmaps.groupId, groupId), ne(groupRoadmaps.status, "ended")))
    .orderBy(asc(groupRoadmaps.createdAt));
  if (!all.length) return [];
  const members = await s.db
    .select({ userId: groupMembers.userId, joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, "active")));
  const people = await profilesByIds(s.db, members.map((m) => m.userId));

  const out = [];
  for (const { a, title } of all) {
    const today = groupToday(s, a);
    const rows = (await scheduleThrough(s.db, a, today)).filter((r) => r.day <= today);
    const total = Number((await s.db.select({ n: sql<number>`count(*)` }).from(roadmapItems).where(eq(roadmapItems.roadmapId, a.roadmapId)))[0]?.n ?? 0);
    const allIds = rows.flatMap((r) => r.itemIds);
    const progress = allIds.length
      ? await s.db
          .select({ userId: itemProgress.userId, itemId: itemProgress.itemId, status: itemProgress.status })
          .from(itemProgress)
          .where(and(inArray(itemProgress.itemId, allIds), inArray(itemProgress.userId, members.map((m) => m.userId))))
      : [];
    const doneBy = (uid: string, id: string) => progress.some((p) => p.userId === uid && p.itemId === id && p.status === "done");
    const closedBy = (uid: string, id: string) => progress.some((p) => p.userId === uid && p.itemId === id && p.status !== "active");
    const todayIds = rows.find((r) => r.day === today)?.itemIds ?? [];
    const todayItems = todayIds.length ? await s.db.select().from(roadmapItems).where(inArray(roadmapItems.id, todayIds)) : [];
    const earned = todayIds.length
      ? await s.db
          .select()
          .from(groupPoints)
          .where(and(eq(groupPoints.groupId, groupId), eq(groupPoints.sourceType, "assigned_item"), inArray(groupPoints.sourceId, todayIds), eq(groupPoints.occurrence, today)))
      : [];
    const myJoin = joinDayOf(me.joinedAt, a);
    const sinceJoin = (join: string) => rows.filter((r) => r.day >= join).flatMap((r) => r.itemIds);

    out.push({
      id: a.id,
      roadmap: { id: a.roadmapId, title },
      itemsPerDay: a.itemsPerDay,
      weekdays: a.weekdays,
      dueTime: a.dueTime,
      revision: a.revision,
      status: a.status,
      startDate: a.startDate,
      timezone: a.timezone,
      day: today,
      total,
      scheduled: allIds.length,
      dueAt: new Date(localToInstant(today, parseHHMM(a.dueTime), a.timezone)).toISOString(),
      today: todayIds.map((id) => {
        const it = todayItems.find((i) => i.id === id);
        return {
          itemId: id,
          title: it?.title ?? "Removed item",
          url: it?.url ?? null,
          category: it?.category ?? "other",
          difficulty: it?.difficulty ?? null,
          estMinutes: it?.estMinutes ?? 0,
          doneCount: members.filter((m) => doneBy(m.userId, id)).length,
          members: members
            .filter((m) => joinDayOf(m.joinedAt, a) <= today)
            .map((m) => {
              const p = earned.find((e) => e.userId === m.userId && e.sourceId === id);
              return {
                user: publicProfile(people.get(m.userId)!),
                done: doneBy(m.userId, id),
                completedAt: p?.completedAt ?? null,
                rank: p?.rank ?? null,
                points: p?.points ?? null,
                verifiedBy: p?.verifiedBy ?? null,
              };
            })
            .sort((x, y) => Number(y.done) - Number(x.done) || (x.rank ?? 99) - (y.rank ?? 99) || x.user.displayName.localeCompare(y.user.displayName)),
        };
      }),
      members: members
        .map((m) => {
          const ids = sinceJoin(joinDayOf(m.joinedAt, a));
          return { user: publicProfile(people.get(m.userId)!), done: ids.filter((id) => doneBy(m.userId, id)).length, of: ids.length };
        })
        .sort((x, y) => y.done - x.done || x.user.displayName.localeCompare(y.user.displayName)),
      myOverdue: rows.filter((r) => r.day >= myJoin && r.day < today).flatMap((r) => r.itemIds).filter((id) => !closedBy(userId, id)).length,
      previousCount: rows.filter((r) => r.day < myJoin).reduce((n, r) => n + r.itemIds.length, 0),
    });
  }
  return out;
}
