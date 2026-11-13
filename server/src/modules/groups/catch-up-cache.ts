import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { instantToLocalDate } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import type { Tx } from "../../core/db/index.js";
import { groupRoadmapDays, groupRoadmaps, itemProgress, roadmapItems } from "../../core/db/schema.js";
import { badRequest, notFound } from "../../core/http.js";
import { markItemDone } from "../roadmaps/service.js";
import { requireMember } from "./service.js";

/**
 * "Previous items": the items an assigned roadmap covered before a member joined, which they can
 * tick off on their own (no points: they were never scheduled for them).
 *
 * Read from memory, not the database, on every view:
 *  - the group's past days never change once scheduled, so each assignment's past schedule (with
 *    item titles) is loaded once and only reloaded when a later day is needed;
 *  - which of those items a member has finished is loaded once per member and roadmap, then kept
 *    current by the roadmap.item_done / follow.changed events (wired in groups/index.ts).
 * Ticks are always written to the database first (item_progress); this is only a read cache.
 * Entries unused for 30 minutes are dropped. One backend process only: see docs/LIMITATIONS.md.
 */

const TTL_MS = 30 * 60_000;

interface PastItem {
  itemId: string;
  day: string;
  title: string;
  url: string | null;
  category: string;
  difficulty: string | null;
  estMinutes: number;
}
interface PastSchedule {
  /** Every scheduled day before this one is included. */
  before: string;
  items: PastItem[];
}

class TtlCache<V> {
  private map = new Map<string, { value: V; usedAt: number }>();
  get(key: string, now: number): V | undefined {
    this.sweep(now);
    const hit = this.map.get(key);
    if (!hit) return undefined;
    hit.usedAt = now;
    return hit.value;
  }
  set(key: string, value: V, now: number) {
    this.map.set(key, { value, usedAt: now });
  }
  delete(key: string) {
    this.map.delete(key);
  }
  /** Updates an entry in place if it's cached (never loads one). */
  peek(key: string): V | undefined {
    return this.map.get(key)?.value;
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
  private sweep(now: number) {
    for (const [k, v] of this.map) if (now - v.usedAt > TTL_MS) this.map.delete(k);
  }
}

const schedules = new TtlCache<PastSchedule>();
const finished = new TtlCache<Set<string>>();
const doneKey = (userId: string, roadmapId: string) => `${userId}:${roadmapId}`;

/** Database reads made by this cache (tests check that repeat views don't add any). */
export const catchUpStats = { loads: 0 };

/** For tests: start from an empty cache. */
export function resetCatchUpCache() {
  schedules.clear();
  finished.clear();
  catchUpStats.loads = 0;
}

async function pastSchedule(db: Tx, assignmentId: string, before: string, now: number): Promise<PastSchedule> {
  const cached = schedules.get(assignmentId, now);
  if (cached && cached.before >= before) return cached;
  catchUpStats.loads += 1;
  const rows = await db
    .select({ day: groupRoadmapDays.day, itemIds: groupRoadmapDays.itemIds })
    .from(groupRoadmapDays)
    .where(and(eq(groupRoadmapDays.assignmentId, assignmentId), lt(groupRoadmapDays.day, before)))
    .orderBy(asc(groupRoadmapDays.day));
  const ids = rows.flatMap((r) => r.itemIds);
  const details = ids.length ? await db.select().from(roadmapItems).where(inArray(roadmapItems.id, ids)) : [];
  const items: PastItem[] = [];
  for (const r of rows) {
    for (const id of r.itemIds) {
      const it = details.find((d) => d.id === id);
      if (!it) continue; // removed from the roadmap since
      items.push({ itemId: id, day: r.day, title: it.title, url: it.url, category: it.category, difficulty: it.difficulty, estMinutes: it.estMinutes });
    }
  }
  const value = { before, items };
  schedules.set(assignmentId, value, now);
  return value;
}

async function finishedItems(db: Tx, userId: string, roadmapId: string, now: number): Promise<Set<string>> {
  const key = doneKey(userId, roadmapId);
  const cached = finished.get(key, now);
  if (cached) return cached;
  catchUpStats.loads += 1;
  const rows = await db
    .select({ itemId: itemProgress.itemId })
    .from(itemProgress)
    .innerJoin(roadmapItems, eq(roadmapItems.id, itemProgress.itemId))
    .where(and(eq(itemProgress.userId, userId), eq(roadmapItems.roadmapId, roadmapId), eq(itemProgress.status, "done")));
  const set = new Set(rows.map((r) => r.itemId));
  finished.set(key, set, now);
  return set;
}

/** Keeps cached progress current: an item was finished (it's already saved). */
export function noteItemDone(userId: string, roadmapId: string, itemId: string) {
  finished.peek(doneKey(userId, roadmapId))?.add(itemId);
}

/** Progress changed in a way we can't patch in place (an item put back, a follow changed). */
export function forgetProgress(userId: string, roadmapId: string) {
  finished.delete(doneKey(userId, roadmapId));
}

async function assignmentFor(s: Services, userId: string, groupId: string, assignmentId: string) {
  const member = await requireMember(s.db, groupId, userId);
  const a = await s.db.query.groupRoadmaps.findFirst({ where: and(eq(groupRoadmaps.id, assignmentId), eq(groupRoadmaps.groupId, groupId)) });
  if (!a) throw notFound("Assigned roadmap");
  return { a, joinDay: instantToLocalDate(member.joinedAt.getTime(), a.timezone) };
}

export async function previousItems(s: Services, userId: string, groupId: string, assignmentId: string) {
  const { a, joinDay } = await assignmentFor(s, userId, groupId, assignmentId);
  const now = s.now();
  const past = await pastSchedule(s.db, a.id, joinDay, now);
  const done = await finishedItems(s.db, userId, a.roadmapId, now);
  const items = past.items.filter((i) => i.day < joinDay).map((i) => ({ ...i, done: done.has(i.itemId) }));
  return { joinedOn: joinDay, done: items.filter((i) => i.done).length, items };
}

/** Tick a previous item. Saved like any roadmap item (problems need an accepted submission). */
export async function completePreviousItem(s: Services, userId: string, groupId: string, assignmentId: string, itemId: string) {
  const { a, joinDay } = await assignmentFor(s, userId, groupId, assignmentId);
  const past = await pastSchedule(s.db, a.id, joinDay, s.now());
  if (!past.items.some((i) => i.itemId === itemId && i.day < joinDay)) throw badRequest("That item isn't one of your previous items", "not_previous");
  const r = await markItemDone(s, userId, itemId);
  noteItemDone(userId, a.roadmapId, itemId);
  return r;
}
