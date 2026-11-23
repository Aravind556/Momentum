import type { Services } from "../../core/context.js";
import { noteForResponse } from "../../core/request-context.js";
import { replanToday, type PlanResult } from "./daily.js";

interface Lane {
  /** A queued run that hasn't started yet — later requests share it (coalescing). */
  pending: Promise<PlanResult> | null;
  tail: Promise<unknown>;
  /** Runs queued or running. */
  active: number;
}
const lanes = new Map<string, Lane>();

/**
 * Re-plans today for a user after something changed. Runs one at a time per user, and requests
 * that arrive while a run is waiting share that run — a burst of changes (e.g. creating a roadmap
 * and adding 50 items) re-plans once or twice, not fifty times.
 * The outcome is attached to the current HTTP response so the UI can say what changed.
 */
export function replanSoon(s: Services, userId: string): Promise<PlanResult> {
  const lane = lanes.get(userId) ?? { pending: null, tail: Promise.resolve(), active: 0 };
  lanes.set(userId, lane);
  if (lane.pending) return lane.pending.then(note);
  lane.active += 1;
  const run = lane.tail.then(() => {
    lane.pending = null;
    return replanToday(s, userId);
  });
  const done = () => {
    lane.active -= 1;
  };
  run.then(done, done);
  lane.pending = run;
  lane.tail = run.catch(() => undefined);
  return run.then(note);
}

/**
 * Re-plans in the background: the caller (e.g. a tick) gets its answer without waiting for the
 * rebuild. Anything that reads the plan afterwards waits for it first (see replanSettled).
 */
export function replanInBackground(s: Services, userId: string): void {
  replanSoon(s, userId).catch((err) => console.error("[replan]", err instanceof Error ? err.message : err));
}

/** True while a re-plan is queued or running for the user (Today's list may still change). */
export function isReplanning(userId: string): boolean {
  return (lanes.get(userId)?.active ?? 0) > 0;
}

/** Resolves when no re-plan is queued or running for the user. */
export async function replanSettled(userId: string): Promise<void> {
  await lanes.get(userId)?.tail;
}

function note(r: PlanResult): PlanResult {
  if (r.added || r.removed || r.deferred) {
    noteForResponse("plan", (prev) => {
      const p = (prev as { added: number; removed: number; deferred: number } | undefined) ?? { added: 0, removed: 0, deferred: 0 };
      return { added: p.added + r.added, removed: p.removed + r.removed, deferred: r.deferred };
    });
  }
  return r;
}
