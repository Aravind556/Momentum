import type { Router } from "express";
import { z } from "zod";
import { followPatchSchema, groupInputSchema, pointsConfigSchema } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import { param, parse, queryString } from "../../core/http.js";
import { sensitiveLimiter, uid } from "../../core/middleware.js";
import * as assigned from "./assigned-roadmaps.js";
import * as catchUp from "./catch-up-cache.js";
import * as tasks from "./group-tasks.js";
import { leaderboard, type Period } from "./points.js";
import * as groups from "./service.js";
import * as sharing from "./sharing.js";

export function groupRoutes(r: Router, s: Services) {
  r.get("/groups", async (req, res) => {
    const mine = await groups.listMyGroups(s, uid(req));
    // Your place this week in each group, for the list.
    const withRank = await Promise.all(
      mine.map(async (g) => {
        const lb = await leaderboard(s, uid(req), g.id, "week");
        const me = lb.rows.find((x) => x.user.userId === uid(req));
        return { ...g, myRank: me?.rank ?? null, myPoints: me?.points ?? 0 };
      }),
    );
    res.json(withRank);
  });
  r.post("/groups", async (req, res) => res.status(201).json(await groups.createGroup(s, uid(req), parse(groupInputSchema, req.body))));
  r.get("/groups/:id", async (req, res) => res.json(await groups.groupOverview(s, uid(req), param(req, "id"))));
  r.patch("/groups/:id", async (req, res) => {
    const body = parse(groupInputSchema.partial().extend({ points: pointsConfigSchema.partial().optional() }), req.body);
    res.json(await groups.updateGroup(s, uid(req), param(req, "id"), body));
  });
  r.delete("/groups/:id", async (req, res) => {
    await groups.deleteGroup(s, uid(req), param(req, "id"));
    res.status(204).end();
  });

  /* members */
  r.get("/groups/:id/members", async (req, res) => res.json(await groups.listMembers(s, uid(req), param(req, "id"))));
  r.post("/groups/:id/leave", async (req, res) => res.json(await groups.leaveGroup(s, uid(req), param(req, "id"))));
  r.delete("/groups/:id/members/:userId", async (req, res) => {
    res.json(await groups.removeMember(s, uid(req), param(req, "id"), param(req, "userId")));
  });
  r.patch("/groups/:id/members/:userId", async (req, res) => {
    const body = parse(z.object({ role: z.enum(["admin", "member"]) }), req.body);
    res.json(await groups.setMemberRole(s, uid(req), param(req, "id"), param(req, "userId"), body.role));
  });

  /* leaderboard */
  r.get("/groups/:id/leaderboard", async (req, res) => {
    const p = queryString(req, "period");
    res.json(await leaderboard(s, uid(req), param(req, "id"), (p === "month" || p === "all" ? p : "week") as Period));
  });

  /* group tasks */
  r.get("/groups/:id/today", async (req, res) => res.json(await tasks.groupToday(s, uid(req), param(req, "id"))));
  r.get("/groups/:id/tasks", async (req, res) => res.json(await tasks.listGroupTasks(s, uid(req), param(req, "id"))));
  r.post("/groups/:id/tasks", async (req, res) => res.status(201).json(await tasks.createGroupTask(s, uid(req), param(req, "id"), req.body)));
  r.put("/groups/:id/tasks/:taskId", async (req, res) => {
    res.json(await tasks.updateGroupTask(s, uid(req), param(req, "id"), param(req, "taskId"), req.body));
  });
  r.delete("/groups/:id/tasks/:taskId", async (req, res) => {
    await tasks.archiveGroupTask(s, uid(req), param(req, "id"), param(req, "taskId"));
    res.status(204).end();
  });

  /* shared roadmaps */
  r.get("/groups/:id/roadmaps", async (req, res) => res.json(await sharing.groupRoadmaps(s, uid(req), param(req, "id"))));
  r.post("/groups/:id/roadmaps/:roadmapId/subscribe", async (req, res) => {
    res.json(await sharing.subscribe(s, uid(req), param(req, "id"), param(req, "roadmapId"), parse(followPatchSchema, req.body ?? {})));
  });
  r.get("/roadmaps/:id/shares", async (req, res) => res.json(await sharing.sharesOfRoadmap(s, uid(req), param(req, "id"))));
  r.post("/roadmaps/:id/shares/:groupId", async (req, res) => res.json(await sharing.shareRoadmap(s, uid(req), param(req, "id"), param(req, "groupId"))));
  r.delete("/roadmaps/:id/shares/:groupId", async (req, res) => res.json(await sharing.unshareRoadmap(s, uid(req), param(req, "id"), param(req, "groupId"))));

  /* invitations */
  r.get("/groups/:id/invitations", async (req, res) => res.json(await groups.listInvitations(s, uid(req), param(req, "id"))));
  r.post("/groups/:id/invitations", async (req, res) => {
    const body = parse(z.object({ days: z.number().int().optional() }), req.body ?? {});
    res.status(201).json(await groups.createInvitation(s, uid(req), param(req, "id"), body));
  });
  r.get("/invitations/:code", sensitiveLimiter, async (req, res) => res.json(await groups.previewInvitation(s, param(req, "code"))));
  r.post("/invitations/:code/accept", sensitiveLimiter, async (req, res) => {
    res.json(await groups.acceptInvitation(s, uid(req), param(req, "code")));
  });
  r.delete("/invitations/:id", async (req, res) => {
    await groups.revokeInvitation(s, uid(req), param(req, "id"));
    res.status(204).end();
  });

  // Roadmaps assigned to the whole group (admins assign; everyone gets the day's items).
  r.get("/groups/:id/assigned-roadmaps", async (req, res) => res.json(await assigned.listAssignments(s, uid(req), param(req, "id"))));
  r.post("/groups/:id/assigned-roadmaps", async (req, res) => res.status(201).json(await assigned.assignRoadmap(s, uid(req), param(req, "id"), req.body)));
  r.patch("/groups/:id/assigned-roadmaps/:aid", async (req, res) => res.json(await assigned.updateAssignment(s, uid(req), param(req, "id"), param(req, "aid"), req.body)));
  r.delete("/groups/:id/assigned-roadmaps/:aid", async (req, res) => res.json(await assigned.endAssignment(s, uid(req), param(req, "id"), param(req, "aid"))));
  // Items covered before you joined, to tick off on your own.
  r.get("/groups/:id/assigned-roadmaps/:aid/previous", async (req, res) => res.json(await catchUp.previousItems(s, uid(req), param(req, "id"), param(req, "aid"))));
  r.post("/groups/:id/assigned-roadmaps/:aid/previous/:itemId/done", async (req, res) =>
    res.json(await catchUp.completePreviousItem(s, uid(req), param(req, "id"), param(req, "aid"), param(req, "itemId"))),
  );
}
