import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IST, setHours, setupTestEnv, signUp, type TestEnv } from "./helpers.js";
import { verifyTasks, syncConnection } from "../src/services/integrations.js";
import { integrationConnections } from "../src/db/schema.js";

const DAY = "2026-10-20";
const MIN = 60_000;

/** Mock provider: LeetCode GraphQL + YouTube Data API fixtures, switchable failure modes. */
const provider = {
  mode: "ok" as "ok" | "down" | "ratelimit",
  submissions: [] as Array<{ id: string; title: string; titleSlug: string; timestamp: string }>,
  potd: [] as Array<{ date: string; question: { titleSlug: string; title: string } }>,
  calls: 0,
};
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  provider.calls += 1;
  if (url.includes("leetcode.com/graphql")) {
    if (provider.mode === "down") return new Response("bad gateway", { status: 502 });
    if (provider.mode === "ratelimit") return new Response("slow down", { status: 429, headers: { "retry-after": "120" } });
    const body = JSON.parse(String(init?.body));
    if (body.query.includes("matchedUser")) {
      return Response.json({ data: { matchedUser: body.variables.username === "ghost" ? null : { username: body.variables.username } } });
    }
    if (body.query.includes("recentAcSubmissionList")) return Response.json({ data: { recentAcSubmissionList: provider.submissions } });
    if (body.query.includes("activeDailyCodingChallengeQuestion")) {
      return Response.json({ data: { activeDailyCodingChallengeQuestion: provider.potd[provider.potd.length - 1] ?? null } });
    }
    if (body.query.includes("dailyCodingChallengeV2")) return Response.json({ data: { dailyCodingChallengeV2: { challenges: provider.potd } } });
    if (body.query.includes("difficulty")) {
      return Response.json({ data: { question: { difficulty: body.variables.titleSlug.startsWith("hard") ? "Hard" : "Medium" } } });
    }
  }
  if (url.includes("googleapis.com/youtube/v3/playlists?")) return Response.json({ items: [{ snippet: { title: "OS Course" } }] });
  if (url.includes("googleapis.com/youtube/v3/playlistItems")) {
    return Response.json({
      items: Array.from({ length: 6 }, (_, i) => ({ contentDetails: { videoId: `video${i}abc` }, snippet: { title: `Lecture ${i + 1}` } })),
    });
  }
  if (url.includes("googleapis.com/youtube/v3/videos")) {
    return Response.json({
      items: Array.from({ length: 6 }, (_, i) => ({ id: `video${i}abc`, contentDetails: { duration: i === 2 ? "PT1H10M" : "PT40M" } })),
    });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

let t: TestEnv;
beforeAll(async () => {
  process.env.YOUTUBE_API_KEY = "test-key";
  const { env } = await import("../src/env.js");
  env.youtubeApiKey = "test-key";
  t = await setupTestEnv({ fetch: fakeFetch });
});
afterAll(async () => t.close());

describe("Workflow B — focus session", () => {
  it("tracks time from timestamps, survives refresh, and keeps task outcome separate", async () => {
    const u = await signUp(t.app, "Focuser");
    await setHours(u, "10:00", "22:00");
    t.clock.now = Date.parse(IST(DAY, "09:55"));
    const task = await u.post("/api/tasks", {
      title: "Solve 1 medium",
      estimatedMinutes: 50,
      verification: { provider: "leetcode", count: 1, difficulty: "Medium" },
    });
    await u.post("/api/schedules/generate", { date: DAY });
    const view = await u.get(`/api/schedules?start=${DAY}`);
    const block = view.body.blocks.find((b: { taskId: string }) => b.taskId === task.body.id);

    t.clock.now = Date.parse(block.startAt);
    const start = await u.post("/api/focus-sessions", { blockId: block.id, plannedMinutes: 50 });
    expect(start.status).toBe(201);
    expect((await u.post("/api/focus-sessions", { plannedMinutes: 25 })).status).toBe(409); // one at a time

    t.clock.now += 20 * MIN;
    await u.post(`/api/focus-sessions/${start.body.id}/pause`);
    t.clock.now += 7 * MIN;
    // "refresh": recover the session from the server
    const recovered = await u.get("/api/focus-sessions/active");
    expect(recovered.body.session.isPaused).toBe(true);
    expect(recovered.body.session.activeSeconds).toBe(20 * 60);
    await u.post(`/api/focus-sessions/${start.body.id}/resume`);
    t.clock.now += 30 * MIN;

    const done = await u.post(`/api/focus-sessions/${start.body.id}/finish`, { taskOutcome: "completed", note: "Two pointers" });
    expect(done.status).toBe(200);
    expect(done.body.session.activeSeconds).toBe(50 * 60);
    expect(done.body.session.pausedSeconds).toBe(7 * 60);
    expect(done.body.session.status).toBe("completed");
    // Outcome recorded, but NOT externally verified (no LeetCode connection).
    expect(done.body.completion.verificationStatus).toBe("unavailable");
    expect(done.body.completion.method).toBe("manual");

    // Duplicate completion is idempotent
    const dup = await u.post(`/api/tasks/${task.body.id}/complete`, {});
    expect(dup.body.duplicate).toBe(true);

    const after = await u.get(`/api/schedules?start=${DAY}`);
    const b2 = after.body.blocks.find((b: { id: string }) => b.id === block.id);
    expect(b2.status).toBe("completed");
    expect(b2.actualMinutes).toBe(50);

    const analytics = await u.get("/api/analytics/summary?days=7");
    expect(analytics.body.totals.focusMinutes).toBe(50);
    expect(analytics.body.totals.completions).toBe(1);
    expect(analytics.body.streak.current).toBe(1);

    // reopen voids (does not delete) the completion
    const reopened = await u.post(`/api/tasks/${task.body.id}/reopen`);
    expect(reopened.body.voidedAt).toBeTruthy();
  });

  it("a timer reaching zero never completes the task by itself", async () => {
    const u = await signUp(t.app, "TimerOnly");
    t.clock.now = Date.parse(IST(DAY, "11:00"));
    const task = await u.post("/api/tasks", { title: "Read", estimatedMinutes: 25 });
    const s = await u.post("/api/focus-sessions", { taskId: task.body.id, plannedMinutes: 25 });
    t.clock.now += 26 * MIN;
    const fin = await u.post(`/api/focus-sessions/${s.body.id}/finish`, {});
    expect(fin.body.completion).toBeNull();
    const tasks = await u.get("/api/tasks");
    expect(tasks.body.find((x: { id: string }) => x.id === task.body.id).status).not.toBe("completed");
    expect(tasks.body.find((x: { id: string }) => x.id === task.body.id).workedMinutes).toBe(26);
  });
});

describe("Workflow C — circles, challenges, leaderboard, privacy", () => {
  it("invite → join → challenge → progress → leaderboard, without leaking private data", async () => {
    t.clock.now = Date.parse(IST(DAY, "10:00"));
    const owner = await signUp(t.app, "Owner");
    const friend = await signUp(t.app, "Friend");
    const outsider = await signUp(t.app, "Outsider");

    const circle = await owner.post("/api/circles", { name: "DSA Prep", rankingMode: "consistency" });
    expect(circle.status).toBe(201);
    expect((await outsider.get(`/api/circles/${circle.body.id}/dashboard`)).status).toBe(404);

    const inv = await owner.post(`/api/circles/${circle.body.id}/invitations`, { maxUses: 1 });
    expect(inv.body.code).toMatch(/^[A-Z2-9]{10}$/);
    expect((await friend.post(`/api/invitations/${inv.body.code}/accept`)).status).toBe(200);
    expect((await outsider.post(`/api/invitations/${inv.body.code}/accept`)).status).toBe(400); // used up
    expect((await outsider.post(`/api/invitations/NOTREALCODE/accept`)).status).toBe(404);

    const ch = await owner.post("/api/challenges", {
      circleId: circle.body.id,
      title: "Daily problem",
      startDate: DAY,
      endDate: "2026-10-26",
      metric: "completions",
      individualTarget: 1,
      collectiveTarget: 5,
      taskTemplate: { title: "Solve a problem", estimatedMinutes: 30, splittable: false },
    });
    expect(ch.status).toBe(201);
    expect((await friend.post(`/api/challenges/${ch.body.id}/join`)).status).toBe(200);
    expect((await outsider.post(`/api/challenges/${ch.body.id}/join`)).status).toBe(404);

    // Friend has a private task and a challenge task.
    await friend.post("/api/tasks", { title: "Therapy appointment prep", description: "very private", estimatedMinutes: 30 });
    const friendTasks = await friend.get("/api/tasks");
    const chTask = friendTasks.body.find((x: { challengeId: string }) => x.challengeId === ch.body.id);
    expect(chTask).toBeTruthy();
    await friend.post(`/api/tasks/${chTask.id}/complete`, { occurrenceDate: DAY });

    const detail = await owner.get(`/api/challenges/${ch.body.id}`);
    const friendRow = detail.body.leaderboard.find((r: { user: { userId: string } }) => r.user.userId === friend.userId);
    expect(friendRow.progress).toBe(1);
    expect(detail.body.collective.value).toBe(1);

    const feed = await owner.get(`/api/circles/${circle.body.id}/activities`);
    const types = feed.body.items.map((a: { type: string }) => a.type);
    expect(types).toContain("task_completed");
    expect(types).toContain("challenge_milestone");
    expect(JSON.stringify(feed.body)).not.toContain("Therapy");
    expect(JSON.stringify(feed.body)).not.toContain("very private");

    const dash = await owner.get(`/api/circles/${circle.body.id}/dashboard`);
    expect(JSON.stringify(dash.body)).not.toContain("Therapy");
    expect(dash.body.members).toHaveLength(2);

    const lb = await owner.get(`/api/circles/${circle.body.id}/leaderboard?mode=challenge`);
    expect(lb.body.rows[0].user.userId).toBe(friend.userId);
    expect(lb.body.rows[0].breakdown[0].label).toBe("Challenge progress");

    // reactions & comments are members-only
    const act = feed.body.items[0].id;
    expect((await friend.post(`/api/activities/${act}/reactions`, { emoji: "🔥" })).body.reacted).toBe(true);
    expect((await outsider.post(`/api/activities/${act}/reactions`, { emoji: "🔥" })).status).toBe(404);

    // opting out hides a member from the leaderboard
    await friend.patch("/api/me", { preferences: { privacy: { showOnLeaderboard: false } } });
    const lb2 = await owner.get(`/api/circles/${circle.body.id}/leaderboard`);
    expect(lb2.body.hiddenCount).toBe(1);
    expect(lb2.body.rows.find((r: { user: { userId: string } }) => r.user.userId === friend.userId)).toBeUndefined();

    // member removal and leaving
    expect((await friend.del(`/api/circles/${circle.body.id}/members/${owner.userId}`)).status).toBe(403);
    expect((await owner.del(`/api/circles/${circle.body.id}/members/${friend.userId}`)).status).toBe(200);
    expect((await friend.get(`/api/circles/${circle.body.id}/dashboard`)).status).toBe(404);
    const inv2 = await owner.post(`/api/circles/${circle.body.id}/invitations`, {});
    expect((await friend.post(`/api/invitations/${inv2.body.code}/accept`)).status).toBe(403); // removed users can't self-rejoin
    const left = await owner.post(`/api/circles/${circle.body.id}/leave`);
    expect(left.body.deleted).toBe(true); // last member leaving deletes the circle
  });
});

describe("Integrations — LeetCode verification", () => {
  it("verifies only distinct qualifying submissions and isolates provider failures", async () => {
    const u = await signUp(t.app, "Coder");
    t.clock.now = Date.parse(IST(DAY, "09:00"));
    provider.mode = "ok";
    expect((await u.post("/api/integrations/leetcode/connect", { username: "ghost" })).status).toBe(404);
    expect((await u.post("/api/integrations/leetcode/connect", { username: "coder1" })).status).toBe(200);

    const task = await u.post("/api/tasks", {
      title: "Two mediums",
      estimatedMinutes: 60,
      recurrence: { type: "daily" },
      verification: { provider: "leetcode", count: 2, difficulty: "Medium" },
    });
    // Manual completion of an integration task is "pending", never verified.
    const manual = await u.post(`/api/tasks/${task.body.id}/complete`, { occurrenceDate: DAY });
    expect(manual.body.completion.verificationStatus).toBe("pending");

    const ts = (time: string) => String(Date.parse(IST(DAY, time)) / 1000);
    provider.submissions = [
      { id: "1", title: "Two Sum II", titleSlug: "two-sum-ii", timestamp: ts("10:00") },
      { id: "2", title: "Two Sum II", titleSlug: "two-sum-ii", timestamp: ts("10:05") }, // duplicate problem
      { id: "3", title: "Hard one", titleSlug: "hard-one", timestamp: ts("10:30") }, // wrong difficulty
    ];
    t.clock.now = Date.parse(IST(DAY, "11:00"));
    let sync = await u.post("/api/integrations/leetcode/sync");
    expect(sync.body.ok).toBe(true);
    let tasks = await u.get("/api/tasks");
    expect(tasks.body.find((x: { id: string }) => x.id === task.body.id).lastCompletion.verificationStatus).toBe("pending");

    // Provider outage: status unchanged, connection backs off.
    provider.mode = "down";
    sync = await u.post("/api/integrations/leetcode/sync");
    expect(sync.body.ok).toBe(false);
    tasks = await u.get("/api/tasks");
    expect(tasks.body.find((x: { id: string }) => x.id === task.body.id).lastCompletion.verificationStatus).toBe("pending");
    const list = await u.get("/api/integrations");
    expect(list.body.find((x: { provider: string }) => x.provider === "leetcode").connection.status).toBe("error");

    provider.mode = "ratelimit";
    sync = await u.post("/api/integrations/leetcode/sync");
    expect(sync.body.kind).toBe("rate_limited");

    // Recovery with a second distinct medium → verified, events deduplicated.
    provider.mode = "ok";
    provider.submissions.push({ id: "4", title: "LRU Cache", titleSlug: "lru-cache", timestamp: ts("10:45") });
    sync = await u.post("/api/integrations/leetcode/sync");
    expect(sync.body.ok).toBe(true);
    expect(sync.body.newEvents).toBe(1); // earlier events already stored
    tasks = await u.get("/api/tasks");
    const c = tasks.body.find((x: { id: string }) => x.id === task.body.id).lastCompletion;
    expect(c.verificationStatus).toBe("verified");

    // Re-running verification is idempotent.
    expect(await verifyTasks(t.services, u.userId, "leetcode")).toBe(0);
  });

  it("verifies the Problem of the Day using LeetCode's UTC day", async () => {
    const u = await signUp(t.app, "Potd"); // Asia/Kolkata
    t.clock.now = Date.parse("2026-10-20T05:00:00Z"); // 10:30 IST on Oct 20
    provider.mode = "ok";
    provider.submissions = [];
    provider.potd = [
      { date: "2026-10-19", question: { titleSlug: "potd-yesterday", title: "Yesterday" } },
      { date: "2026-10-20", question: { titleSlug: "potd-today", title: "Today" } },
    ];
    await u.post("/api/integrations/leetcode/connect", { username: "potduser" });
    const task = await u.post("/api/tasks", {
      title: "LeetCode POTD",
      estimatedMinutes: 45,
      recurrence: { type: "daily" },
      verification: { provider: "leetcode", mode: "potd" },
    });
    expect(task.status).toBe(201);
    const status = async () =>
      (await u.get("/api/tasks")).body.find((x: { id: string }) => x.id === task.body.id).lastCompletion?.verificationStatus ?? null;

    // A different problem, and today's POTD slug solved during the previous UTC day (04:30 IST): neither counts.
    provider.submissions = [
      { id: "p1", title: "Other", titleSlug: "some-other-problem", timestamp: String(Date.parse("2026-10-20T04:10:00Z") / 1000) },
      { id: "p2", title: "Today", titleSlug: "potd-today", timestamp: String(Date.parse("2026-10-19T23:00:00Z") / 1000) },
    ];
    let sync = await u.post("/api/integrations/leetcode/sync");
    expect(sync.body.ok).toBe(true);
    expect(await status()).toBeNull();

    // Solving today's POTD on the right UTC day verifies the occurrence.
    t.clock.now = Date.parse("2026-10-20T07:30:00Z");
    provider.submissions.push({ id: "p3", title: "Today", titleSlug: "potd-today", timestamp: String(Date.parse("2026-10-20T07:00:00Z") / 1000) });
    sync = await u.post("/api/integrations/leetcode/sync");
    expect(sync.body.verified).toBe(1);
    expect(await status()).toBe("verified");
  });

  it("disconnect deletes credentials and stops sync", async () => {
    const u = await signUp(t.app, "Leaver");
    provider.mode = "ok";
    await u.post("/api/integrations/leetcode/connect", { username: "leaver" });
    expect((await u.del("/api/integrations/leetcode")).status).toBe(204);
    await expect(syncConnection(t.services, u.userId, "leetcode")).rejects.toThrow();
    const rows = await t.database.db.select().from(integrationConnections);
    expect(rows.every((r) => !r.encryptedCredentials || r.encryptedCredentials.startsWith("v1:"))).toBe(true);
  });
});

describe("Workflow D — playlist import and multi-day plan", () => {
  it("imports, plans by real duration within the daily budget, and tracks progress", async () => {
    const u = await signUp(t.app, "Learner");
    await setHours(u, "18:00", "22:00");
    t.clock.now = Date.parse(IST(DAY, "09:00"));
    expect((await u.post("/api/playlists/import", { url: "https://example.com/watch?v=1" })).status).toBe(400);
    const imp = await u.post("/api/playlists/import", { url: "https://www.youtube.com/playlist?list=PLabcdefghijk" });
    expect(imp.status).toBe(201);
    const pl = imp.body.playlist;
    expect(pl.items).toHaveLength(6);
    expect(pl.stats.totalMinutes).toBe(5 * 40 + 70);

    // A class every Wednesday 18:00–20:00 must be respected.
    await u.post("/api/commitments", {
      title: "Evening class",
      startAt: IST("2026-10-21", "18:00"),
      endAt: IST("2026-10-21", "20:00"),
      recurrence: { type: "weekly", weekdays: [3] },
    });

    const cfg = {
      startDate: DAY,
      targetDate: "2026-10-23",
      studyWeekdays: [1, 2, 3, 4, 5],
      dailyMinutes: 90,
      sessionMinutes: 45,
      allowSplitVideos: true,
      inOrder: true,
      revisionMinutes: 0,
    };
    // 270 min at 90 min/day cannot fit in two days: infeasible, with a projected finish date.
    const tight = await u.post(`/api/playlists/${pl.id}/plan/preview`, { ...cfg, targetDate: "2026-10-21" });
    expect(tight.status).toBe(200);
    expect(tight.body.feasible).toBe(false);
    // Whole (≤45 min) videos don't always pack into the 90-minute budget, so 4 study days are needed.
    expect(tight.body.projectedFinish).toBe("2026-10-23");
    expect(tight.body.neededDailyMinutes).toBe(135);

    const preview = await u.post(`/api/playlists/${pl.id}/plan/preview`, cfg);
    expect(preview.body.feasible).toBe(true);
    const applied = await u.post(`/api/playlists/${pl.id}/plan/apply`, cfg);
    expect(applied.body.blocks).toEqual(preview.body.blocks); // deterministic: preview == applied

    const view = await u.get(`/api/schedules?start=${DAY}&end=2026-10-23`);
    const focus = view.body.blocks.filter((b: { kind: string }) => b.kind === "focus");
    const perDay = new Map<string, number>();
    for (const b of focus) perDay.set(b.day, (perDay.get(b.day) ?? 0) + (Date.parse(b.endAt) - Date.parse(b.startAt)) / MIN);
    for (const m of perDay.values()) expect(m).toBeLessThanOrEqual(90);
    expect([...perDay.values()].reduce((a, b) => a + b, 0)).toBe(270);
    // Distribution follows durations, not "videos ÷ days".
    expect(perDay.size).toBe(4);
    // Order is preserved and Wednesday's class is respected.
    const firstStart = (title: string) => Math.min(...focus.filter((b: { title: string }) => b.title === title).map((b: { startAt: string }) => Date.parse(b.startAt)));
    for (let i = 1; i < 6; i++) expect(firstStart(`Lecture ${i}`)).toBeLessThan(firstStart(`Lecture ${i + 1}`));
    for (const b of focus.filter((x: { day: string }) => x.day === "2026-10-21")) {
      expect(Date.parse(b.startAt)).toBeGreaterThanOrEqual(Date.parse(IST("2026-10-21", "20:00")));
    }
    // The 70-minute video is split into sessions no longer than 45 minutes.
    const long = focus.filter((b: { title: string }) => b.title === "Lecture 3");
    expect(long.length).toBe(2);

    // Self-reported progress: partial keeps position; completed completes the task manually (never "verified").
    const item = pl.items[0];
    const partial = await u.patch(`/api/playlist-items/${item.id}`, { status: "partial", positionSeconds: 600 });
    expect(partial.body.items[0].positionSeconds).toBe(600);
    const done = await u.patch(`/api/playlist-items/${item.id}`, { status: "completed" });
    expect(done.body.stats.completed).toBe(1);
    const tasks = await u.get("/api/tasks");
    const videoTask = tasks.body.find((x: { id: string }) => x.id === done.body.items[0].taskId);
    expect(videoTask.status).toBe("completed");
    expect(videoTask.lastCompletion.verificationStatus).toBe("manual");
  });

  it("offers a manual fallback when YouTube is not configured", async () => {
    const { env } = await import("../src/env.js");
    env.youtubeApiKey = "";
    const u = await signUp(t.app, "NoKey");
    const res = await u.post("/api/playlists/import", { url: "https://www.youtube.com/playlist?list=PLabcdefghijk" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("youtube_not_configured");
    const manual = await u.post("/api/playlists/manual", { title: "Course", lessons: [{ title: "L1", minutes: 30 }, { title: "L2", minutes: 45 }] });
    expect(manual.status).toBe(201);
    expect(manual.body.playlist.stats.totalMinutes).toBe(75);
    env.youtubeApiKey = "test-key";
  });
});
