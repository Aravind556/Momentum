import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupPoints } from "../src/core/db/schema.js";
import { catchUpStats, resetCatchUpCache } from "../src/modules/groups/catch-up-cache.js";
import { IST, setHours, setupTestEnv, signUp, type Client, type TestEnv } from "./helpers.js";

/**
 * Roadmaps assigned to a group: one pace for everyone, the same items for every member each group
 * day, overdue carry-over, staying in sync with personal follows, late joiners and their
 * "Previous items", pausing, and points.
 */

type Item = { taskId: string; title: string; source: string; label: string; status: string; swappable: boolean };

let t: TestEnv;
let owner: Client, ann: Client, ben: Client;
let groupId: string, roadmapId: string, assignmentId: string;
const itemId = new Map<string, string>();

const at = (date: string, time = "08:00") => {
  t.clock.now = Date.parse(IST(date, time));
};
const today = async (u: Client) => (await u.get("/api/today")).body.items as Item[];
const groupItems = async (u: Client) => (await today(u)).filter((i) => i.source === "group-roadmap");
const titles = (items: Item[]) => items.map((i) => i.title);
const tick = async (u: Client, title: string) => {
  const it = (await today(u)).find((i) => i.title === title);
  expect(it, `${title} on today`).toBeTruthy();
  const r = await u.post(`/api/today/tasks/${it!.taskId}/check`);
  expect(r.status).toBe(200);
};
const pointsOf = async (u: Client, title: string) =>
  t.database.db
    .select()
    .from(groupPoints)
    .where(and(eq(groupPoints.userId, u.userId), eq(groupPoints.sourceId, itemId.get(title)!)));
const view = async (u: Client) => (await u.get(`/api/groups/${groupId}/assigned-roadmaps`)).body[0];

async function member(name: string) {
  const u = await signUp(t.app, name);
  await setHours(u, "09:00", "21:00");
  return u;
}
async function join(u: Client) {
  const inv = await owner.post(`/api/groups/${groupId}/invitations`, {});
  expect((await u.post(`/api/invitations/${inv.body.code}/accept`)).status).toBe(200);
}

beforeAll(async () => {
  resetCatchUpCache();
  t = await setupTestEnv();
  at("2026-10-20"); // Tuesday
  owner = await member("Owner");
  ann = await member("Ann");
  ben = await member("Ben");
  const g = await owner.post("/api/groups", { name: "Design Club" });
  groupId = g.body.id;
  await join(ann);
  await join(ben);
  // The owner follows the roadmap personally too (creating it follows it), at 1 new item a day.
  const r = await owner.post("/api/roadmaps", {
    title: "System Design",
    items: ["Load balancing", "Caching", "Sharding", "Replication", "Queues", "Rate limiting", "CDNs", "Consensus", "Search", "Feeds"].join("\n"),
    follow: { newPace: "custom", custom: { perDay: 1, weekdays: [1, 2, 3, 4, 5, 6, 7] } },
  });
  expect(r.status).toBe(201);
  roadmapId = r.body.id;
  for (const it of r.body.items as Array<{ id: string; title: string }>) itemId.set(it.title, it.id);
});
afterAll(async () => t.close());

describe("assigned group roadmaps", () => {
  it("only admins can assign", async () => {
    const r = await ann.post(`/api/groups/${groupId}/assigned-roadmaps`, { roadmapId, itemsPerDay: 2, startDate: "2026-10-20" });
    expect(r.status).toBe(403);
  });

  it("gives every member the same items on a group day, ranked for points", async () => {
    const r = await owner.post(`/api/groups/${groupId}/assigned-roadmaps`, {
      roadmapId,
      itemsPerDay: 2,
      weekdays: [1, 2, 3, 4, 5],
      startDate: "2026-10-20",
      dueTime: "21:00",
    });
    expect(r.status).toBe(201);
    assignmentId = r.body.id;
    expect((await owner.post(`/api/groups/${groupId}/assigned-roadmaps`, { roadmapId, startDate: "2026-10-20" })).status).toBe(409);

    for (const u of [ann, ben, owner]) {
      const items = await groupItems(u);
      expect(titles(items).sort()).toEqual(["Caching", "Load balancing"]);
      expect(items[0]!.label).toBe("Design Club · System Design");
      expect(items[0]!.swappable).toBe(false);
    }
    // Members can open the roadmap (it's shared with the group).
    expect((await ann.get(`/api/roadmaps/${roadmapId}`)).status).toBe(200);

    await tick(ben, "Load balancing");
    t.clock.now += 60_000;
    await tick(ann, "Load balancing");
    const [b] = await pointsOf(ben, "Load balancing");
    const [a] = await pointsOf(ann, "Load balancing");
    expect(b!.rank).toBe(1);
    expect(a!.rank).toBe(2);
    expect(b!.points).toBeGreaterThan(a!.points);

    const v = await view(owner);
    expect(v.today.map((i: { title: string }) => i.title)).toEqual(["Load balancing", "Caching"]);
    expect(v.today[0].doneCount).toBe(2);
    expect(v.scheduled).toBe(2);
    expect(v.total).toBe(10);
  });

  it("doesn't count points twice for a roadmap that is also shared", async () => {
    const rows = await t.database.db.select().from(groupPoints).where(eq(groupPoints.userId, ann.userId));
    expect(rows.map((r) => r.sourceType)).toEqual(["assigned_item"]);
  });

  it("keeps a personal follow in sync without showing anything twice", async () => {
    const mine = await today(owner);
    // The personal follow moves on to the next item instead of repeating the group's.
    const personal = mine.filter((i) => i.source === "roadmap").map((i) => i.title);
    expect(personal).toEqual(["Sharding"]);
    expect(new Set(titles(mine)).size).toBe(mine.length);
    // Finishing it personally, before the group gets there, counts for the group later.
    await tick(owner, "Sharding");
  });

  it("carries missed items over as overdue, for base points only", async () => {
    at("2026-10-21"); // Wednesday
    const items = await groupItems(ann);
    expect(titles(items).sort()).toEqual(["Caching", "Replication", "Sharding"]);
    const overdue = items.find((i) => i.title === "Caching")!;
    expect(overdue.label).toBe("Overdue · Design Club · System Design");
    await tick(ann, "Caching");
    const [p] = await pointsOf(ann, "Caching");
    expect(p!.rank).toBeNull();
    expect(p!.points).toBe(p!.basePoints);

    // The owner already did Sharding personally: it's done for the group, with on-time points.
    // (They skipped Tuesday entirely, so both of Tuesday's items are overdue for them.)
    expect(titles(await groupItems(owner)).sort()).toEqual(["Caching", "Load balancing", "Replication"]);
    const [own] = await pointsOf(owner, "Sharding");
    expect(own!.rank).toBe(1);
    const v = await view(owner);
    const sharding = v.today.find((i: { title: string }) => i.title === "Sharding");
    expect(sharding.members.find((m: { user: { userId: string } }) => m.user.userId === owner.userId).done).toBe(true);
  });

  it("starts late joiners at the group's position, with previous items from memory", async () => {
    at("2026-10-22"); // Thursday
    const cara = await member("Cara");
    await join(cara);
    expect(titles(await groupItems(cara)).sort()).toEqual(["Queues", "Rate limiting"]);

    const v = (await cara.get(`/api/groups/${groupId}/assigned-roadmaps`)).body[0];
    expect(v.previousCount).toBe(4);
    expect(v.myOverdue).toBe(0);

    const before = catchUpStats.loads;
    const prev = await cara.get(`/api/groups/${groupId}/assigned-roadmaps/${assignmentId}/previous`);
    expect(prev.status).toBe(200);
    expect(prev.body.items.map((i: { title: string }) => i.title)).toEqual(["Load balancing", "Caching", "Sharding", "Replication"]);
    expect(prev.body.done).toBe(0);
    const loads = catchUpStats.loads;
    expect(loads).toBeGreaterThan(before);

    const done = await cara.post(`/api/groups/${groupId}/assigned-roadmaps/${assignmentId}/previous/${itemId.get("Caching")}/done`);
    expect(done.status).toBe(200);
    // Saved to the database (it's ordinary roadmap progress)...
    const page = await cara.get(`/api/roadmaps/${roadmapId}`);
    expect(JSON.stringify(page.body)).toContain("Caching");
    // ...and the view is served from memory: no new database reads.
    const again = await cara.get(`/api/groups/${groupId}/assigned-roadmaps/${assignmentId}/previous`);
    expect(again.body.done).toBe(1);
    expect(again.body.items.find((i: { title: string }) => i.title === "Caching").done).toBe(true);
    expect(catchUpStats.loads).toBe(loads);
    // No points for items from before joining, and only previous items can be ticked here.
    expect(await pointsOf(cara, "Caching")).toEqual([]);
    expect((await cara.post(`/api/groups/${groupId}/assigned-roadmaps/${assignmentId}/previous/${itemId.get("Queues")}/done`)).status).toBe(400);
  });

  it("pauses and resumes from the next item", async () => {
    expect((await ann.patch(`/api/groups/${groupId}/assigned-roadmaps/${assignmentId}`, { status: "paused" })).status).toBe(403);
    expect((await owner.patch(`/api/groups/${groupId}/assigned-roadmaps/${assignmentId}`, { status: "paused" })).status).toBe(200);
    at("2026-10-23"); // Friday: paused
    expect(await groupItems(ann)).toEqual([]);
    at("2026-10-26"); // Monday
    expect((await owner.patch(`/api/groups/${groupId}/assigned-roadmaps/${assignmentId}`, { status: "active", itemsPerDay: 1 })).status).toBe(200);
    const items = await groupItems(ben);
    // Monday continues with the next item, at the new pace; what Ben missed is still overdue.
    expect(items.filter((i) => !i.label.startsWith("Overdue")).map((i) => i.title)).toEqual(["CDNs"]);
    expect(titles(items.filter((i) => i.label.startsWith("Overdue"))).sort()).toEqual(["Caching", "Queues", "Rate limiting", "Replication", "Sharding"]);
  });

  it("ends an assignment", async () => {
    expect((await owner.del(`/api/groups/${groupId}/assigned-roadmaps/${assignmentId}`)).status).toBe(200);
    expect(await groupItems(ann)).toEqual([]);
    expect((await ann.get(`/api/groups/${groupId}/assigned-roadmaps`)).body).toEqual([]);
  });

  it("lets members tick group work from the group page", async () => {
    // A group task (custom = a plain tick) …
    expect((await owner.post(`/api/groups/${groupId}/tasks`, { kind: "custom", title: "Read the DDIA intro", repeat: "once", startDate: "2026-10-26", dueTime: "21:00" })).status).toBe(201);
    const before = (await ann.get(`/api/groups/${groupId}/today`)).body.tasks[0];
    expect(before.mine).toMatchObject({ done: false, check: "self" });
    expect((await ann.post(`/api/today/tasks/${before.mine.taskId}/check`)).body.status).toBe("done");
    const after = (await ann.get(`/api/groups/${groupId}/today`)).body.tasks[0];
    expect(after.mine.done).toBe(true);
    expect(after.doneCount).toBe(1);

    // … and an assigned roadmap's item, even before the member has opened Today.
    const r = await owner.post(`/api/groups/${groupId}/assigned-roadmaps`, { roadmapId, itemsPerDay: 1, weekdays: [1, 2, 3, 4, 5, 6, 7], startDate: "2026-10-26" });
    expect(r.status).toBe(201);
    const dan = await member("Dan");
    await join(dan);
    const item = (await view(dan)).today[0];
    expect(item.mine).toMatchObject({ done: false, check: "self" });
    expect((await dan.post(`/api/today/tasks/${item.mine.taskId}/check`)).body.status).toBe("done");
    const v = await view(owner);
    expect(v.today[0].members.find((m: { user: { userId: string } }) => m.user.userId === dan.userId).done).toBe(true);
  });
});
