import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { addDays, instantToLocalDate, localDayBounds } from "@momentum/shared";
import type { Tx } from "../../core/db/index.js";
import { reviews, roadmapFollows, roadmapItems, roadmaps } from "../../core/db/schema.js";
import type { DailyCandidate, DailySource, DayContext } from "../planning/sources.js";
import { tzOf } from "../planning/schedules.js";
import { recordReview, type Review } from "./service.js";

interface CardRow {
  card: Review;
  roadmapId: string | null;
  roadmapTitle: string | null;
  itemMinutes: number | null;
  followActive: boolean | null;
}

/** Cards due by `until`, soonest first, with their roadmap; skips roadmaps that are paused or unfollowed. */
async function dueCards(db: Tx, userId: string, until: string): Promise<CardRow[]> {
  const rows = await db
    .select({
      card: reviews,
      roadmapId: roadmaps.id,
      roadmapTitle: roadmaps.title,
      itemMinutes: roadmapItems.estMinutes,
      followActive: roadmapFollows.active,
    })
    .from(reviews)
    .leftJoin(roadmapItems, eq(roadmapItems.id, reviews.itemId))
    .leftJoin(roadmaps, eq(roadmaps.id, roadmapItems.roadmapId))
    .leftJoin(roadmapFollows, and(eq(roadmapFollows.roadmapId, roadmaps.id), eq(roadmapFollows.userId, userId)))
    .where(and(eq(reviews.userId, userId), eq(reviews.suspended, false), lte(reviews.dueDate, until), or(isNull(reviews.itemId), eq(roadmapFollows.active, true))))
    .orderBy(asc(reviews.dueDate), asc(reviews.createdAt));
  return rows;
}

function toCandidate(r: CardRow, day: string, tz: string): DailyCandidate {
  return {
    sourceId: r.card.id,
    title: r.card.title,
    url: r.card.url,
    category: r.card.category,
    platform: r.card.platform,
    problemKey: r.card.problemKey,
    // Revisiting is quicker than first learning.
    estMinutes: Math.max(15, Math.round((r.itemMinutes ?? 30) * 0.6 / 5) * 5),
    preferredTime: null,
    label: r.roadmapTitle ? `Revision · ${r.roadmapTitle}` : "Revision",
    kind: "due",
    // A revision needs a fresh accepted submission on the day itself.
    verifyFrom: new Date(localDayBounds(day, tz).start),
    priority: 3,
  };
}

/**
 * Revisions due on the day (spaced repetition). Capped per roadmap by its revision setting and in
 * total by the learner's daily revision cap; the rest carry over, oldest first.
 */
export const reviewDailySource: DailySource = {
  key: "review",
  async desired(ctx: DayContext) {
    const rows = await dueCards(ctx.db, ctx.userId, ctx.day);
    const closed = new Set(ctx.todays.filter((t) => ["completed", "cancelled", "skipped"].includes(t.status)).map((t) => t.sourceId));
    const doneToday = ctx.todays.filter((t) => t.status === "completed" || t.status === "skipped");
    let total = ctx.prefs.planning.dailyReviewCap - doneToday.length;
    const perRoadmap = new Map<string, number>();
    const out: DailyCandidate[] = [];
    // Pinned (swapped-in) revisions always stay.
    for (const t of ctx.todays.filter((x) => x.pinned && !["cancelled", "skipped", "completed"].includes(x.status))) {
      const r = rows.find((x) => x.card.id === t.sourceId);
      if (r) out.push(toCandidate(r, ctx.day, ctx.tz));
      total -= 1;
    }
    for (const r of rows) {
      if (total <= 0) break;
      if (closed.has(r.card.id) || out.some((c) => c.sourceId === r.card.id)) continue;
      const key = r.roadmapId ?? "none";
      const used = perRoadmap.get(key) ?? 0;
      if (used >= r.card.maxPerDay) continue;
      perRoadmap.set(key, used + 1);
      out.push(toCandidate(r, ctx.day, ctx.tz));
      total -= 1;
    }
    return out;
  },
  async onComplete(s, task) {
    // Recorded as "Good" by default; the learner can change the rating afterwards.
    const card = await s.db.query.reviews.findFirst({ where: eq(reviews.id, task.sourceId!) });
    if (!card) return;
    const today = instantToLocalDate(s.now(), await tzOf(s.db, task.ownerId));
    await recordReview(s.db, card, "good", today);
  },
  async swapOptions(ctx, task) {
    // Revisions coming up in the next week, in the same category.
    const rows = await dueCards(ctx.db, ctx.userId, addDays(ctx.day, 7));
    const onPlan = new Set(ctx.todays.map((t) => t.sourceId));
    return rows
      .filter((r) => r.card.category === task.category && !onPlan.has(r.card.id))
      .slice(0, 5)
      .map((r) => toCandidate(r, ctx.day, ctx.tz));
  },
};
