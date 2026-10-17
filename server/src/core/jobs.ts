import { sql } from "drizzle-orm";
import type { DB } from "./db/index.js";
import { jobLeases } from "./db/schema.js";
import type { Services } from "./context.js";
import type { Job } from "./module.js";

/**
 * Acquires a time-bound lease in Postgres. Only one process runs a job at a time, and a crashed
 * holder's lease simply expires — no Redis or extra infrastructure required.
 */
export async function tryLease(db: DB, key: string, ttlMs: number, now: number): Promise<boolean> {
  const until = new Date(now + ttlMs);
  const rows = await db
    .insert(jobLeases)
    .values({ key, lockedUntil: until, lastRunAt: new Date(now) })
    .onConflictDoUpdate({
      target: jobLeases.key,
      set: { lockedUntil: until, lastRunAt: new Date(now) },
      setWhere: sql`${jobLeases.lockedUntil} < ${new Date(now).toISOString()}`,
    })
    .returning({ key: jobLeases.key });
  return rows.length > 0;
}

export function startJobs(s: Services, jobs: Job[]): () => void {
  const timers = jobs.map((job) => {
    const tick = async () => {
      try {
        // Lease slightly shorter than the interval so the next tick can take over.
        if (await tryLease(s.db, job.key, job.everyMs - 5_000, s.now())) await job.run(s);
      } catch (err) {
        console.error(`[jobs] ${job.key} failed:`, err instanceof Error ? err.message : err);
      }
    };
    setTimeout(tick, 5_000);
    return setInterval(tick, job.everyMs);
  });
  return () => timers.forEach(clearInterval);
}
