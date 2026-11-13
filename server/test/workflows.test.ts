import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IST, setHours, setupTestEnv, signUp, type TestEnv } from "./helpers.js";
import { verifyTasks, syncConnection } from "../src/modules/platforms/service.js";
import { integrationConnections } from "../src/core/db/schema.js";

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
  const { env } = await import("../src/core/env.js");
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

describe("Integrations — LeetCode verification", () => {
  it("verifies only distinct qualifying submissions and isolates provider failures", async () => {
    const u = await signUp(t.app, "Coder");
    t.clock.now = Date.parse(IST(DAY, "09:00"));
    provider.mode = "ok";
    expect((await u.put("/api/integrations/leetcode", { handle: "ghost" })).status).toBe(404);
    expect((await u.put("/api/integrations/leetcode", { handle: "coder1" })).status).toBe(200);

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
    // "Sync now" has a 60 s cooldown; within it the last result is returned without calling LeetCode.
    const syncNow = () => {
      t.clock.now += 61_000;
      return u.post("/api/integrations/leetcode/sync");
    };
    let sync = await syncNow();
    expect(sync.body.ok).toBe(true);
    const calls = provider.calls;
    const again = await u.post("/api/integrations/leetcode/sync");
    expect(again.body.cooldown).toBe(true);
    expect(provider.calls).toBe(calls);
    let tasks = await u.get("/api/tasks");
    expect(tasks.body.find((x: { id: string }) => x.id === task.body.id).lastCompletion.verificationStatus).toBe("pending");

    // Provider outage: status unchanged, connection backs off.
    provider.mode = "down";
    sync = await syncNow();
    expect(sync.body.ok).toBe(false);
    tasks = await u.get("/api/tasks");
    expect(tasks.body.find((x: { id: string }) => x.id === task.body.id).lastCompletion.verificationStatus).toBe("pending");
    const list = await u.get("/api/integrations");
    expect(list.body.find((x: { provider: string }) => x.provider === "leetcode").connection.status).toBe("error");

    provider.mode = "ratelimit";
    sync = await syncNow();
    expect(sync.body.kind).toBe("rate_limited");

    // Recovery with a second distinct medium → verified, events deduplicated.
    provider.mode = "ok";
    provider.submissions.push({ id: "4", title: "LRU Cache", titleSlug: "lru-cache", timestamp: ts("10:45") });
    sync = await syncNow();
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
    await u.put("/api/integrations/leetcode", { handle: "potduser" });
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

  it("keeps a group POTD open until LeetCode's day ends, and matches it to the right date", async () => {
    // Late-night solve (IST): LeetCode's 20 Oct problem is still live until 05:30 IST on 21 Oct.
    const u = await signUp(t.app, "NightOwl"); // Asia/Kolkata
    t.clock.now = Date.parse(IST(DAY, "10:00"));
    provider.mode = "ok";
    provider.submissions = [];
    provider.potd = [
      { date: "2026-10-20", question: { titleSlug: "potd-twenty", title: "Twenty" } },
      { date: "2026-10-21", question: { titleSlug: "potd-twentyone", title: "Twenty-one" } },
    ];
    await u.put("/api/integrations/leetcode", { handle: "nightowl" });
    const g = await u.post("/api/groups", { name: "Night owls" });
    expect((await u.post(`/api/groups/${g.body.id}/tasks`, { kind: "potd", repeat: "daily", startDate: DAY, dueTime: "23:59" })).status).toBe(201);
    type Item = { taskId: string; source: string; status: string; openUntil: string | null };
    const items = async () => (await u.get("/api/today")).body.items as Item[];
    const potds = async () => (await items()).filter((i) => i.source === "group");
    expect(await potds()).toHaveLength(1);

    // 00:20 IST on 21 Oct: they solve the 20 Oct problem (18:50 UTC on 20 Oct).
    t.clock.now = Date.parse(IST("2026-10-21", "00:30"));
    provider.submissions = [{ id: "n1", title: "Twenty", titleSlug: "potd-twenty", timestamp: String(Date.parse("2026-10-20T18:50:00Z") / 1000) }];
    let list = await potds();
    const yesterday = list.find((i) => i.openUntil)!;
    const today = list.find((i) => !i.openUntil)!;
    expect(yesterday.openUntil).toBe("2026-10-21T00:00:00.000Z"); // 05:30 IST
    // The group page lists yesterday's POTD too, with the viewer's own task to check.
    const groupTasks = async () => (await u.get(`/api/groups/${g.body.id}/today`)).body.tasks as Array<{ occurrence: string; openUntil: string | null; doneCount: number; mine: { taskId: string; done: boolean; check: string } | null }>;
    let gt = await groupTasks();
    expect(gt.map((x) => x.occurrence).sort()).toEqual([DAY, "2026-10-21"]);
    const gy = gt.find((x) => x.openUntil)!;
    expect(gy.occurrence).toBe(DAY);
    expect(gy.mine).toMatchObject({ taskId: yesterday.taskId, done: false, check: "submission" });
    expect(gt.find((x) => !x.openUntil)!.mine!.taskId).toBe(today.taskId);
    // Ticking yesterday's counts; it doesn't tick today's (today's problem isn't even out yet).
    expect((await u.post(`/api/today/tasks/${yesterday.taskId}/check`)).body.status).toBe("verified");
    expect((await u.post(`/api/today/tasks/${today.taskId}/check`)).body.status).toBe("not_found_yet");
    list = await potds();
    expect(list.find((i) => i.taskId === yesterday.taskId)!.status).toBe("done");
    expect(list.find((i) => i.taskId === today.taskId)!.status).toBe("pending");
    // ...and the group page shows it done for yesterday only, with its points.
    gt = await groupTasks();
    expect(gt.find((x) => x.openUntil)!.mine!.done).toBe(true);
    expect(gt.find((x) => x.openUntil)!.doneCount).toBe(1);
    expect(gt.find((x) => !x.openUntil)!.doneCount).toBe(0);
    // Today's summary only counts today's work.
    expect((await u.get("/api/today")).body.summary.done).toBe(0);

    // After 05:30 IST yesterday's is gone from Today; solving the 21 Oct problem ticks today's.
    t.clock.now = Date.parse(IST("2026-10-21", "09:00"));
    list = await potds();
    expect(list).toHaveLength(1);
    expect(list[0]!.taskId).toBe(today.taskId);
    expect((await groupTasks()).map((x) => x.occurrence)).toEqual(["2026-10-21"]);
    provider.submissions.push({ id: "n2", title: "Twenty-one", titleSlug: "potd-twentyone", timestamp: String(Date.parse("2026-10-21T03:00:00Z") / 1000) });
    t.clock.now += 2 * MIN; // past the manual-sync cooldown
    expect((await u.post(`/api/today/tasks/${today.taskId}/check`)).body.status).toBe("verified");
  });

  it("keeps yesterday's row of a personal daily POTD task open until LeetCode's day ends", async () => {
    const u = await signUp(t.app, "Daily"); // Asia/Kolkata
    t.clock.now = Date.parse(IST("2026-10-24", "10:00"));
    provider.mode = "ok";
    provider.submissions = [];
    provider.potd = [
      { date: "2026-10-24", question: { titleSlug: "potd-24", title: "Twenty-four" } },
      { date: "2026-10-25", question: { titleSlug: "potd-25", title: "Twenty-five" } },
    ];
    await u.put("/api/integrations/leetcode", { handle: "dailyuser" });
    const made = await u.post("/api/tasks", { title: "POTD", estimatedMinutes: 40, recurrence: { type: "daily" }, verification: { provider: "leetcode", mode: "potd" } });
    expect(made.status).toBe(201);
    type Item = { taskId: string; title: string; status: string; occurrence: string | null; openUntil: string | null };
    const rows = async () => ((await u.get("/api/today")).body.items as Item[]).filter((i) => i.title === "POTD");

    // 00:30 IST on 25 Oct: they solve the 24 Oct problem (18:50 UTC on 24 Oct).
    t.clock.now = Date.parse(IST("2026-10-25", "00:30"));
    provider.submissions = [{ id: "d1", title: "Twenty-four", titleSlug: "potd-24", timestamp: String(Date.parse("2026-10-24T18:50:00Z") / 1000) }];
    let list = await rows();
    expect(list.map((r) => r.occurrence).sort()).toEqual(["2026-10-24", "2026-10-25"]);
    const old = list.find((r) => r.openUntil)!;
    const now = list.find((r) => !r.openUntil)!;
    expect(old.occurrence).toBe("2026-10-24");
    expect(old.openUntil).toBe("2026-10-25T00:00:00.000Z"); // 05:30 IST

    // Checking yesterday's row verifies the 24th; today's row (the 25th) stays pending.
    expect((await u.post(`/api/today/tasks/${old.taskId}/check`, { occurrence: "2026-10-24" })).body.status).toBe("verified");
    list = await rows();
    expect(list.find((r) => r.openUntil)!.status).toBe("done");
    expect(list.find((r) => !r.openUntil)!.status).toBe("pending");
    expect((await u.get("/api/today")).body.summary.done).toBe(0);

    // Only yesterday can be ticked this way, and only while it's open.
    expect((await u.post(`/api/today/tasks/${old.taskId}/check`, { occurrence: "2026-10-20" })).status).toBe(400);
    t.clock.now = Date.parse(IST("2026-10-25", "06:00"));
    expect(await rows()).toHaveLength(1);
    expect((await u.post(`/api/today/tasks/${old.taskId}/check`, { occurrence: "2026-10-24" })).status).toBe(400);
    expect(now.occurrence).toBe("2026-10-25");
  });

  it("applies LeetCode's day to a one-off POTD task too (solved after its due time, or before it was created)", async () => {
    const u = await signUp(t.app, "OneOff"); // Asia/Kolkata
    provider.mode = "ok";
    provider.potd = [
      { date: "2026-10-26", question: { titleSlug: "potd-26", title: "Twenty-six" } },
      { date: "2026-10-27", question: { titleSlug: "potd-27", title: "Twenty-seven" } },
    ];
    await u.put("/api/integrations/leetcode", { handle: "oneoffuser" });
    t.clock.now = Date.parse(IST("2026-10-26", "10:00"));
    provider.submissions = [];
    const potd = { provider: "leetcode", mode: "potd" };
    const due = await u.post("/api/tasks", { title: "Solve POTD", estimatedMinutes: 40, dueAt: IST("2026-10-26", "23:59"), verification: potd });
    expect(due.status).toBe(201);
    const state = async (id: string) => (await u.get("/api/tasks")).body.find((x: { id: string }) => x.id === id).lastCompletion?.verificationStatus ?? null;

    // 00:30 IST on the 27th, after the task's due time: the 26th's problem was solved at 00:14 IST.
    t.clock.now = Date.parse(IST("2026-10-27", "00:30"));
    provider.submissions = [{ id: "o1", title: "Twenty-six", titleSlug: "potd-26", timestamp: String(Date.parse("2026-10-26T18:44:00Z") / 1000) }];
    expect((await u.post("/api/integrations/leetcode/sync")).body.verified).toBe(1);
    expect(await state(due.body.id)).toBe("verified");

    // A task created after the problem was solved still counts it (it's that day's problem).
    t.clock.now = Date.parse(IST("2026-10-27", "12:00"));
    provider.submissions.push({ id: "o2", title: "Twenty-seven", titleSlug: "potd-27", timestamp: String(Date.parse("2026-10-27T03:00:00Z") / 1000) });
    const late = await u.post("/api/tasks", { title: "Log today's POTD", estimatedMinutes: 40, dueAt: IST("2026-10-27", "23:59"), verification: potd });
    t.clock.now += 2 * MIN;
    expect((await u.post("/api/integrations/leetcode/sync")).body.verified).toBe(1);
    expect(await state(late.body.id)).toBe("verified");
  });

  it("closes yesterday's unsolved POTD once LeetCode's day ends", async () => {
    const u = await signUp(t.app, "Sleeper");
    t.clock.now = Date.parse(IST("2026-10-22", "10:00"));
    provider.submissions = [];
    const g = await u.post("/api/groups", { name: "Sleepers" });
    await u.post(`/api/groups/${g.body.id}/tasks`, { kind: "potd", repeat: "daily", startDate: "2026-10-22", dueTime: "23:59" });
    const potds = async () => ((await u.get("/api/today")).body.items as Array<{ source: string; openUntil: string | null }>).filter((i) => i.source === "group");
    t.clock.now = Date.parse(IST("2026-10-23", "01:00"));
    expect((await potds()).filter((i) => i.openUntil)).toHaveLength(1);
    t.clock.now = Date.parse(IST("2026-10-23", "06:00"));
    expect((await potds()).filter((i) => i.openUntil)).toHaveLength(0);
  });

  it("disconnect stops sync", async () => {
    const u = await signUp(t.app, "Leaver");
    provider.mode = "ok";
    await u.put("/api/integrations/leetcode", { handle: "leaver" });
    expect((await u.del("/api/integrations/leetcode")).status).toBe(204);
    await expect(syncConnection(t.services, u.userId, "leetcode")).rejects.toThrow();
    const rows = await t.database.db.select().from(integrationConnections);
    expect(rows.find((r) => r.userId === u.userId)?.status).toBe("disconnected");
  });
});
