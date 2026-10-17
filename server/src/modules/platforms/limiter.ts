import { AsyncLocalStorage } from "node:async_hooks";
import type { FetchFn } from "./types.js";

export type Priority = "user" | "background";

/**
 * Who is asking. Anything started inside `asBackground(...)` queues behind requests made for a
 * person waiting on a click, so "Sync now" never waits on a batch job.
 */
const priorityContext = new AsyncLocalStorage<Priority>();

export function asBackground<T>(fn: () => Promise<T>): Promise<T> {
  return priorityContext.run("background", fn);
}

interface Pending {
  run: () => void;
}

/**
 * Serialises requests to one provider and keeps at least `spacingMs` between their starts —
 * e.g. Codeforces documents a limit of one call every 2 seconds. In-process only: one API
 * server is plenty for this app; a shared limiter (Redis, Postgres) can replace it later.
 */
export class RateLimiter {
  private queues: Record<Priority, Pending[]> = { user: [], background: [] };
  private busy = false;
  private lastStart = -Infinity;

  constructor(
    private spacingMs: number,
    private clock: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  schedule<T>(task: () => Promise<T>, priority: Priority = priorityContext.getStore() ?? "user"): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queues[priority].push({ run: () => task().then(resolve, reject) });
      void this.drain();
    });
  }

  private async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending > 0) {
        // Wait out the spacing first, then pick: a click that arrives meanwhile still goes next.
        const wait = this.lastStart + this.spacingMs - this.clock();
        if (wait > 0) await this.sleep(wait);
        const next = this.queues.user.shift() ?? this.queues.background.shift();
        if (!next) break;
        this.lastStart = this.clock();
        next.run(); // spacing is between request starts; responses may overlap
      }
    } finally {
      this.busy = false;
    }
  }

  /** Requests waiting to start (for tests and diagnostics). */
  get pending() {
    return this.queues.user.length + this.queues.background.length;
  }
}

/** Wraps fetch so every request through it goes via the limiter. */
export function limitedFetch(fetchFn: FetchFn, limiter: RateLimiter): FetchFn {
  return ((input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) => limiter.schedule(() => fetchFn(input, init))) as FetchFn;
}
