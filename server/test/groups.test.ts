import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IST, setHours, setupTestEnv, signUp, type Client, type TestEnv } from "./helpers.js";

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
type Sub = { id: number; creationTimeSeconds: number; verdict: string; problem: { contestId: number; index: string; name: string; rating?: number; tags: string[] } };
/** Codeforces submissions per handle. */
const subs = new Map<string, Sub[]>();
const PROBLEMS = [
  { contestId: 4, index: "A", name: "Watermelon", rating: 800, tags: [] },
  { contestId: 71, index: "A", name: "Way Too Long Words", rating: 800, tags: [] },
  { contestId: 1873, index: "F", name: "Money Trees", rating: 1700, tags: [] },
];
const fakeFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname === "codeforces.com") {
    if (url.pathname === "/api/user.info") return Response.json({ status: "OK", result: [{ handle: url.searchParams.get("handles") }] });
    if (url.pathname === "/api/user.status") return Response.json({ status: "OK", result: subs.get(url.searchParams.get("handle")!) ?? [] });
    if (url.pathname === "/api/problemset.problems") return Response.json({ status: "OK", result: { problems: PROBLEMS } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;
const solve = (handle: string, id: number, contestId: number, index: string, iso: string) => {
  const p = PROBLEMS.find((x) => x.contestId === contestId && x.index === index)!;
  subs.set(handle, [{ id, creationTimeSeconds: sec(iso), verdict: "OK", problem: p }, ...(subs.get(handle) ?? [])]);
};

let t: TestEnv;
beforeAll(async () => {
  t = await setupTestEnv({ fetch: fakeFetch });
  t.clock.now = Date.parse(IST("2026-10-20", "08:00")); // Tuesday
});
afterAll(async () => t.close());

async function member(name: string) {
  const u = await signUp(t.app, name);
  await setHours(u, "09:00", "21:00");
  await u.put("/api/integrations/codeforces", { handle: name.toLowerCase() });
  return u;
}
async function join(u: Client, owner: Client, groupId: string) {
  const inv = await owner.post(`/api/groups/${groupId}/invitations`, {});
  expect((await u.post(`/api/invitations/${inv.body.code}/accept`)).status).toBe(200);
}
const todayItems = async (u: Client) => (await u.get("/api/today")).body.items as Array<{ taskId: string; title: string; source: string; label: string; status: string; swappable: boolean }>;

describe("groups", () => {
  it("controls access: invitations, roles, removal, privacy", async () => {
    const owner = await member("Owner");
    const friend = await member("Friend");
    const outsider = await member("Outsider");
    const g = await owner.post("/api/groups", { name: "DSA Prep" });
    expect(g.status).toBe(201);
    expect((await outsider.get(`/api/groups/${g.body.id}`)).status).toBe(404);
    await join(friend, owner, g.body.id);
    expect((await outsider.post("/api/invitations/NOTREALCODE/accept")).status).toBe(404);
    const overview = await owner.get(`/api/groups/${g.body.id}`);
    expect(overview.body.members).toHaveLength(2);
    // Private tasks never leak into group views.
    await friend.post("/api/tasks", { title: "Therapy appointment prep", estimatedMinutes: 30 });
    expect(JSON.stringify((await owner.get(`/api/groups/${g.body.id}/leaderboard`)).body)).not.toContain("Therapy");
    // Opting out of leaderboards hides you.
    await friend.patch("/api/me", { preferences: { privacy: { shareCompletions: true, shareFocusSessions: false, shareStreaks: true, showOnLeaderboard: false, shareFocusPresence: false } } });
    expect((await owner.get(`/api/groups/${g.body.id}/leaderboard`)).body.hiddenCount).toBe(1);
    // Members can't set group tasks or remove the owner; removed members can't rejoin.
    expect((await friend.post(`/api/groups/${g.body.id}/tasks`, { kind: "custom", title: "x", startDate: "2026-10-20" })).status).toBe(403);
    expect((await friend.del(`/api/groups/${g.body.id}/members/${owner.userId}`)).status).toBe(403);
    expect((await owner.del(`/api/groups/${g.body.id}/members/${friend.userId}`)).status).toBe(200);
    const inv2 = await owner.post(`/api/groups/${g.body.id}/invitations`, {});
    expect((await friend.post(`/api/invitations/${inv2.body.code}/accept`)).status).toBe(403);
    expect((await owner.post(`/api/groups/${g.body.id}/leave`)).body.deleted).toBe(true);
  });

  it("shares roadmaps for opt-in subscription and shows group roadmaps live", async () => {
    const ana = await member("Ana");
    const ben = await member("Ben");
    const g = await ana.post("/api/groups", { name: "Graphs gang" });
    await join(ben, ana, g.body.id);
    const r = await ana.post("/api/roadmaps", { title: "CF 800", items: "https://codeforces.com/problemset/problem/4/A\nhttps://codeforces.com/problemset/problem/71/A", follow: { newPace: "frequent" } });

    // Not shared yet: Ben can't see it. Only the owner can share.
    expect((await ben.get(`/api/roadmaps/${r.body.id}`)).status).toBe(404);
    expect((await ben.post(`/api/roadmaps/${r.body.id}/shares/${g.body.id}`)).status).toBe(404);
    expect((await ana.post(`/api/roadmaps/${r.body.id}/shares/${g.body.id}`)).status).toBe(200);

    // Sharing subscribes nobody: Ben's day is untouched until he opts in.
    expect((await todayItems(ben)).filter((i) => i.source === "roadmap")).toHaveLength(0);
    let shared = (await ben.get(`/api/groups/${g.body.id}/roadmaps`)).body;
    expect(shared[0]).toMatchObject({ title: "CF 800", iFollow: false, isGroupRoadmap: false, almostGroup: true, memberCount: 2 });
    expect((await ben.get(`/api/roadmaps/${r.body.id}`)).status).toBe(200); // can view it through the group

    // Ben subscribes at his own pace → it becomes a group roadmap, and it's on his day.
    const sub = await ben.post(`/api/groups/${g.body.id}/roadmaps/${r.body.id}/subscribe`, { newPace: "decent", revision: "rare" });
    expect(sub.status).toBe(200);
    shared = (await ben.get(`/api/groups/${g.body.id}/roadmaps`)).body;
    expect(shared[0]).toMatchObject({ iFollow: true, isGroupRoadmap: true });
    expect((await todayItems(ben)).filter((i) => i.source === "roadmap").map((i) => i.title)).toEqual(["Watermelon"]);
    expect((await ana.get(`/api/roadmaps/${r.body.id}`)).body.followers).toBe(2);

    // A new member who hasn't subscribed → no longer a group roadmap.
    const cam = await member("Cam");
    await join(cam, ana, g.body.id);
    expect((await ana.get(`/api/groups/${g.body.id}/roadmaps`)).body[0]).toMatchObject({ isGroupRoadmap: false, almostGroup: true });

    // Finishing a shared-roadmap item earns points in the group (flat, by difficulty).
    solve("ben", 1, 4, "A", IST("2026-10-20", "10:00"));
    t.clock.now = Date.parse(IST("2026-10-20", "10:30"));
    const item = (await todayItems(ben)).find((i) => i.title === "Watermelon")!;
    expect((await ben.post(`/api/today/tasks/${item.taskId}/check`)).body.status).toBe("verified");
    const lb = (await ana.get(`/api/groups/${g.body.id}/leaderboard`)).body;
    expect(lb.rows[0]).toMatchObject({ user: { displayName: "Ben" }, points: 10, completions: 1 });
    expect(lb.rules).toContain("Easy 10");
    // Progress shows on the group's roadmap list.
    expect((await ana.get(`/api/groups/${g.body.id}/roadmaps`)).body[0].followers.find((f: { user: { displayName: string } }) => f.user.displayName === "Ben").done).toBe(1);
  });

  it("puts group tasks on everyone's day, verifies each member, and ranks by finishing time", async () => {
    t.clock.now = Date.parse(IST("2026-10-20", "08:00"));
    const lead = await member("Lead");
    const x = await member("Xiao");
    const y = await member("Yuki");
    const g = await lead.post("/api/groups", { name: "Daily CF" });
    await join(x, lead, g.body.id);
    await join(y, lead, g.body.id);

    const task = await lead.post(`/api/groups/${g.body.id}/tasks`, {
      kind: "problem",
      url: "https://codeforces.com/problemset/problem/1873/F",
      repeat: "daily",
      startDate: "2026-10-20",
      dueTime: "21:00",
    });
    expect(task.status).toBe(201);
    expect(task.body).toMatchObject({ title: "Money Trees", difficulty: "1700", points: 20, category: "codeforces" });
    expect((await lead.post(`/api/groups/${g.body.id}/tasks`, { kind: "problem", startDate: "2026-10-20" })).status).toBe(400);

    // On every member's day, labelled with the group, not swappable.
    for (const u of [lead, x, y]) {
      const it = (await todayItems(u)).find((i) => i.source === "group")!;
      expect(it).toMatchObject({ title: "Money Trees", label: "Daily CF", swappable: false });
    }
    const xTask = (await todayItems(x)).find((i) => i.source === "group")!;
    expect((await x.post(`/api/today/tasks/${xTask.taskId}/swap`, { source: "roadmap", sourceId: "nope" })).body.error.code).toBe("not_swappable");

    // Yuki solves first (10:00), Xiao second (11:00) but syncs first: ranks follow submission time.
    solve("xiao", 10, 1873, "F", IST("2026-10-20", "11:00"));
    solve("yuki", 20, 1873, "F", IST("2026-10-20", "10:00"));
    t.clock.now = Date.parse(IST("2026-10-20", "11:30"));
    expect((await x.post(`/api/today/tasks/${xTask.taskId}/check`)).body.status).toBe("verified");
    const yTask = (await todayItems(y)).find((i) => i.source === "group")!;
    expect((await y.post(`/api/today/tasks/${yTask.taskId}/check`)).body.status).toBe("verified");

    const board = (await lead.get(`/api/groups/${g.body.id}/today`)).body.tasks[0];
    expect(board).toMatchObject({ doneCount: 2, memberCount: 3 });
    const status = Object.fromEntries(board.members.map((m: { user: { displayName: string }; rank: number | null; points: number | null }) => [m.user.displayName, [m.rank, m.points]]));
    expect(status).toEqual({ Yuki: [1, 30], Xiao: [2, 26], Lead: [null, null] });

    const lb = (await lead.get(`/api/groups/${g.body.id}/leaderboard?period=week`)).body.rows;
    expect(lb.map((r: { user: { displayName: string }; points: number; rank: number }) => [r.user.displayName, r.points, r.rank])).toEqual([
      ["Yuki", 30, 1],
      ["Xiao", 26, 2],
      ["Lead", 0, null], // no points yet → not ranked
    ]);
    expect((await x.get("/api/groups")).body[0]).toMatchObject({ myRank: 2, myPoints: 26 });

    // Daily tasks come back tomorrow; archived ones stop.
    t.clock.now = Date.parse(IST("2026-10-21", "08:00"));
    expect((await todayItems(x)).some((i) => i.source === "group")).toBe(true);
    await lead.del(`/api/groups/${g.body.id}/tasks/${task.body.id}`);
    expect((await todayItems(x)).some((i) => i.source === "group" && i.status === "pending")).toBe(false);
  });
});
