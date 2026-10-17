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

export interface MemberStats {
  userId: string;
  /** Distinct (task, day) occurrences that had scheduled focus blocks in the past. */
  plannedOccurrences: number;
  /** Of those, occurrences completed (partial counts as half). */
  completedOccurrences: number;
  /** Eligible task completions in the period. */
  completions: number;
  verifiedCompletions: number;
  activeDays: number;
  focusMinutes: number;
  /** Progress toward active challenge targets, 0..1. */
  challengeProgress: number;
}

export interface ScoreBreakdown {
  score: number;
  parts: Array<{ label: string; value: number; weight: number; detail: string }>;
}

export function consistencyRate(s: Pick<MemberStats, "plannedOccurrences" | "completedOccurrences">): number | null {
  if (s.plannedOccurrences === 0) return null;
  return Math.min(1, s.completedOccurrences / s.plannedOccurrences);
}

/**
 * Transparent ranking scores. Every score returns its components so users can see why it changed.
 * Consistency uses planned occurrences as the denominator; days with nothing planned are excluded.
 */
export function scoreMember(
  mode: "consistency" | "volume" | "challenge" | "balanced",
  s: MemberStats,
  ctx: { periodDays: number; maxCompletions: number },
): ScoreBreakdown {
  const c = consistencyRate(s);
  const consistencyPart = {
    label: "Consistency",
    value: c ?? 0,
    weight: 1,
    detail:
      c === null
        ? "Nothing scheduled in this period"
        : `${round1(s.completedOccurrences)} of ${s.plannedOccurrences} scheduled tasks completed`,
  };
  switch (mode) {
    case "consistency":
      return { score: round3(c ?? 0), parts: [consistencyPart] };
    case "volume":
      return {
        score: s.completions,
        parts: [{ label: "Completed tasks", value: s.completions, weight: 1, detail: `${s.completions} tasks completed` }],
      };
    case "challenge":
      return {
        score: round3(s.challengeProgress),
        parts: [
          {
            label: "Challenge progress",
            value: s.challengeProgress,
            weight: 1,
            detail: `${Math.round(s.challengeProgress * 100)}% of challenge targets`,
          },
        ],
      };
    case "balanced": {
      const volume = ctx.maxCompletions > 0 ? s.completions / ctx.maxCompletions : 0;
      const active = ctx.periodDays > 0 ? s.activeDays / ctx.periodDays : 0;
      const parts = [
        { ...consistencyPart, weight: 0.5 },
        {
          label: "Volume (relative to the top member)",
          value: volume,
          weight: 0.3,
          detail: `${s.completions} tasks vs. top ${ctx.maxCompletions}`,
        },
        { label: "Active days", value: active, weight: 0.2, detail: `${s.activeDays} of ${ctx.periodDays} days` },
      ];
      return { score: round3(parts.reduce((sum, p) => sum + p.value * p.weight, 0)), parts };
    }
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;
