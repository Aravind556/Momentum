import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IST, setupTestEnv, signUp, type TestEnv } from "./helpers.js";

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const cf = {
  submissions: [] as Array<{ id: number; creationTimeSeconds: number; verdict: string; problem: { contestId: number; index: string; name: string; rating?: number; tags: string[] } }>,
};
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname === "codeforces.com") {
    if (url.pathname === "/api/user.info") return Response.json({ status: "OK", result: [{ handle: url.searchParams.get("handles") }] });
    if (url.pathname === "/api/user.status") return Response.json({ status: "OK", result: cf.submissions });
    if (url.pathname === "/api/problemset.problems") {
      return Response.json({
        status: "OK",
        result: {
          problems: [
            { contestId: 4, index: "A", name: "Watermelon", rating: 800, tags: ["math"] },
            { contestId: 1850, index: "A", name: "To My Critics", rating: 800, tags: [] },
            { contestId: 1873, index: "F", name: "Money Trees", rating: 1700, tags: ["two pointers"] },
          ],
        },
      });
    }
  }
  if (url.hostname === "leetcode.com") {
    const body = JSON.parse(String(init?.body));
    if (body.query.includes("question(")) return Response.json({ data: { question: { title: "Two Sum", difficulty: "Easy", topicTags: [] } } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

let t: TestEnv;
beforeAll(async () => {
  t = await setupTestEnv({ fetch: fakeFetch });
  t.clock.now = Date.parse(IST("2026-10-20", "09:00")); // a Tuesday
});
afterAll(async () => t.close());

describe("roadmaps", () => {
  it("accepts AI-style lists: bullets, numbering, titled links, markdown links and times", async () => {
    const u = await signUp(t.app, "Sysdesign");
    const created = await u.post("/api/roadmaps", {
      title: "System design",
      items: [
        "## **Fundamentals**",
        "1. CAP theorem (45m)",
        "2. Consistent hashing — https://example.com/consistent-hashing (1h)",
        "- [Load balancing](https://example.com/lb)",
        "* https://leetcode.com/problems/two-sum/",
        "- My warm-up: https://codeforces.com/problemset/problem/4/A (20m)",
        "",
        "# Case studies",
        "- [ ] Design YouTube (1h 30m)",
      ].join("\n"),
      follow: { newPace: "decent" },
    });
    expect(created.status).toBe(201);
    const items = created.body.items as Array<Record<string, unknown>>;
    expect(items.map((i) => [i.title, i.url, i.estMinutes, i.section, i.category])).toEqual([
      ["CAP theorem", null, 45, "Fundamentals", "other"],
      ["Consistent hashing", "https://example.com/consistent-hashing", 60, "Fundamentals", "other"],
      ["Load balancing", "https://example.com/lb", 40, "Fundamentals", "other"],
      // Untitled problem link: the real title and difficulty-based estimate come from the platform.
      ["Two Sum", "https://leetcode.com/problems/two-sum/", 25, "Fundamentals", "leetcode"],
      // Own title and time win over the platform's, but it stays verifiable and gets its difficulty.
      ["My warm-up", "https://codeforces.com/problemset/problem/4/A", 20, "Fundamentals", "codeforces"],
      ["Design YouTube", null, 90, "Case studies", "other"],
    ]);
    expect(items[4]).toMatchObject({ platform: "codeforces", problemKey: "4A", difficulty: "800" });

    // The owner can rename, re-time and move an item to another section.
    const edited = await u.patch(`/api/roadmap-items/${items[0]!.id}`, { title: "CAP & PACELC", estMinutes: 50, section: "Case studies" });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ title: "CAP & PACELC", estMinutes: 50, section: "Case studies" });
    // …and it moved to the end of "Case studies", so that section stays together.
    const after = await u.get(`/api/roadmaps/${created.body.id}`);
    expect(after.body.items.map((i: { title: string }) => i.title).slice(-2)).toEqual(["Design YouTube", "CAP & PACELC"]);
    expect((await u.patch(`/api/roadmap-items/${items[0]!.id}`, { estMinutes: 2 })).status).toBe(400);
    const other = await signUp(t.app, "Nosy");
    expect((await other.patch(`/api/roadmap-items/${items[0]!.id}`, { title: "x" })).status).toBe(404);
  });

  it("creates a roadmap from pasted lines, with sections, titles and per-user progress", async () => {
    const u = await signUp(t.app, "Owner");
    const created = await u.post("/api/roadmaps", {
      title: "Graphs",
      items: "# Basics\nhttps://codeforces.com/problemset/problem/4/A\nhttps://leetcode.com/problems/two-sum/\nRead CLRS chapter 22\n# Harder\nhttps://codeforces.com/contest/1873/problem/F",
      follow: { newPace: "rare" },
    });
    expect(created.status).toBe(201);
    expect(created.body.items.map((i: { title: string }) => i.title)).toEqual(["Watermelon", "Two Sum", "Read CLRS chapter 22", "Money Trees"]);
    expect(created.body.items.map((i: { section: string }) => i.section)).toEqual(["Basics", "Basics", "Basics", "Harder"]);
    expect(created.body.items[2]).toMatchObject({ category: "other", platform: null });
    expect(created.body.items[3]).toMatchObject({ category: "codeforces", platform: "codeforces", problemKey: "1873F", estMinutes: 45 });
    expect(created.body.follow.settings).toMatchObject({ newPace: "rare", revision: "decent" });
    // Rare: Wed, Fri, Mon, Wed → the 4th item arrives on Wed Oct 28.
    expect(created.body.projectedFinish).toBe("2026-10-28");

    const list = await u.get("/api/roadmaps");
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ title: "Graphs", total: 4, done: 0, isOwner: true, followers: 1 });

    // Owner-only edits; others can't even see it.
    const other = await signUp(t.app, "Other");
    expect((await other.get(`/api/roadmaps/${created.body.id}`)).status).toBe(404);
    expect((await other.post(`/api/roadmaps/${created.body.id}/items`, { text: "x" })).status).toBe(404);

    // Reorder.
    const ids = created.body.items.map((i: { id: string }) => i.id);
    expect((await u.post(`/api/roadmaps/${created.body.id}/reorder`, { itemIds: [ids[3], ids[0], ids[1], ids[2]] })).status).toBe(200);
    expect((await u.post(`/api/roadmaps/${created.body.id}/reorder`, { itemIds: [ids[0]] })).status).toBe(400);
    const after = await u.get(`/api/roadmaps/${created.body.id}`);
    expect(after.body.items[0].title).toBe("Money Trees");
  });

  it("verifies platform items against submissions, self-reports others, and starts SM-2 revisions", async () => {
    const u = await signUp(t.app, "Learner");
    const r = await u.post("/api/roadmaps", {
      title: "CF warmup",
      items: "https://codeforces.com/problemset/problem/4/A\nWatch the DP lecture",
      follow: { newPace: "decent", revision: "frequent" },
    });
    const [cfItem, lecture] = r.body.items;

    // Not connected → can't verify.
    expect((await u.post(`/api/roadmap-items/${cfItem.id}/done`)).body.error.code).toBe("not_connected");
    cf.submissions = [];
    await u.put("/api/integrations/codeforces", { handle: "learner" });
    // Connected but not solved → still not done.
    const notYet = await u.post(`/api/roadmap-items/${cfItem.id}/done`);
    expect(notYet.status).toBe(409);
    expect(notYet.body.error.code).toBe("not_verified");

    // Solved → verified, and a revision is due tomorrow (frequent: 1 day × 0.5 → at least 1 day).
    cf.submissions = [{ id: 7, creationTimeSeconds: sec(IST("2026-10-20", "10:00")), verdict: "OK", problem: { contestId: 4, index: "A", name: "Watermelon", rating: 800, tags: [] } }];
    t.clock.now = Date.parse(IST("2026-10-20", "10:05")); // past the sync cooldown
    const done = await u.post(`/api/roadmap-items/${cfItem.id}/done`);
    expect(done.status).toBe(200);
    expect((await u.post(`/api/roadmap-items/${lecture.id}/done`)).status).toBe(200); // self-reported

    const detail = await u.get(`/api/roadmaps/${r.body.id}`);
    expect(detail.body.items.map((i: { status: string; verifiedBy: string }) => [i.status, i.verifiedBy])).toEqual([
      ["done", "submission"],
      ["done", "self"],
    ]);
    let cards = await u.get("/api/reviews");
    expect(cards.body).toHaveLength(2);
    expect(cards.body[0]).toMatchObject({ dueDate: "2026-10-21", multiplier: 0.5, roadmap: { title: "CF warmup" } });

    // First solve = first recall (1 day). Rate the revision Good → 6 days × 0.5 = 3 days.
    expect(cards.body[0]).toMatchObject({ reps: 1, baseInterval: 1 });
    t.clock.now = Date.parse(IST("2026-10-21", "09:00"));
    const rated = await u.post(`/api/reviews/${cards.body[0].id}/rate`, { rating: "good" });
    expect(rated.body).toMatchObject({ reps: 2, baseInterval: 6, dueDate: "2026-10-24" });
    // Rating again the same day replaces that day's rating instead of counting twice.
    expect((await u.post(`/api/reviews/${cards.body[0].id}/rate`, { rating: "good" })).body).toMatchObject({ reps: 2, dueDate: "2026-10-24" });
    t.clock.now = Date.parse(IST("2026-10-24", "09:00"));
    const rated2 = await u.post(`/api/reviews/${cards.body[0].id}/rate`, { rating: "good" });
    expect(rated2.body).toMatchObject({ reps: 3, baseInterval: 15, dueDate: "2026-11-01" });

    // Changing the revision setting reschedules immediately; "off" suspends.
    await u.patch(`/api/roadmaps/${r.body.id}/follow`, { revision: "rare" });
    cards = await u.get("/api/reviews");
    expect(cards.body.find((c: { id: string }) => c.id === rated.body.id)).toMatchObject({ multiplier: 1.5, dueDate: "2026-11-16" }); // 24 Oct + 15 × 1.5
    await u.patch(`/api/roadmaps/${r.body.id}/follow`, { revision: "off" });
    expect((await u.get("/api/reviews")).body).toHaveLength(0);
    await u.patch(`/api/roadmaps/${r.body.id}/follow`, { revision: "decent" });
    expect((await u.get("/api/reviews")).body).toHaveLength(2);
    // Settings changes keep the other fields.
    const d2 = await u.get(`/api/roadmaps/${r.body.id}`);
    expect(d2.body.follow.settings).toMatchObject({ newPace: "decent", revision: "decent" });
  });

  it("adds any submission to revisions and archives roadmaps others follow", async () => {
    const u = await signUp(t.app, "Archiver");
    cf.submissions = [{ id: 9, creationTimeSeconds: sec(IST("2026-10-21", "08:00")), verdict: "OK", problem: { contestId: 1850, index: "A", name: "To My Critics", rating: 800, tags: [] } }];
    t.clock.now = Date.parse(IST("2026-10-21", "09:00"));
    await u.put("/api/integrations/codeforces", { handle: "archiver" });
    const feed = await u.get("/api/submissions");
    const card = await u.post("/api/reviews", { submissionId: feed.body.items[0].id });
    expect(card.status).toBe(201);
    expect(card.body).toMatchObject({ title: "To My Critics", dueDate: "2026-10-22" });
    expect((await u.post("/api/reviews", { submissionId: feed.body.items[0].id })).status).toBe(400);

    const r = await u.post("/api/roadmaps", { title: "Solo" });
    expect((await u.del(`/api/roadmaps/${r.body.id}`)).body).toEqual({ archived: false });
    expect((await u.get(`/api/roadmaps/${r.body.id}`)).status).toBe(404);
  });
});
