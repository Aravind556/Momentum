import { REVIEW_RATINGS, SM2_NEW_CARD, sm2DueDate, sm2Review, type ReviewRating } from "@cadence/shared";

/** The scheduling state stored on a review card. */
export interface CardState {
  ef: number;
  reps: number;
  baseInterval: number;
  state: Record<string, unknown> | null;
}

/**
 * A spaced-repetition algorithm. SM-2 ships today; another algorithm (e.g. FSRS) can be added as
 * one more implementation and selected per card through the `algorithm` column.
 */
export interface RepetitionAlgorithm {
  id: string;
  initial(): CardState;
  review(card: CardState, rating: ReviewRating): CardState;
  /** Next due date (YYYY-MM-DD) given the learner's revision multiplier. */
  dueDate(card: CardState, lastReviewedOn: string, multiplier: number): string;
}

export const sm2: RepetitionAlgorithm = {
  id: "sm2",
  // Solving it the first time counts as the first successful recall: review tomorrow, then ~6 days.
  initial: () => ({ ...sm2Review(SM2_NEW_CARD, REVIEW_RATINGS.good), state: null }),
  review: (card, rating) => ({ ...sm2Review(card, REVIEW_RATINGS[rating]), state: null }),
  dueDate: (card, lastReviewedOn, multiplier) => sm2DueDate(lastReviewedOn, card.baseInterval, multiplier),
};

const ALGORITHMS = new Map<string, RepetitionAlgorithm>([[sm2.id, sm2]]);

export function algorithmFor(id: string): RepetitionAlgorithm {
  return ALGORITHMS.get(id) ?? sm2;
}
