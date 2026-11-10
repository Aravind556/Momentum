import { and, asc, eq, inArray } from "drizzle-orm";
import { newItemsOn, REVIEW_RATINGS, revisionConfig, SM2_NEW_CARD, sm2DueDate, sm2Review, type FollowSettings } from "@momentum/shared";
import type { Tx } from "../../core/db/index.js";
import { externalEvents, itemProgress, reviews, roadmapFollows, roadmapItems, roadmaps, tasks } from "../../core/db/schema.js";
import type { DailyCandidate, DailySource, DayContext, ForecastEntry } from "../planning/sources.js";
import { ACCEPTED, type SubmissionData } from "../platforms/types.js";
import type { Task } from "../tasks/tasks.js";
import { finishedAt } from "../tasks/completions.js";
import { completeItem, type RoadmapItem } from "./service.js";

interface FollowRow {
  roadmapId: string;
  title: string;
  settings: FollowSettings;
  startedAt: Date;
}

async function activeFollows(db: Tx, userId: string): Promise<FollowRow[]> {
  return db
    .select({ roadmapId: roadmapFollows.roadmapId, title: roadmaps.title, settings: roadmapFollows.settings, startedAt: roadmapFollows.startedAt })
    .from(roadmapFollows)
    .innerJoin(roadmaps, eq(roadmaps.id, roadmapFollows.roadmapId))
    .where(and(eq(roadmapFollows.userId, userId), eq(roadmapFollows.active, true)))
    .orderBy(asc(roadmapFollows.startedAt));
}

/** The items each followed roadmap still has queued for this learner, in roadmap order. */
async function queues(db: Tx, userId: string, follows: FollowRow[]) {
  const ids = follows.map((f) => f.roadmapId);
  if (!ids.length) return new Map<string, RoadmapItem[]>();
  const items = await db.select().from(roadmapItems).where(inArray(roadmapItems.roadmapId, ids)).orderBy(asc(roadmapItems.position));
  const progress = items.length
    ? await db.select({ itemId: itemProgress.itemId, status: itemProgress.status }).from(itemProgress).where(and(eq(itemProgress.userId, userId), inArray(itemProgress.itemId, items.map((i) => i.id))))
    : [];
  const finished = new Set(progress.filter((p) => p.status === "done" || p.status === "skipped").map((p) => p.itemId));
  const out = new Map<string, RoadmapItem[]>();
  for (const it of items) if (!finished.has(it.id)) (out.get(it.roadmapId) ?? out.set(it.roadmapId, []).get(it.roadmapId)!).push(it);
  return out;
}

async function roadmapsOfItems(db: Tx, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, string>();
  const rows = await db.select({ id: roadmapItems.id, roadmapId: roadmapItems.roadmapId }).from(roadmapItems).where(inArray(roadmapItems.id, itemIds));
  return new Map(rows.map((r) => [r.id, r.roadmapId]));
}

/** Latest accepted submission time per "platform:problemKey" (from synced history). */
async function solvedAt(db: Tx, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ provider: externalEvents.provider, occurredAt: externalEvents.occurredAt, data: externalEvents.data })
    .from(externalEvents)
    .where(and(eq(externalEvents.userId, userId), eq(externalEvents.type, ACCEPTED)));
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.provider}:${(r.data as SubmissionData).problemKey}`;
    out.set(k, Math.max(out.get(k) ?? 0, r.occurredAt.getTime()));
  }
  return out;
}

function toCandidate(it: RoadmapItem, f: FollowRow): DailyCandidate {
  return {
    sourceId: it.id,
    title: it.title,
    url: it.url,
    category: it.category,
    platform: it.platform,
    problemKey: it.problemKey,
    estMinutes: it.estMinutes,
    preferredTime: f.settings.preferredTime,
    label: f.title,
    kind: "new",
    verifyFrom: f.startedAt,
    priority: 2,
  };
}

/** Items that can't come back today: finished, skipped or swapped out today. */
const closedToday = (todays: Task[]) => new Set(todays.filter((t) => ["completed", "cancelled", "skipped"].includes(t.status)).map((t) => t.sourceId));

/**
 * New roadmap items for the day: for each active follow, as many queued items as its pace allows
 * on this weekday. Items finished today and items the learner pinned (swapped in) count toward
 * that number, so completing or swapping never pulls in extra work.
 * Problems already solved on the platform are marked done (and start revisions) instead of being planned.
 */
export const roadmapDailySource: DailySource = {
  key: "roadmap",
  async desired(ctx: DayContext) {
    const follows = await activeFollows(ctx.db, ctx.userId);
    if (!follows.length) return [];
    const queued = await queues(ctx.db, ctx.userId, follows);
    const solved = await solvedAt(ctx.db, ctx.userId);
    const closed = closedToday(ctx.todays);
    const roadmapOf = await roadmapsOfItems(ctx.db, ctx.todays.map((t) => t.sourceId!).filter(Boolean));
    const out: DailyCandidate[] = [];
    for (const f of follows) {
      const items = queued.get(f.roadmapId) ?? [];
      const mine = ctx.todays.filter((t) => roadmapOf.get(t.sourceId!) === f.roadmapId);
      const pinned = mine.filter((t) => t.pinned && !["cancelled", "skipped", "completed"].includes(t.status));
      // Finished, skipped and pinned work all use up today's quota — skipping never pulls in more.
      const used = mine.filter((t) => t.status === "completed" || t.status === "skipped").length + pinned.length;
      let remaining = newItemsOn(f.settings, ctx.day) - used;
      for (const t of pinned) {
        const it = items.find((i) => i.id === t.sourceId);
        if (it) out.push(toCandidate(it, f));
      }
      for (const it of items) {
        if (remaining <= 0) break;
        if (closed.has(it.id) || pinned.some((t) => t.sourceId === it.id)) continue;
        // Already solved (any time — an accepted submission is an accepted submission): mark it done
        // and let spaced repetition bring it back, instead of planning it as new.
        const solvedAt = it.platform && it.problemKey ? solved.get(`${it.platform}:${it.problemKey}`) : undefined;
        if (solvedAt !== undefined) {
          ctx.after.push(() => completeItem(ctx.s, ctx.userId, it.id, "submission", new Date(solvedAt)));
          continue;
        }
        out.push(toCandidate(it, f));
        remaining -= 1;
      }
    }
    return out;
  },
  async onComplete(s, task, verified) {
    if (task.sourceId) await completeItem(s, task.ownerId, task.sourceId, verified ? "submission" : "self", (await finishedAt(s.db, task.id)) ?? undefined);
  },
  async swapOptions(ctx, task) {
    const follows = await activeFollows(ctx.db, ctx.userId);
    const queued = await queues(ctx.db, ctx.userId, follows);
    const onPlan = new Set(ctx.todays.map((t) => t.sourceId));
    const out: DailyCandidate[] = [];
    for (const f of follows) {
      const options = (queued.get(f.roadmapId) ?? []).filter((it) => it.category === task.category && !onPlan.has(it.id)).slice(0, 3);
      for (const it of options) out.push(toCandidate(it, f));
    }
    return out.slice(0, 10);
  },
};

/* ---------------------------------------------------------------- forecast */

interface SimCard {
  ef: number;
  reps: number;
  baseInterval: number;
  dueDate: string;
  multiplier: number;
  maxPerDay: number;
  roadmapId: string | null;
  candidate: DailyCandidate;
}

/**
 * Simulates the coming days for roadmaps *and* the revisions they produce, since the two interact:
 * every new item learned becomes a revision card. (The review source therefore has no forecast of
 * its own.) Assumes today's plan is done and every revision is rated "Good".
 */
roadmapDailySource.forecast = async (ctx, days) => {
  const follows = await activeFollows(ctx.db, ctx.userId);
  const queued = await queues(ctx.db, ctx.userId, follows);
  const onToday = new Set(ctx.todays.map((t) => t.sourceId));
  const reviewToday = new Set(
    (await ctx.db.select({ sourceId: tasks.sourceId }).from(tasks).where(and(eq(tasks.ownerId, ctx.userId), eq(tasks.planDay, ctx.day), eq(tasks.source, "review")))).map((r) => r.sourceId),
  );

  // Existing revision cards (active follows or free-standing), with today's planned ones reviewed today.
  const cardRows = await ctx.db
    .select({ card: reviews, roadmapId: roadmapItems.roadmapId, roadmapTitle: roadmaps.title, itemMinutes: roadmapItems.estMinutes, active: roadmapFollows.active })
    .from(reviews)
    .leftJoin(roadmapItems, eq(roadmapItems.id, reviews.itemId))
    .leftJoin(roadmaps, eq(roadmaps.id, roadmapItems.roadmapId))
    .leftJoin(roadmapFollows, and(eq(roadmapFollows.roadmapId, roadmapItems.roadmapId), eq(roadmapFollows.userId, ctx.userId)))
    .where(and(eq(reviews.userId, ctx.userId), eq(reviews.suspended, false)));
  const cards: SimCard[] = [];
  for (const r of cardRows) {
    if (r.card.itemId && r.active !== true) continue;
    const c: SimCard = {
      ef: r.card.ef,
      reps: r.card.reps,
      baseInterval: r.card.baseInterval,
      dueDate: r.card.dueDate,
      multiplier: r.card.multiplier,
      maxPerDay: r.card.maxPerDay,
      roadmapId: r.roadmapId,
      candidate: revisionCandidate(r.card.id, r.card.title, r.card.url, r.card.category, r.card.platform, r.card.problemKey, r.itemMinutes, r.roadmapTitle),
    };
    if (reviewToday.has(r.card.id)) review(c, ctx.day);
    cards.push(c);
  }

  // Queues without what's already on today's plan (assumed done today — so it's revised later too).
  const queue = new Map(follows.map((f) => [f.roadmapId, (queued.get(f.roadmapId) ?? []).filter((i) => !onToday.has(i.id))]));
  for (const f of follows) {
    const rev = revisionConfig(f.settings);
    if (!rev) continue;
    for (const it of (queued.get(f.roadmapId) ?? []).filter((i) => onToday.has(i.id))) {
      cards.push({
        ...LEARNED,
        dueDate: sm2DueDate(ctx.day, LEARNED.baseInterval, rev.multiplier),
        multiplier: rev.multiplier,
        maxPerDay: rev.maxPerDay,
        roadmapId: f.roadmapId,
        candidate: revisionCandidate(`sim:${it.id}`, it.title, it.url, it.category, it.platform, it.problemKey, it.estMinutes, f.title),
      });
    }
  }
  const out: ForecastEntry[] = [];
  for (const day of days) {
    // 1. Revisions due, capped per roadmap and per day.
    let cap = ctx.prefs.planning.dailyReviewCap;
    const perRoadmap = new Map<string, number>();
    let minutes = 0;
    for (const c of [...cards].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
      if (cap <= 0) break;
      if (c.dueDate > day) continue;
      const key = c.roadmapId ?? "none";
      if ((perRoadmap.get(key) ?? 0) >= c.maxPerDay) continue;
      perRoadmap.set(key, (perRoadmap.get(key) ?? 0) + 1);
      cap -= 1;
      minutes += c.candidate.estMinutes;
      out.push({ day, candidate: c.candidate });
      review(c, day);
    }
    // 2. New items by pace, within the study limit and the day's free time; the rest wait.
    let budget = Math.min(ctx.prefs.planning.maxStudyMinutesPerDay, ctx.capacity?.get(day) ?? Infinity) - minutes;
    for (const f of follows) {
      const items = queue.get(f.roadmapId)!;
      let n = newItemsOn(f.settings, day);
      while (n > 0 && items.length && items[0]!.estMinutes <= budget) {
        const it = items.shift()!;
        n -= 1;
        budget -= it.estMinutes;
        out.push({ day, candidate: toCandidate(it, f) });
        const rev = revisionConfig(f.settings);
        if (rev) {
          cards.push({
            ...LEARNED,
            dueDate: sm2DueDate(day, LEARNED.baseInterval, rev.multiplier),
            multiplier: rev.multiplier,
            maxPerDay: rev.maxPerDay,
            roadmapId: f.roadmapId,
            candidate: revisionCandidate(`sim:${it.id}`, it.title, it.url, it.category, it.platform, it.problemKey, it.estMinutes, f.title),
          });
        }
      }
    }
  }
  return out;
};

/** A card right after first learning (same as the repetition module's initial state). */
const LEARNED = sm2Review(SM2_NEW_CARD, REVIEW_RATINGS.good);

function review(c: SimCard, day: string) {
  const next = sm2Review(c, REVIEW_RATINGS.good);
  Object.assign(c, next, { dueDate: sm2DueDate(day, next.baseInterval, c.multiplier) });
}

function revisionCandidate(
  id: string,
  title: string,
  url: string | null,
  category: string,
  platform: string | null,
  problemKey: string | null,
  itemMinutes: number | null,
  roadmapTitle: string | null,
): DailyCandidate {
  return {
    sourceId: id,
    title,
    url,
    category,
    platform,
    problemKey,
    estMinutes: Math.max(15, Math.round(((itemMinutes ?? 30) * 0.6) / 5) * 5),
    preferredTime: null,
    label: roadmapTitle ? `Revision · ${roadmapTitle}` : "Revision",
    kind: "due",
    verifyFrom: new Date(0),
    priority: 3,
  };
}
