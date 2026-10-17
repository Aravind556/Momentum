import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IST, setHours, setupTestEnv, signUp, type Client, type TestEnv } from "./helpers.js";

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
type Sub = { id: number; creationTimeSeconds: number; verdict: string; problem: { contestId: number; index: string; name: string; rating?: number; tags: string[] } };
const cf = { submissions: [] as Sub[] };
const PROBLEMS = [
  { contestId: 4, index: "A", name: "Watermelon", rating: 800, tags: [] },
  { contestId: 71, index: "A", name: "Way Too Long Words", rating: 800, tags: [] },
  { contestId: 158, index: "A", name: "Next Round", rating: 800, tags: [] },
  { contestId: 231, index: "A", name: "Team", rating: 800, tags: [] },
];
const fakeFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname === "codeforces.com") {
    if (url.pathname === "/api/user.info") return Response.json({ status: "OK", result: [{ handle: url.searchParams.get("handles") }] });
    if (url.pathname === "/api/user.status") return Response.json({ status: "OK", result: cf.submissions });
    if (url.pathname === "/api/problemset.problems") return Response.json({ status: "OK", result: { problems: PROBLEMS } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;
const solve = (id: number, contestId: number, index: string, iso: string) =>
  cf.submissions.unshift({ id, creationTimeSeconds: sec(iso), verdict: "OK", problem: { ...PROBLEMS.find((p) => p.contestId === contestId)!, index } });

let t: TestEnv;
beforeAll(async () => {
  t = await setupTestEnv({ fetch: fakeFetch });
});
afterAll(async () => t.close());

interface Item {
  taskId: string;
  title: string;
  source: string;
  label: string;
  status: string;
  check: string;
  verifiedBy: string | null;
  block: { startAt: string } | null;
  review: { cardId: string; quality: number | null } | null;
}
const today = async (u: Client) => (await u.get("/api/today")).body as { day: string; items: Item[]; deferred: number; summary: { total: number; done: number } };
const titles = (items: Item[]) => items.filter((i) => i.status !== "skipped").map((i) => i.title).sort();

async function learner(name: string) {
  const u = await signUp(t.app, name);
  await setHours(u, "09:00", "21:00");
  cf.submissions = [];
  await u.put("/api/integrations/codeforces", { handle: name.toLowerCase() });
  return u;
}

const CF_LIST = "https://codeforces.com/problemset/problem/4/A\nhttps://codeforces.com/problemset/problem/71/A\nhttps://codeforces.com/problemset/problem/158/A\nhttps://codeforces.com/problemset/problem/231/A";

describe("daily plan", () => {
  it("adds new roadmap items by pace, schedules them, and updates when the pace changes", async () => {
    t.clock.now = Date.parse(IST("2026-10-20", "08:00")); // Tuesday
    const u = await learner("Pacer");
    const r = await u.post("/api/roadmaps", { title: "CF 800", items: `${CF_LIST}\nRead about greedy`, follow: { newPace: "decent", preferredTime: "evening" } });
    let d = await today(u);
    expect(titles(d.items)).toEqual(["Watermelon"]);
    const item = d.items[0]!;
    expect(item).toMatchObject({ source: "roadmap", label: "CF 800", check: "submission", status: "pending" });
    // Open all day: no time slot unless the learner sets one.
    expect(item.block).toBeNull();
    const timed = await u.put(`/api/today/tasks/${item.taskId}/time`, { start: "19:00", minutes: 30 });
    expect(timed.status).toBe(200);
    let withTime = (await today(u)).items[0]!;
    expect(withTime.block!.startAt).toBe(new Date(IST("2026-10-20", "19:00")).toISOString());
    await u.post("/api/today/replan"); // re-planning never moves a time the learner chose
    withTime = (await today(u)).items[0]!;
    expect(withTime.block!.startAt).toBe(new Date(IST("2026-10-20", "19:00")).toISOString());
    await u.del(`/api/today/tasks/${item.taskId}/time`);
    expect((await today(u)).items[0]!.block).toBeNull();

    // Idempotent.
    expect(titles((await today(u)).items)).toEqual(["Watermelon"]);

    // Changing the pace re-plans today immediately.
    await u.patch(`/api/roadmaps/${r.body.id}/follow`, { newPace: "frequent" });
    d = await today(u);
    expect(titles(d.items)).toEqual(["Watermelon", "Way Too Long Words"]);
    await u.patch(`/api/roadmaps/${r.body.id}/follow`, { newPace: "rare" }); // Tuesday is a rest day
    expect(titles((await today(u)).items)).toEqual([]);
    await u.patch(`/api/roadmaps/${r.body.id}/follow`, { newPace: "decent" });
    expect(titles((await today(u)).items)).toEqual(["Watermelon"]);
  });

  it("verifies against submissions, starts revisions, and rolls unfinished work over", async () => {
    t.clock.now = Date.parse(IST("2026-10-20", "08:00"));
    const u = await learner("Solver");
    await u.post("/api/roadmaps", { title: "CF 800", items: CF_LIST, follow: { newPace: "frequent" } });
    let d = await today(u);
    const first = d.items.find((i) => i.title === "Watermelon");
    const second = d.items.find((i) => i.title === "Way Too Long Words");

    // Not solved yet → stays pending.
    t.clock.now = Date.parse(IST("2026-10-20", "18:00"));
    expect((await u.post(`/api/today/tasks/${first!.taskId}/check`)).body.status).toBe("not_found_yet");
    // Solved → verified, item done, revision scheduled for tomorrow.
    solve(101, 4, "A", IST("2026-10-20", "18:30"));
    t.clock.now = Date.parse(IST("2026-10-20", "18:45"));
    expect((await u.post(`/api/today/tasks/${first!.taskId}/check`)).body.status).toBe("verified");
    d = await today(u);
    expect(d.items.find((i) => i.taskId === first!.taskId)).toMatchObject({ status: "done", verifiedBy: "submission" });
    expect(d.summary).toMatchObject({ total: 2, done: 1 });
    // Completing doesn't pull in more work today.
    expect(d.items).toHaveLength(2);
    const roadmaps = await u.get("/api/roadmaps");
    expect(roadmaps.body[0]).toMatchObject({ done: 1 });
    expect((await u.get("/api/reviews")).body[0]).toMatchObject({ title: "Watermelon", dueDate: "2026-10-21" });

    // Next day: yesterday's unfinished item comes back first, plus one new item, plus the revision.
    t.clock.now = Date.parse(IST("2026-10-21", "08:00"));
    d = await today(u);
    expect(titles(d.items)).toEqual(["Next Round", "Watermelon", "Way Too Long Words"]);
    const revision = d.items.find((i) => i.source === "review")!;
    expect(revision.label).toBe("Revision · CF 800");
    // A revision needs a fresh accepted submission today; yesterday's doesn't count.
    expect((await u.post(`/api/today/tasks/${revision.taskId}/check`)).body.status).toBe("not_found_yet");
    solve(102, 4, "A", IST("2026-10-21", "08:30"));
    t.clock.now = Date.parse(IST("2026-10-21", "09:05"));
    expect((await u.post(`/api/today/tasks/${revision.taskId}/check`)).body.status).toBe("verified");
    // Recorded as "good" by default; rating "again" replaces it rather than counting twice.
    let cards = (await u.get("/api/reviews")).body;
    expect(cards[0]).toMatchObject({ reps: 2, dueDate: "2026-10-27" }); // learned → +1 day → +6 days
    await u.post(`/api/reviews/${revision.review!.cardId}/rate`, { rating: "again" });
    cards = (await u.get("/api/reviews")).body;
    expect(cards[0]).toMatchObject({ reps: 0, dueDate: "2026-10-22", lastQuality: 2 });
    await u.post(`/api/reviews/${revision.review!.cardId}/rate`, { rating: "easy" });
    expect((await u.get("/api/reviews")).body[0]).toMatchObject({ reps: 2, lastQuality: 5 });
    expect(second).toBeDefined();
  });

  it("swaps within a category, keeps swapped-in items, and skips for today only", async () => {
    t.clock.now = Date.parse(IST("2026-10-20", "08:00"));
    const u = await learner("Swapper");
    await u.post("/api/roadmaps", { title: "CF 800", items: CF_LIST, follow: { newPace: "decent" } });
    await u.post("/api/roadmaps", { title: "Reading", items: "Read CLRS 22\nRead CLRS 23", follow: { newPace: "decent" } });
    let d = await today(u);
    expect(titles(d.items)).toEqual(["Read CLRS 22", "Watermelon"]);
    const cfTask = d.items.find((i) => i.title === "Watermelon")!;
    await u.put(`/api/today/tasks/${cfTask.taskId}/time`, { start: "18:00", minutes: 25 });

    const options = (await u.get(`/api/today/tasks/${cfTask.taskId}/swap-options`)).body as Array<{ title: string; source: string; sourceId: string; category: string }>;
    expect(options.map((o) => o.title)).toEqual(["Way Too Long Words", "Next Round", "Team"]);
    expect(options.every((o) => o.category === "codeforces")).toBe(true);
    const swapped = await u.post(`/api/today/tasks/${cfTask.taskId}/swap`, { source: options[1]!.source, sourceId: options[1]!.sourceId });
    expect(swapped.status).toBe(200);
    d = await today(u);
    expect(titles(d.items)).toEqual(["Next Round", "Read CLRS 22"]);
    expect(d.items.find((i) => i.title === "Next Round")!.block).not.toBeNull(); // took over the chosen time
    // Re-planning keeps the swapped-in item and doesn't bring the old one back.
    await u.post("/api/today/replan");
    expect(titles((await today(u)).items)).toEqual(["Next Round", "Read CLRS 22"]);

    // Skip is for today only.
    const reading = d.items.find((i) => i.title === "Read CLRS 22")!;
    await u.post(`/api/today/tasks/${reading.taskId}/skip`);
    d = await today(u);
    expect(titles(d.items)).toEqual(["Next Round"]);
    t.clock.now = Date.parse(IST("2026-10-21", "08:00"));
    expect(titles((await today(u)).items)).toContain("Read CLRS 22");
    // Self-reported items are ticked directly.
    const r2 = (await today(u)).items.find((i) => i.title === "Read CLRS 22")!;
    expect((await u.post(`/api/today/tasks/${r2.taskId}/check`)).body.status).toBe("done");
  });

  it("guards the daily load and marks already-solved problems done instead of planning them", async () => {
    t.clock.now = Date.parse(IST("2026-10-20", "08:00"));
    const u = await learner("Guarded");
    solve(201, 4, "A", IST("2026-10-20", "07:00")); // solved but not synced yet → still planned
    await u.patch("/api/me", { preferences: { planning: { autoPlan: true, maxStudyMinutesPerDay: 50, dailyReviewCap: 5 } } });
    await u.post("/api/roadmaps", { title: "CF 800", items: CF_LIST, follow: { newPace: "frequent" } });
    let d = await today(u);
    // 2 items wanted (frequent), each 25 min, budget 50 → both fit.
    expect(titles(d.items)).toEqual(["Watermelon", "Way Too Long Words"]);
    await u.patch("/api/me", { preferences: { planning: { autoPlan: true, maxStudyMinutesPerDay: 30, dailyReviewCap: 5 } } });
    await u.post("/api/today/replan");
    d = await today(u);
    expect(titles(d.items)).toEqual(["Watermelon"]);
    expect(d.deferred).toBe(1);

    // A problem solved after following is recognised when it comes up — no task needed.
    solve(202, 71, "A", IST("2026-10-20", "09:00"));
    t.clock.now = Date.parse(IST("2026-10-20", "09:10"));
    await u.post("/api/integrations/codeforces/sync");
    t.clock.now = Date.parse(IST("2026-10-21", "08:00"));
    d = await today(u);
    const rm = (await u.get("/api/roadmaps")).body[0];
    // Both solved problems (Watermelon earlier, Way Too Long Words later) are now known from the
    // sync, so they're marked done and start revisions instead of being planned as new.
    expect(rm.done).toBe(2);
    expect(titles(d.items)).not.toContain("Way Too Long Words");
    expect(d.items.filter((i) => i.source === "roadmap").map((i) => i.title)).not.toContain("Watermelon");

    // Late in the day only the free time that's left counts: 21:00–22:00 with 10-min breaks fits one 25-min item.
    const late = await learner("Latecomer");
    await setHours(late, "09:00", "22:00");
    t.clock.now = Date.parse(IST("2026-10-21", "21:00"));
    await late.post("/api/roadmaps", { title: "CF 800", items: CF_LIST, follow: { newPace: "frequent" } });
    const lateDay = await today(late);
    expect(titles(lateDay.items)).toHaveLength(1);
    expect(lateDay.deferred).toBe(1);
  });
});
