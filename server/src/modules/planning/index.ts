import { and, eq } from "drizzle-orm";
import { instantToLocalDate } from "@cadence/shared";
import type { Services } from "../../core/context.js";
import { profiles, roadmapFollows, tasks } from "../../core/db/schema.js";
import type { AppModule } from "../../core/module.js";
import { ensureDay } from "./daily.js";
import { replanSoon } from "./replan.js";
import { planningRoutes } from "./routes.js";
import { todayRoutes } from "./routes-today.js";
import { dailySource } from "./sources.js";

/** Builds every user's plan shortly after their local midnight (lazily on first visit, too). */
async function planNewDays(s: Services) {
  const users = await s.db.select({ userId: profiles.userId, timezone: profiles.timezone, last: profiles.lastPlannedDay }).from(profiles);
  let planned = 0;
  for (const u of users) {
    const today = instantToLocalDate(s.now(), u.timezone);
    if (u.last === today) continue;
    await ensureDay(s, u.userId, today).catch((err) => console.error("[daily-plan]", err instanceof Error ? err.message : err));
    if (++planned >= 200) break; // the rest are picked up on the next run
  }
  return planned;
}

/**
 * Context-aware scheduling and the daily automation: commitments, schedule generation, the day plan
 * built from every registered daily source, and re-planning when something changes.
 */
export const planningModule: AppModule = {
  name: "planning",
  routes: (r, s) => {
    planningRoutes(r, s);
    todayRoutes(r, s);
  },
  jobs: [{ key: "daily-plan", everyMs: 15 * 60_000, run: planNewDays }],
  register(s) {
    // A generated task was completed → let its source react (roadmap progress, revisions, ...).
    s.events.on("task.completed", async ({ taskId, verified, outcome }) => {
      if (outcome !== "completed") return;
      const task = await s.db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
      if (!task) return;
      if (task.source !== "manual") await dailySource(task.source)?.onComplete?.(s, task, verified);
      // Finishing early frees time: let the rest of today move into it.
      await replanSoon(s, task.ownerId);
    });
    // Anything that changes what today should hold re-plans today right away.
    const replan = ({ userId }: { userId: string }) => replanSoon(s, userId).then(() => undefined);
    s.events.on("follow.changed", replan);
    s.events.on("task.changed", replan);
    s.events.on("task.skipped", replan);
    s.events.on("availability.changed", replan);
    s.events.on("settings.changed", replan);
    s.events.on("plan.stale", replan);
    s.events.on("group.member_joined", replan);
    s.events.on("group.member_left", replan);
    // The owner edited a roadmap → everyone following it.
    s.events.on("roadmap.items_changed", async ({ roadmapId }) => {
      const followers = await s.db
        .select({ userId: roadmapFollows.userId })
        .from(roadmapFollows)
        .where(and(eq(roadmapFollows.roadmapId, roadmapId), eq(roadmapFollows.active, true)));
      for (const f of followers) await replanSoon(s, f.userId);
    });
  },
};

