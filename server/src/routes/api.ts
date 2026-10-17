import { Router } from "express";
import { z } from "zod";
import {
  availabilitySchema,
  blockUpdateSchema,
  challengeInputSchema,
  circleInputSchema,
  commitmentInputSchema,
  completeTaskSchema,
  focusFinishSchema,
  focusStartSchema,
  generateScheduleSchema,
  goalInputSchema,
  manualLessonsSchema,
  playlistImportSchema,
  playlistPlanSchema,
  profileUpdateSchema,
  quickTaskSchema,
  RANKING_MODES,
  taskInputSchema,
  videoProgressSchema,
  instantToLocalDate,
} from "@cadence/shared";
import { env } from "../env.js";
import { badRequest, param, parse, queryString } from "../lib/http.js";
import type { Services } from "../services/context.js";
import * as analytics from "../services/analytics.js";
import * as challengesSvc from "../services/challenges.js";
import * as circlesSvc from "../services/circles.js";
import * as commitmentsSvc from "../services/commitments.js";
import * as completions from "../services/completions.js";
import * as focus from "../services/focus.js";
import * as goalsSvc from "../services/goals.js";
import * as integrations from "../services/integrations.js";
import * as notificationsSvc from "../services/notifications.js";
import * as playlists from "../services/playlists.js";
import * as profilesSvc from "../services/profiles.js";
import * as schedules from "../services/schedules.js";
import * as tasksSvc from "../services/tasks.js";
import { sensitiveLimiter, uid } from "./middleware.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function apiRouter(s: Services): Router {
  const r = Router();
  const today = (req: Parameters<typeof uid>[0]) => instantToLocalDate(s.now(), req.profile!.timezone);

  /* ------------------------------------------------------------ me / profile */
  r.get("/me", async (req, res) => {
    const summary = await profilesSvc.profileSummary(s.db, uid(req));
    const streak = await analytics.computeStreak(s.db, uid(req), req.profile!.timezone, s.now());
    res.json({ user: req.user, profile: req.profile, ...summary, streak: { current: streak.current, longest: streak.longest } });
  });
  r.patch("/me", async (req, res) => {
    const body = parse(profileUpdateSchema, req.body);
    res.json({ profile: await profilesSvc.updateProfile(s.db, uid(req), body, s.now()) });
  });

  r.get("/availability", async (req, res) => res.json(await profilesSvc.loadAvailability(s.db, uid(req))));
  r.put("/availability", async (req, res) => {
    const body = parse(availabilitySchema, req.body);
    await profilesSvc.saveAvailability(s.db, uid(req), body);
    res.json(await profilesSvc.loadAvailability(s.db, uid(req)));
  });

  /* ------------------------------------------------------------ commitments */
  r.get("/commitments", async (req, res) => res.json(await commitmentsSvc.listCommitments(s.db, uid(req))));
  r.post("/commitments", async (req, res) => {
    res.status(201).json(await commitmentsSvc.createCommitment(s.db, uid(req), parse(commitmentInputSchema, req.body)));
  });
  r.put("/commitments/:id", async (req, res) => {
    res.json(await commitmentsSvc.updateCommitment(s.db, uid(req), param(req, "id"), parse(commitmentInputSchema, req.body)));
  });
  r.delete("/commitments/:id", async (req, res) => {
    await commitmentsSvc.deleteCommitment(s.db, uid(req), param(req, "id"));
    res.status(204).end();
  });

  /* ------------------------------------------------------------ goals */
  r.get("/goals", async (req, res) => res.json(await goalsSvc.listGoalsWithProgress(s.db, uid(req), req.query.archived === "1")));
  r.post("/goals", async (req, res) => res.status(201).json(await goalsSvc.createGoal(s.db, uid(req), parse(goalInputSchema, req.body))));
  r.put("/goals/:id", async (req, res) => {
    const body = parse(goalInputSchema.and(z.object({ status: z.enum(["active", "completed", "archived"]).optional() })), req.body);
    res.json(await goalsSvc.updateGoal(s.db, uid(req), param(req, "id"), body));
  });
  r.delete("/goals/:id", async (req, res) => res.json(await goalsSvc.archiveGoal(s.db, uid(req), param(req, "id"))));

  /* ------------------------------------------------------------ tasks */
  r.get("/tasks", async (req, res) => {
    res.json(
      await tasksSvc.listTasks(s.db, uid(req), {
        status: queryString(req, "status"),
        goalId: queryString(req, "goalId"),
        includeArchived: req.query.archived === "1",
      }),
    );
  });
  r.post("/tasks", async (req, res) => {
    const body = parse(taskInputSchema, req.body);
    if (body.challengeId) await challengesSvc.challengeDetail(s, uid(req), body.challengeId); // must be a member
    res.status(201).json(await tasksSvc.createTask(s.db, uid(req), body));
  });
  r.post("/tasks/quick", async (req, res) => {
    const q = parse(quickTaskSchema, req.body);
    const body = parse(taskInputSchema, { title: q.title, estimatedMinutes: q.estimatedMinutes, splittable: q.estimatedMinutes > 60 });
    res.status(201).json(await tasksSvc.createTask(s.db, uid(req), body));
  });
  r.put("/tasks/:id", async (req, res) => {
    const body = parse(taskInputSchema, req.body);
    const version = typeof req.body?.version === "number" ? req.body.version : undefined;
    res.json(await tasksSvc.updateTask(s.db, uid(req), param(req, "id"), body, version));
  });
  r.delete("/tasks/:id", async (req, res) => res.json(await tasksSvc.deleteTask(s.db, uid(req), param(req, "id"), s.now())));
  r.post("/tasks/:id/complete", async (req, res) => {
    const body = parse(completeTaskSchema, req.body ?? {});
    res.json(await completions.completeTask(s, uid(req), param(req, "id"), body));
  });
  r.post("/tasks/:id/reopen", async (req, res) => {
    const body = parse(z.object({ occurrenceDate: isoDate.optional() }), req.body ?? {});
    res.json(await completions.reopenTask(s, uid(req), param(req, "id"), body.occurrenceDate));
  });
  r.post("/tasks/:id/skip", async (req, res) => {
    const body = parse(z.object({ occurrenceDate: isoDate.optional() }), req.body ?? {});
    res.json(await completions.skipTask(s, uid(req), param(req, "id"), body.occurrenceDate));
  });
  r.post("/tasks/:id/unskip", async (req, res) => res.json(await completions.unskipTask(s, uid(req), param(req, "id"))));

  /* ------------------------------------------------------------ schedules */
  r.get("/schedules", async (req, res) => {
    const start = queryString(req, "start") ?? today(req);
    const end = queryString(req, "end") ?? start;
    parse(isoDate, start);
    parse(isoDate, end);
    if (end < start) throw badRequest("end must be on or after start");
    res.json(await schedules.getScheduleView(s, uid(req), start, end));
  });
  r.post("/schedules/generate", async (req, res) => {
    const body = parse(generateScheduleSchema, req.body);
    res.json(await schedules.generateUserSchedule(s, uid(req), body.date, body.endDate ?? body.date));
  });
  r.post("/schedules/blocks", async (req, res) => {
    const body = parse(
      z.object({
        taskId: z.string().optional().nullable(),
        title: z.string().max(200).optional(),
        startAt: z.string().datetime({ offset: true }),
        endAt: z.string().datetime({ offset: true }),
        kind: z.enum(["focus", "break"]).default("focus"),
      }),
      req.body,
    );
    res.status(201).json(
      await schedules.createManualBlock(s, uid(req), { ...body, startAt: new Date(body.startAt), endAt: new Date(body.endAt) }),
    );
  });
  r.patch("/schedules/blocks/:id", async (req, res) => {
    const body = parse(blockUpdateSchema, req.body);
    const id = param(req, "id");
    let result: unknown = null;
    if (body.startAt || body.endAt) {
      if (!body.startAt || !body.endAt) throw badRequest("Provide both startAt and endAt");
      result = await schedules.moveBlock(s, uid(req), id, new Date(body.startAt), new Date(body.endAt));
    }
    if (body.locked !== undefined || body.status) {
      result = { block: await schedules.updateBlockState(s, uid(req), id, { locked: body.locked, status: body.status }), warnings: [] };
    }
    res.json(result);
  });
  r.delete("/schedules/blocks/:id", async (req, res) => {
    await schedules.deleteBlock(s, uid(req), param(req, "id"));
    res.status(204).end();
  });
  r.post("/schedules/blocks/:id/break", async (req, res) => {
    const body = parse(z.object({ action: z.enum(["skip", "extend"]), minutes: z.number().int().min(1).max(60).optional() }), req.body);
    res.json(await schedules.adjustBreak(s, uid(req), param(req, "id"), body.action, body.minutes));
  });

  /* ------------------------------------------------------------ focus sessions */
  r.get("/focus-sessions/active", async (req, res) => res.json({ session: await focus.getActiveSession(s, uid(req)) }));
  r.get("/focus-sessions", async (req, res) => res.json(await focus.listSessions(s, uid(req), Number(req.query.limit ?? 30))));
  r.post("/focus-sessions", async (req, res) => res.status(201).json(await focus.startSession(s, uid(req), parse(focusStartSchema, req.body))));
  r.post("/focus-sessions/:id/pause", async (req, res) => res.json(await focus.pauseSession(s, uid(req), param(req, "id"))));
  r.post("/focus-sessions/:id/resume", async (req, res) => res.json(await focus.resumeSession(s, uid(req), param(req, "id"))));
  r.post("/focus-sessions/:id/extend", async (req, res) => {
    const body = parse(z.object({ minutes: z.number().int().min(1).max(120) }), req.body);
    res.json(await focus.extendSession(s, uid(req), param(req, "id"), body.minutes));
  });
  r.post("/focus-sessions/:id/finish", async (req, res) => {
    res.json(await focus.finishSession(s, uid(req), param(req, "id"), parse(focusFinishSchema, req.body ?? {})));
  });

  /* ------------------------------------------------------------ circles */
  r.get("/circles", async (req, res) => res.json(await circlesSvc.listMyCircles(s, uid(req))));
  r.post("/circles", async (req, res) => res.status(201).json(await circlesSvc.createCircle(s, uid(req), parse(circleInputSchema, req.body))));
  r.patch("/circles/:id", async (req, res) => {
    const body = parse(circleInputSchema.partial(), req.body);
    res.json(await circlesSvc.updateCircle(s, uid(req), param(req, "id"), body));
  });
  r.delete("/circles/:id", async (req, res) => {
    await circlesSvc.deleteCircle(s, uid(req), param(req, "id"));
    res.status(204).end();
  });
  r.get("/circles/:id/dashboard", async (req, res) => res.json(await circlesSvc.circleDashboard(s, uid(req), param(req, "id"))));
  r.get("/circles/:id/members", async (req, res) => res.json(await circlesSvc.circleMembers(s, uid(req), param(req, "id"))));
  r.post("/circles/:id/leave", async (req, res) => res.json(await circlesSvc.leaveCircle(s, uid(req), param(req, "id"))));
  r.delete("/circles/:id/members/:userId", async (req, res) => {
    res.json(await circlesSvc.removeMember(s, uid(req), param(req, "id"), param(req, "userId")));
  });
  r.patch("/circles/:id/members/:userId", async (req, res) => {
    const body = parse(z.object({ role: z.enum(["admin", "member"]) }), req.body);
    res.json(await circlesSvc.setMemberRole(s, uid(req), param(req, "id"), param(req, "userId"), body.role));
  });
  r.get("/circles/:id/invitations", async (req, res) => res.json(await circlesSvc.listInvitations(s, uid(req), param(req, "id"))));
  r.post("/circles/:id/invitations", async (req, res) => {
    const body = parse(z.object({ days: z.number().int().optional(), maxUses: z.number().int().optional() }), req.body ?? {});
    res.status(201).json(await circlesSvc.createInvitation(s, uid(req), param(req, "id"), body));
  });
  r.get("/circles/:id/leaderboard", async (req, res) => {
    const period = queryString(req, "period");
    const mode = queryString(req, "mode");
    res.json(
      await circlesSvc.leaderboard(s, uid(req), param(req, "id"), {
        ...(period === "month" || period === "week" ? { period } : {}),
        ...(mode && (RANKING_MODES as readonly string[]).includes(mode) ? { mode: mode as (typeof RANKING_MODES)[number] } : {}),
      }),
    );
  });
  r.get("/circles/:id/activities", async (req, res) => {
    res.json(await circlesSvc.listActivities(s, uid(req), param(req, "id"), queryString(req, "cursor"), Number(req.query.limit ?? 20)));
  });
  r.post("/circles/:id/recap", async (req, res) => {
    const a = await analytics.personalAnalytics(s, uid(req), 7);
    res.json(
      await circlesSvc.shareWeeklyRecap(s, uid(req), param(req, "id"), {
        completedSessions: a.totals.doneBlocks,
        plannedSessions: a.totals.plannedBlocks,
        focusMinutes: a.totals.focusMinutes,
        completions: a.totals.completions,
      }),
    );
  });
  r.post("/activities/:id/reactions", async (req, res) => {
    const body = parse(z.object({ emoji: z.string().max(8) }), req.body);
    res.json(await circlesSvc.toggleReaction(s, uid(req), param(req, "id"), body.emoji));
  });
  r.post("/activities/:id/comments", async (req, res) => {
    const body = parse(z.object({ body: z.string() }), req.body);
    res.status(201).json(await circlesSvc.addComment(s, uid(req), param(req, "id"), body.body));
  });
  r.delete("/comments/:id", async (req, res) => {
    await circlesSvc.deleteComment(s, uid(req), param(req, "id"));
    res.status(204).end();
  });

  /* ------------------------------------------------------------ invitations */
  r.get("/invitations/:code", sensitiveLimiter, async (req, res) => res.json(await circlesSvc.previewInvitation(s, param(req, "code"))));
  r.post("/invitations/:code/accept", sensitiveLimiter, async (req, res) => {
    res.json(await circlesSvc.acceptInvitation(s, uid(req), param(req, "code")));
  });
  r.delete("/invitations/:id", async (req, res) => {
    await circlesSvc.revokeInvitation(s, uid(req), param(req, "id"));
    res.status(204).end();
  });

  /* ------------------------------------------------------------ challenges */
  r.get("/challenges", async (req, res) => res.json(await challengesSvc.listUserChallenges(s, uid(req))));
  r.post("/challenges", async (req, res) => {
    res.status(201).json(await challengesSvc.createChallenge(s, uid(req), parse(challengeInputSchema, req.body)));
  });
  r.get("/challenges/:id", async (req, res) => res.json(await challengesSvc.challengeDetail(s, uid(req), param(req, "id"))));
  r.post("/challenges/:id/join", async (req, res) => res.json(await challengesSvc.joinChallenge(s, uid(req), param(req, "id"))));
  r.post("/challenges/:id/leave", async (req, res) => res.json(await challengesSvc.leaveChallenge(s, uid(req), param(req, "id"))));
  r.delete("/challenges/:id", async (req, res) => {
    await challengesSvc.deleteChallenge(s, uid(req), param(req, "id"));
    res.status(204).end();
  });

  /* ------------------------------------------------------------ integrations */
  r.get("/integrations", async (req, res) => res.json(await integrations.listIntegrations(s, uid(req))));
  r.post("/integrations/leetcode/connect", sensitiveLimiter, async (req, res) => {
    const body = parse(z.object({ username: z.string().trim().min(1).max(40) }), req.body);
    res.json(await integrations.connectLeetCode(s, uid(req), body.username));
  });
  r.post("/integrations/github/connect", async (req, res) => res.json({ url: integrations.githubAuthorizeUrl(uid(req)) }));
  r.get("/integrations/github/callback", async (req, res) => {
    const code = queryString(req, "code");
    const state = queryString(req, "state");
    try {
      if (!code || !state) throw badRequest("Missing code or state");
      await integrations.githubCallback(s, uid(req), code, state);
      res.redirect(`${env.appUrl}/integrations?connected=github`);
    } catch (err) {
      res.redirect(`${env.appUrl}/integrations?error=${encodeURIComponent(err instanceof Error ? err.message : "GitHub connection failed")}`);
    }
  });
  r.post("/integrations/:provider/sync", sensitiveLimiter, async (req, res) => {
    const provider = param(req, "provider");
    if (provider !== "leetcode" && provider !== "github") throw badRequest("Unknown provider");
    res.json(await integrations.syncConnection(s, uid(req), provider, { force: true }));
  });
  r.get("/integrations/:provider/events", async (req, res) => res.json(await integrations.recentEvents(s, uid(req), param(req, "provider"))));
  r.delete("/integrations/:provider", async (req, res) => {
    await integrations.disconnect(s, uid(req), param(req, "provider"));
    res.status(204).end();
  });

  /* ------------------------------------------------------------ playlists */
  r.get("/playlists", async (req, res) => res.json(await playlists.listPlaylists(s, uid(req))));
  r.post("/playlists/import", sensitiveLimiter, async (req, res) => {
    res.status(201).json(await playlists.importYoutubePlaylist(s, uid(req), parse(playlistImportSchema, req.body).url));
  });
  r.post("/playlists/manual", async (req, res) => {
    res.status(201).json(await playlists.createManualPlaylist(s, uid(req), parse(manualLessonsSchema, req.body)));
  });
  r.get("/playlists/:id", async (req, res) => res.json(await playlists.getPlaylist(s, uid(req), param(req, "id"))));
  r.post("/playlists/:id/plan/preview", async (req, res) => {
    res.json(await playlists.previewPlan(s, uid(req), param(req, "id"), parse(playlistPlanSchema, req.body)));
  });
  r.post("/playlists/:id/plan/apply", async (req, res) => {
    res.json(await playlists.applyPlan(s, uid(req), param(req, "id"), parse(playlistPlanSchema, req.body)));
  });
  r.patch("/playlist-items/:id", async (req, res) => {
    res.json(await playlists.updateItemProgress(s, uid(req), param(req, "id"), parse(videoProgressSchema, req.body)));
  });
  r.delete("/playlists/:id", async (req, res) => {
    await playlists.deletePlaylist(s, uid(req), param(req, "id"));
    res.status(204).end();
  });

  /* ------------------------------------------------------------ analytics & notifications */
  r.get("/analytics/summary", async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 7) || 7, 7), 90);
    res.json(await analytics.personalAnalytics(s, uid(req), days));
  });
  r.get("/notifications", async (req, res) => res.json(await notificationsSvc.listNotifications(s, uid(req))));
  r.post("/notifications/read", async (req, res) => {
    const body = parse(z.object({ ids: z.array(z.string()).optional() }), req.body ?? {});
    await notificationsSvc.markRead(s, uid(req), body.ids ?? "all");
    res.json({ ok: true });
  });

  return r;
}
