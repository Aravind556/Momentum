import type { Services } from "../../core/context.js";
import { noteForResponse } from "../../core/request-context.js";
import { replanToday, type PlanResult } from "./daily.js";

interface Lane {
  /** A queued run that hasn't started yet — later requests share it (coalescing). */
  pending: Promise<PlanResult> | null;
  tail: Promise<unknown>;
}
const lanes = new Map<string, Lane>();

/**
 * Re-plans today for a user after something changed. Runs one at a time per user, and requests
 * that arrive while a run is waiting share that run — a burst of changes (e.g. creating a roadmap
 * and adding 50 items) re-plans once or twice, not fifty times.
 * The outcome is attached to the current HTTP response so the UI can say what changed.
 */
export function replanSoon(s: Services, userId: string): Promise<PlanResult> {
  const lane = lanes.get(userId) ?? { pending: null, tail: Promise.resolve() };
  lanes.set(userId, lane);
  if (lane.pending) return lane.pending.then(note);
  const run = lane.tail.then(() => {
    lane.pending = null;
    return replanToday(s, userId);
  });
  lane.pending = run;
  lane.tail = run.catch(() => undefined);
  return run.then(note);
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
