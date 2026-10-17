import { and, desc, eq, lt, or } from "drizzle-orm";
import { addDays, computeStreaks, difficultyBucket, instantToLocalDate, type DayState, type DifficultyBucket } from "@cadence/shared";
import type { Services } from "../../core/context.js";
import { externalEvents } from "../../core/db/schema.js";
import { badRequest } from "../../core/http.js";
import { ACCEPTED, type SubmissionData } from "../platforms/types.js";

const HEATMAP_DAYS = 182;

/**
 * Individual coding progress from synced accepted submissions: distinct problems per platform and
 * difficulty, a daily activity heatmap, a solving streak and the most practised topics.
 */
export async function codingStats(s: Services, userId: string, tz: string) {
  const rows = await s.db
    .select({ provider: externalEvents.provider, occurredAt: externalEvents.occurredAt, data: externalEvents.data })
    .from(externalEvents)
    .where(and(eq(externalEvents.userId, userId), eq(externalEvents.type, ACCEPTED)));

  // First accepted submission per distinct problem.
  const firstSolve = new Map<string, { provider: string; at: number; data: SubmissionData }>();
  const perDay = new Map<string, Set<string>>();
  for (const r of rows) {
    const data = r.data as SubmissionData;
    const id = `${r.provider}:${data.problemKey}`;
    const at = r.occurredAt.getTime();
    const prev = firstSolve.get(id);
    if (!prev || at < prev.at) firstSolve.set(id, { provider: r.provider, at, data });
    const day = instantToLocalDate(at, tz);
    (perDay.get(day) ?? perDay.set(day, new Set()).get(day)!).add(id);
  }

  const byPlatform: Record<string, { solved: number; byDifficulty: Record<DifficultyBucket, number> }> = {};
  const tagCounts = new Map<string, number>();
  for (const { provider, data } of firstSolve.values()) {
    const p = (byPlatform[provider] ??= { solved: 0, byDifficulty: { Easy: 0, Medium: 0, Hard: 0, Unknown: 0 } });
    p.solved += 1;
    p.byDifficulty[difficultyBucket(data.difficulty)] += 1;
    for (const t of data.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }

  const today = instantToLocalDate(s.now(), tz);
  const start = addDays(today, -(HEATMAP_DAYS - 1));
  const heatmap: Array<{ date: string; count: number }> = [];
  const states: DayState[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const count = perDay.get(d)?.size ?? 0;
    heatmap.push({ date: d, count });
    // Today without a solve yet doesn't break the streak.
    states.push(count > 0 ? "active" : d === today ? "neutral" : "missed");
  }
  const streak = computeStreaks(states);

  const last7 = heatmap.slice(-7).reduce((n, d) => n + d.count, 0);
  return {
    totalSolved: firstSolve.size,
    solvedLast7Days: last7,
    byPlatform,
    heatmap,
    streak: { current: streak.current, longest: streak.longest },
    topTags: [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count })),
  };
}

/** Newest-first feed of accepted submissions with keyset pagination. */
export async function listSubmissions(s: Services, userId: string, opts: { cursor?: string; provider?: string; limit?: number }) {
  const take = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  let cursorCond;
  if (opts.cursor) {
    const [ts, id] = Buffer.from(opts.cursor, "base64url").toString().split("|");
    if (!ts || !id || Number.isNaN(Date.parse(ts))) throw badRequest("Invalid cursor");
    cursorCond = or(lt(externalEvents.occurredAt, new Date(ts)), and(eq(externalEvents.occurredAt, new Date(ts)), lt(externalEvents.id, id)));
  }
  const rows = await s.db
    .select({ id: externalEvents.id, provider: externalEvents.provider, occurredAt: externalEvents.occurredAt, data: externalEvents.data })
    .from(externalEvents)
    .where(
      and(
        eq(externalEvents.userId, userId),
        eq(externalEvents.type, ACCEPTED),
        opts.provider ? eq(externalEvents.provider, opts.provider) : undefined,
        cursorCond,
      ),
    )
    .orderBy(desc(externalEvents.occurredAt), desc(externalEvents.id))
    .limit(take + 1);
  const page = rows.slice(0, take);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => {
      const d = r.data as SubmissionData;
      return { id: r.id, provider: r.provider, solvedAt: r.occurredAt, problemKey: d.problemKey, title: d.title, url: d.url, difficulty: d.difficulty, tags: d.tags ?? [] };
    }),
    nextCursor: rows.length > take && last ? Buffer.from(`${last.occurredAt.toISOString()}|${last.id}`).toString("base64url") : null,
  };
}
