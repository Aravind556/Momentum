import { and, eq, inArray, ne } from "drizzle-orm";
import { instantToLocalDate } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import { tasks } from "../../core/db/schema.js";
import { ensureDay } from "../planning/daily.js";
import { tzOf } from "../planning/schedules.js";

export interface MyGroupTask {
  /** The viewer's own task on today's plan: ticked with the same check as on Today. */
  taskId: string;
  done: boolean;
  /** "submission" = verified against the platform (e.g. LeetCode's daily problem), "self" = a tick. */
  check: "submission" | "self";
}

/**
 * The viewer's own day-plan tasks for group work (`source` "group" or "group-roadmap"), so the
 * group page can tick them directly. Builds today's plan first if it hasn't been built yet.
 */
export async function viewerTasks(
  s: Services,
  userId: string,
  source: "group" | "group-roadmap",
  sourceIds: string[],
): Promise<Map<string, MyGroupTask>> {
  const out = new Map<string, MyGroupTask>();
  if (!sourceIds.length) return out;
  const day = instantToLocalDate(s.now(), await tzOf(s.db, userId));
  const load = () =>
    s.db
      .select({ id: tasks.id, sourceId: tasks.sourceId, status: tasks.status, verification: tasks.verification })
      .from(tasks)
      .where(and(eq(tasks.ownerId, userId), eq(tasks.planDay, day), eq(tasks.source, source), ne(tasks.status, "cancelled"), inArray(tasks.sourceId, sourceIds)));
  let rows = await load();
  if (rows.length < sourceIds.length) {
    await ensureDay(s, userId, day).catch(() => undefined);
    rows = await load();
  }
  for (const r of rows) {
    out.set(r.sourceId!, { taskId: r.id, done: r.status === "completed", check: r.verification.provider === "none" ? "self" : "submission" });
  }
  return out;
}
