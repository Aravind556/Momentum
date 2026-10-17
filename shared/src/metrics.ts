/**
 * Day classification for streaks:
 *  - active:  at least one task completed (or partially completed) that day
 *  - missed:  work was planned that day but nothing was completed
 *  - neutral: nothing was planned (rest day, day off) — neither extends nor breaks a streak
 */
export type DayState = "active" | "missed" | "neutral";

export interface StreakResult {
  current: number;
  longest: number;
}

/**
 * `days` must be ordered oldest → newest and end with today.
 * Today counts if active; an unfinished today never breaks the streak.
 */
export function computeStreaks(days: DayState[]): StreakResult {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    if (d === "active") {
      run += 1;
      longest = Math.max(longest, run);
    } else if (d === "missed") run = 0;
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!;
    const isToday = i === days.length - 1;
    if (d === "active") current += 1;
    else if (d === "missed" && !isToday) break;
  }
  return { current, longest };
}
