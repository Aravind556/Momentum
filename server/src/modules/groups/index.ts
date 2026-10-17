import { eq } from "drizzle-orm";
import type { AppModule } from "../../core/module.js";
import { roadmapItems } from "../../core/db/schema.js";
import { registerDailySource } from "../planning/sources.js";
import { registerRoadmapAccessRule } from "../roadmaps/service.js";
import { groupDailySource } from "./group-tasks.js";
import { recordRoadmapItemPoints } from "./points.js";
import { groupRoutes } from "./routes.js";
import { activeMemberIds } from "./service.js";
import { canViewViaGroups, groupsSharingRoadmap } from "./sharing.js";

/**
 * Study groups: members & invitations, roadmaps shared for opt-in subscription, group tasks on
 * everyone's day plan, and a points leaderboard.
 */
export const groupsModule: AppModule = {
  name: "groups",
  routes: groupRoutes,
  register(s) {
    registerRoadmapAccessRule(canViewViaGroups);
    registerDailySource(groupDailySource);
    // Finishing an item of a roadmap shared in a group earns points there.
    s.events.on("roadmap.item_done", async ({ userId, roadmapId, itemId, verifiedBy, at }) => {
      const shares = await groupsSharingRoadmap(s.db, userId, roadmapId);
      if (!shares.length) return;
      const item = await s.db.query.roadmapItems.findFirst({ where: eq(roadmapItems.id, itemId) });
      for (const { groupId } of shares) {
        // Dated by when it was actually solved, so old solves don't inflate this week's board.
        await recordRoadmapItemPoints(s.db, { groupId, userId, itemId, difficulty: item?.difficulty ?? null, completedAt: at, verifiedBy });
      }
    });
    // New or changed group tasks → every member's today.
    s.events.on("group.tasks_changed", async ({ groupId }) => {
      for (const userId of await activeMemberIds(s.db, groupId)) await s.events.emit("plan.stale", { userId });
    });
  },
};
