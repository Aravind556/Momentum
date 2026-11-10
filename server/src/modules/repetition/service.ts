import { and, asc, eq, inArray } from "drizzle-orm";
import { instantToLocalDate, REVIEW_RATINGS, type RevisionConfig, type ReviewRating } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import type { Tx } from "../../core/db/index.js";
import { externalEvents, reviews, roadmapItems, roadmaps } from "../../core/db/schema.js";
import { badRequest, notFound } from "../../core/http.js";
import { tzOf } from "../planning/schedules.js";
import { ACCEPTED, type SubmissionData } from "../platforms/types.js";
import { algorithmFor, sm2 } from "./algorithm.js";

export type Review = typeof reviews.$inferSelect;

export interface CardSubject {
  itemId: string | null;
  category: string;
  platform: string | null;
  problemKey: string | null;
  title: string;
  url: string | null;
}

/** Identity of a card: the same problem reached from two roadmaps is one card. */
export const subjectOf = (c: Pick<CardSubject, "platform" | "problemKey" | "itemId" | "url">) =>
  c.platform && c.problemKey ? `${c.platform}:${c.problemKey}` : c.itemId ? `item:${c.itemId}` : `url:${c.url}`;

/**
 * Starts spaced repetition for something just learned: first review one base interval
 * (scaled by the learner's revision setting) after today. Idempotent per subject.
 */
export async function startCard(db: Tx, userId: string, subject: CardSubject, revision: RevisionConfig, today: string) {
  const card = sm2.initial();
  const [row] = await db
    .insert(reviews)
    .values({
      userId,
      ...subject,
      subject: subjectOf(subject),
      algorithm: sm2.id,
      ef: card.ef,
      reps: card.reps,
      baseInterval: card.baseInterval,
      multiplier: revision.multiplier,
      maxPerDay: revision.maxPerDay,
      lastReviewedOn: today,
      dueDate: sm2.dueDate(card, today, revision.multiplier),
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

interface Snapshot {
  ef: number;
  reps: number;
  baseInterval: number;
  lastReviewedOn: string;
  dueDate: string;
}

/**
 * Records a review and schedules the next one. Rating again on the same day replaces that day's
 * review (from a snapshot) instead of counting twice — so a default "Good" can be corrected.
 */
export async function recordReview(db: Tx, card: Review, rating: ReviewRating, today: string) {
  const prev = (card.state as { prev?: Snapshot } | null)?.prev;
  const base = card.lastReviewedOn === today && prev ? { ...card, ...prev } : card;
  const snapshot: Snapshot = { ef: base.ef, reps: base.reps, baseInterval: base.baseInterval, lastReviewedOn: base.lastReviewedOn, dueDate: base.dueDate };
  const algo = algorithmFor(card.algorithm);
  const next = algo.review(base, rating);
  const [row] = await db
    .update(reviews)
    .set({
      ef: next.ef,
      reps: next.reps,
      baseInterval: next.baseInterval,
      state: { prev: snapshot },
      lastQuality: REVIEW_RATINGS[rating],
      lastReviewedOn: today,
      dueDate: algo.dueDate(next, today, card.multiplier),
    })
    .where(eq(reviews.id, card.id))
    .returning();
  return row!;
}

/** "How was it?" after a revision (or a manual rating from the revisions list). */
export async function rateCard(s: Services, userId: string, cardId: string, rating: ReviewRating) {
  const card = await s.db.query.reviews.findFirst({ where: and(eq(reviews.id, cardId), eq(reviews.userId, userId)) });
  if (!card) throw notFound("Revision");
  const today = instantToLocalDate(s.now(), await tzOf(s.db, userId));
  return recordReview(s.db, card, rating, today);
}

/**
 * Applies a changed revision setting to every card from the given items, immediately:
 * due dates are recomputed from the last review; "off" suspends the cards (nothing is lost).
 */
export async function applyRevisionSetting(db: Tx, userId: string, itemIds: string[], revision: RevisionConfig | null) {
  if (!itemIds.length) return 0;
  const cards = await db.select().from(reviews).where(and(eq(reviews.userId, userId), inArray(reviews.itemId, itemIds)));
  for (const c of cards) {
    if (!revision) {
      await db.update(reviews).set({ suspended: true }).where(eq(reviews.id, c.id));
      continue;
    }
    const due = algorithmFor(c.algorithm).dueDate(c, c.lastReviewedOn, revision.multiplier);
    await db
      .update(reviews)
      .set({ suspended: false, multiplier: revision.multiplier, maxPerDay: revision.maxPerDay, dueDate: due })
      .where(eq(reviews.id, c.id));
  }
  return cards.length;
}

/** Active cards, soonest first, with the roadmap each came from. */
export async function listCards(s: Services, userId: string) {
  const rows = await s.db
    .select({ card: reviews, roadmapId: roadmaps.id, roadmapTitle: roadmaps.title })
    .from(reviews)
    .leftJoin(roadmapItems, eq(roadmapItems.id, reviews.itemId))
    .leftJoin(roadmaps, eq(roadmaps.id, roadmapItems.roadmapId))
    .where(and(eq(reviews.userId, userId), eq(reviews.suspended, false)))
    .orderBy(asc(reviews.dueDate), asc(reviews.createdAt));
  return rows.map((r) => ({ ...r.card, roadmap: r.roadmapId ? { id: r.roadmapId, title: r.roadmapTitle } : null }));
}

/** "Add to revisions" for any accepted submission in the feed (standard revision setting). */
export async function addFromSubmission(s: Services, userId: string, submissionId: string) {
  const ev = await s.db.query.externalEvents.findFirst({
    where: and(eq(externalEvents.id, submissionId), eq(externalEvents.userId, userId), eq(externalEvents.type, ACCEPTED)),
  });
  if (!ev) throw notFound("Submission");
  const d = ev.data as SubmissionData;
  const today = instantToLocalDate(s.now(), await tzOf(s.db, userId));
  const card = await startCard(
    s.db,
    userId,
    { itemId: null, category: ev.provider, platform: ev.provider, problemKey: d.problemKey, title: d.title, url: d.url },
    { multiplier: 1, maxPerDay: 3 },
    today,
  );
  if (!card) throw badRequest("This problem is already in your revisions", "duplicate");
  return card;
}

export async function deleteCard(s: Services, userId: string, cardId: string) {
  const [row] = await s.db.delete(reviews).where(and(eq(reviews.id, cardId), eq(reviews.userId, userId))).returning({ id: reviews.id });
  if (!row) throw notFound("Revision");
}
