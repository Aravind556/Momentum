import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RateLimiter } from "../src/modules/platforms/limiter.js";
import { syncAllDue } from "../src/modules/platforms/service.js";
import { IST, setupTestEnv, signUp, type TestEnv } from "./helpers.js";

const DAY = "2026-10-20";
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Mock Codeforces API + LeetCode problem lookups. */
const cf = {
  submissions: [] as Array<{ id: number; creationTimeSeconds: number; verdict: string; problem: { contestId: number; index: string; name: string; rating?: number; tags: string[] } }>,
  calls: [] as string[],
};
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname === "codeforces.com") {
    cf.calls.push(`${url.pathname}:${url.searchParams.get("handle") ?? ""}`);
    if (url.pathname === "/api/user.info") {
      const handle = url.searchParams.get("handles");
      if (handle === "ghost") return Response.json({ status: "FAILED", comment: "handles: User with handle ghost not found" }, { status: 400 });
      return Response.json({ status: "OK", result: [{ handle: handle === "tourist_lower" ? "Tourist" : handle }] });
    }
    if (url.pathname === "/api/user.status") return Response.json({ status: "OK", result: cf.submissions });
    if (url.pathname === "/api/problemset.problems") {
      return Response.json({ status: "OK", result: { problems: [{ contestId: 1850, index: "A", name: "To My Critics", rating: 800, tags: ["implementation"] }] } });
    }
  }
  if (url.hostname === "leetcode.com") {
    const body = JSON.parse(String(init?.body));
    if (body.query.includes("question(")) {
      return Response.json({ data: { question: { title: "Two Sum", difficulty: "Easy", topicTags: [{ name: "Array" }, { name: "Hash Table" }] } } });
    }
    if (body.query.includes("matchedUser")) return Response.json({ data: { matchedUser: { username: body.variables.username } } });
    if (body.query.includes("recentAcSubmissionList")) return Response.json({ data: { recentAcSubmissionList: [] } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

let t: TestEnv;
beforeAll(async () => {
  t = await setupTestEnv({ fetch: fakeFetch });
});
afterAll(async () => t.close());

describe("Codeforces", () => {
  it("connects a handle, imports accepted submissions, and verifies a problem task", async () => {
    const u = await signUp(t.app, "Cf");
    t.clock.now = Date.parse(IST(DAY, "09:00"));
    expect((await u.put("/api/integrations/codeforces", { handle: "ghost" })).status).toBe(404);
    expect((await u.put("/api/integrations/codeforces", { handle: "bad handle!" })).status).toBe(400);

    cf.submissions = [
      { id: 1, creationTimeSeconds: sec(IST("2026-10-18", "20:00")), verdict: "OK", problem: { contestId: 4, index: "A", name: "Watermelon", rating: 800, tags: ["math"] } },
      { id: 2, creationTimeSeconds: sec(IST("2026-10-18", "20:30")), verdict: "WRONG_ANSWER", problem: { contestId: 1850, index: "A", name: "To My Critics", rating: 800, tags: [] } },
    ];
    const connected = await u.put("/api/integrations/codeforces", { handle: "coder" });
    expect(connected.status).toBe(200);
    expect(connected.body.newEvents).toBe(1); // only the accepted one; first sync imports history

    const task = await u.post("/api/tasks", {
      title: "CF 1850A",
      estimatedMinutes: 25,
      verification: { provider: "codeforces", mode: "problem", key: "1850A" },
    });
    expect(task.status).toBe(201);
    expect((await u.post("/api/tasks", { title: "x", estimatedMinutes: 25, verification: { provider: "codeforces", mode: "problem" } })).status).toBe(400);

    // The earlier wrong answer doesn't count; an accepted submission after the task opened does.
    cf.submissions.unshift({ id: 3, creationTimeSeconds: sec(IST(DAY, "10:00")), verdict: "OK", problem: { contestId: 1850, index: "A", name: "To My Critics", rating: 800, tags: ["implementation"] } });
    t.clock.now = Date.parse(IST(DAY, "10:30"));
    const sync = await u.post("/api/integrations/codeforces/sync");
    expect(sync.body.ok).toBe(true);
    expect(sync.body.verified).toBe(1);
    const tasks = await u.get("/api/tasks");
    expect(tasks.body.find((x: { id: string }) => x.id === task.body.id).lastCompletion.verificationStatus).toBe("verified");

    // Individual tracking: distinct problems, difficulty buckets, feed.
    const stats = await u.get("/api/progress/coding");
    expect(stats.body.totalSolved).toBe(2);
    expect(stats.body.byPlatform.codeforces.byDifficulty.Easy).toBe(2);
    expect(stats.body.streak.current).toBe(1);
    expect(stats.body.topTags.map((x: { tag: string }) => x.tag)).toContain("math");
    const feed = await u.get("/api/submissions?limit=1");
    expect(feed.body.items[0]).toMatchObject({ provider: "codeforces", problemKey: "1850A", title: "To My Critics", url: "https://codeforces.com/problemset/problem/1850/A" });
    const page2 = await u.get(`/api/submissions?limit=1&cursor=${feed.body.nextCursor}`);
    expect(page2.body.items[0].problemKey).toBe("4A");
    expect(page2.body.nextCursor).toBeNull();
  });
});

describe("problem links", () => {
  it("resolves titles and difficulty for known platforms and falls back for others", async () => {
    const u = await signUp(t.app, "Resolver");
    const lc = await u.post("/api/problems/resolve", { url: "https://leetcode.com/problems/two-sum/description/" });
    expect(lc.body).toMatchObject({ category: "leetcode", problemKey: "two-sum", title: "Two Sum", difficulty: "Easy", estMinutes: 25, verified: true });
    const cfp = await u.post("/api/problems/resolve", { url: "https://codeforces.com/contest/1850/problem/A" });
    expect(cfp.body).toMatchObject({ category: "codeforces", problemKey: "1850A", title: "To My Critics", difficulty: "800" });
    const cc = await u.post("/api/problems/resolve", { url: "https://www.codechef.com/problems/FLOW001" });
    expect(cc.body).toMatchObject({ category: "codechef", platform: null, title: "FLOW001", verified: false });
    expect((await u.post("/api/problems/resolve", { url: "hello" })).status).toBe(400);
  });
});

describe("background sync policy", () => {
  it("syncs users with pending verified tasks more often than idle users", async () => {
    const busy = await signUp(t.app, "Busy");
    const idle = await signUp(t.app, "Idle");
    t.clock.now = Date.parse(IST("2026-10-21", "08:00"));
    cf.submissions = [];
    await busy.put("/api/integrations/codeforces", { handle: "busy" });
    await idle.put("/api/integrations/codeforces", { handle: "idle" });
    await busy.post("/api/tasks", { title: "Two problems", estimatedMinutes: 60, verification: { provider: "codeforces", count: 2 } });

    const synced = (handle: string) => cf.calls.filter((c) => c === `/api/user.status:${handle}`).length;
    // 3 hours later: only the user with a pending Codeforces task is due.
    t.clock.now += 3 * 3600_000;
    await syncAllDue(t.services);
    expect([synced("busy"), synced("idle")]).toEqual([2, 1]);
    // 13 hours later everyone is due (history stays complete).
    t.clock.now += 10 * 3600_000;
    await syncAllDue(t.services);
    expect([synced("busy"), synced("idle")]).toEqual([3, 2]);
  });
});

describe("RateLimiter", () => {
  it("spaces request starts and lets user requests jump ahead of background ones", async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = new RateLimiter(2_000, () => now, async (ms) => {
      slept.push(ms);
      now += ms;
    });
    const order: string[] = [];
    const job = (name: string) => async () => {
      order.push(`${name}@${now}`);
      return name;
    };
    const results = await Promise.all([
      limiter.schedule(job("bg1"), "background"),
      limiter.schedule(job("bg2"), "background"),
      limiter.schedule(job("click"), "user"),
    ]);
    expect(results).toEqual(["bg1", "bg2", "click"]);
    expect(order).toEqual(["bg1@0", "click@2000", "bg2@4000"]);
    expect(slept).toEqual([2000, 2000]);
  });
});
