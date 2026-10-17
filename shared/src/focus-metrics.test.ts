import { describe, expect, it } from "vitest";
import { focusDurations } from "./focus.js";
import { computeStreaks, scoreMember, type MemberStats } from "./metrics.js";
import { mergeIntervals, subtractIntervals } from "./intervals.js";

const M = 60_000;

describe("focusDurations", () => {
  it("derives active time from timestamps and pause records", () => {
    const d = focusDurations(
      { startedAt: 0, endedAt: 50 * M, pauses: [{ pausedAt: 10 * M, resumedAt: 15 * M }, { pausedAt: 30 * M, resumedAt: 32 * M }] },
      999 * M,
    );
    expect(d).toEqual({ elapsedMs: 50 * M, pausedMs: 7 * M, activeMs: 43 * M, isPaused: false });
  });

  it("treats an open pause as paused until now (refresh-safe)", () => {
    const d = focusDurations({ startedAt: 0, endedAt: null, pauses: [{ pausedAt: 20 * M, resumedAt: null }] }, 45 * M);
    expect(d.isPaused).toBe(true);
    expect(d.activeMs).toBe(20 * M);
    // a later "refresh" computes the same active time
    expect(focusDurations({ startedAt: 0, endedAt: null, pauses: [{ pausedAt: 20 * M, resumedAt: null }] }, 90 * M).activeMs).toBe(20 * M);
  });

  it("clips pauses that extend past the end", () => {
    const d = focusDurations({ startedAt: 0, endedAt: 10 * M, pauses: [{ pausedAt: 5 * M, resumedAt: null }] }, 60 * M);
    expect(d.activeMs).toBe(5 * M);
  });
});

describe("streaks", () => {
  it("skips neutral days and does not break on an unfinished today", () => {
    expect(computeStreaks(["active", "neutral", "active", "active", "missed"])).toEqual({ current: 3, longest: 3 });
    expect(computeStreaks(["active", "missed", "active", "neutral", "active"])).toEqual({ current: 2, longest: 2 });
    expect(computeStreaks(["missed", "missed"])).toEqual({ current: 0, longest: 0 });
  });
});

describe("leaderboard scores", () => {
  const base: MemberStats = {
    userId: "u",
    plannedOccurrences: 10,
    completedOccurrences: 8,
    completions: 8,
    verifiedCompletions: 2,
    activeDays: 5,
    focusMinutes: 300,
    challengeProgress: 0.4,
  };
  it("uses planned occurrences as the consistency denominator", () => {
    expect(scoreMember("consistency", base, { periodDays: 7, maxCompletions: 8 }).score).toBe(0.8);
    expect(scoreMember("consistency", { ...base, plannedOccurrences: 0, completedOccurrences: 0 }, { periodDays: 7, maxCompletions: 8 }).parts[0]!.detail).toContain(
      "Nothing scheduled",
    );
  });
  it("explains the balanced score", () => {
    const s = scoreMember("balanced", base, { periodDays: 7, maxCompletions: 16 });
    expect(s.parts).toHaveLength(3);
    expect(s.score).toBeCloseTo(0.5 * 0.8 + 0.3 * 0.5 + 0.2 * (5 / 7), 3);
  });
});

describe("intervals", () => {
  it("merges and subtracts safely", () => {
    expect(mergeIntervals([{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 2, end: 6 }, { start: 9, end: 9 }])).toEqual([{ start: 1, end: 8 }]);
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 2, end: 3 }, { start: 2.5, end: 4 }, { start: 9, end: 12 }])).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 9 },
    ]);
  });
});
