export interface PauseRecord {
  pausedAt: number;
  resumedAt: number | null;
}

export interface FocusTiming {
  startedAt: number;
  endedAt: number | null;
  pauses: PauseRecord[];
}

export interface FocusDurations {
  /** Wall-clock time from start to end (or now). */
  elapsedMs: number;
  /** Time spent paused. */
  pausedMs: number;
  /** elapsed − paused. */
  activeMs: number;
  isPaused: boolean;
}

/**
 * Timer state is derived from persisted timestamps, never from a client-side countdown,
 * so refreshes and disconnects cannot corrupt it.
 */
export function focusDurations(s: FocusTiming, now: number): FocusDurations {
  const end = s.endedAt ?? now;
  const elapsedMs = Math.max(0, end - s.startedAt);
  let pausedMs = 0;
  let isPaused = false;
  for (const p of s.pauses) {
    const from = Math.max(p.pausedAt, s.startedAt);
    const to = Math.min(p.resumedAt ?? end, end);
    if (to > from) pausedMs += to - from;
    if (p.resumedAt === null && s.endedAt === null) isPaused = true;
  }
  pausedMs = Math.min(pausedMs, elapsedMs);
  return { elapsedMs, pausedMs, activeMs: elapsedMs - pausedMs, isPaused };
}

export function remainingMs(plannedMinutes: number, d: FocusDurations): number {
  return plannedMinutes * 60_000 - d.activeMs;
}
