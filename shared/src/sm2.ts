import { addDays } from "./time.js";

/**
 * SuperMemo SM-2 (Wozniak, 1990) — the spaced-repetition algorithm behind revisions.
 *
 * After each review the learner grades recall quality q (0–5):
 *  - q < 3: the item was forgotten → repetitions restart and it comes back tomorrow.
 *  - q ≥ 3: the interval grows: 1 day, then 6 days, then previous interval × EF.
 * The easiness factor EF starts at 2.5 and moves with every grade:
 *   EF' = EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02)),  never below 1.3.
 *
 * We store the plain SM-2 interval ("base interval") and apply the learner's revision setting
 * as a multiplier only when computing the due date, so changing the setting can reschedule
 * every card without losing what SM-2 learned.
 */
export interface Sm2Card {
  /** Easiness factor, ≥ 1.3. */
  ef: number;
  /** Consecutive successful reviews. */
  reps: number;
  /** Days until the next review before the revision multiplier is applied. */
  baseInterval: number;
}

export const SM2_NEW_CARD: Sm2Card = { ef: 2.5, reps: 0, baseInterval: 1 };

/** The four buttons shown after a revision, mapped to SM-2 grades. */
export const REVIEW_RATINGS = { again: 2, hard: 3, good: 4, easy: 5 } as const;
export type ReviewRating = keyof typeof REVIEW_RATINGS;

export function sm2Review(card: Sm2Card, quality: number): Sm2Card {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  const ef = Math.max(1.3, round2(card.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))));
  if (q < 3) return { ef, reps: 0, baseInterval: 1 };
  const reps = card.reps + 1;
  const baseInterval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(card.baseInterval * card.ef);
  return { ef, reps, baseInterval };
}

/** Due date = last review + base interval × revision multiplier (at least one day later). */
export function sm2DueDate(lastReviewDate: string, baseInterval: number, multiplier: number): string {
  return addDays(lastReviewDate, Math.max(1, Math.round(baseInterval * multiplier)));
}

const round2 = (n: number) => Math.round(n * 100) / 100;
