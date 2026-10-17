import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scheduleBlocks, tasks } from "../src/core/db/schema.js";
import { IST, setHours, setupTestEnv, signUp, type Client, type TestEnv } from "./helpers.js";

let t: TestEnv;
beforeAll(async () => {
  t = await setupTestEnv();
});
afterAll(async () => t.close());

const ITEMS = Array.from({ length: 10 }, (_, i) => `Topic ${i + 1}`).join("\n");
interface Day {
  date: string;
  items: Array<{ title: string; kind: string; label: string | null }>;
  minutes: number;
}

async function setup(name: string, follow: object) {
  t.clock.now = Date.parse(IST("2026-10-20", "08:00")); // Tuesday
  const u = await signUp(t.app, name);
  await setHours(u, "09:00", "21:00");
  const r = await u.post("/api/roadmaps", { title: "Notes", items: ITEMS, follow });
  return { u, roadmapId: r.body.id as string };
}
const forecast = async (u: Client, days = 7) => (await u.get(`/api/forecast?days=${days}`)).body.days as Day[];
const count = (d: Day | undefined, kind: string) => d?.items.filter((i) => i.kind === kind).length ?? 0;

describe("dynamic re-planning", () => {
  it("re-plans today when settings change and tells the client what changed", async () => {
    const { u, roadmapId } = await setup("Replanner", { newPace: "decent" });
    expect((await u.get("/api/today")).body.items).toHaveLength(1);
    const res = await u.patch(`/api/roadmaps/${roadmapId}/follow`, { newPace: "frequent" });
    expect(JSON.parse(res.headers["x-cadence-notes"] ?? "null")).toEqual({ plan: { added: 1, removed: 0, deferred: 0 } });
    // A change with no effect on today sends no note.
    const quiet = await u.patch(`/api/roadmaps/${roadmapId}/follow`, { preferredTime: null });
    expect(quiet.headers["x-cadence-notes"]).toBeUndefined();
  });

  it("keeps blocks the user moved when availability changes, and re-places the rest", async () => {
    const { u } = await setup("Mover", { newPace: "frequent" });
    // Own tasks are placed into free time; day-plan items stay open all day.
    await u.post("/api/tasks", { title: "Essay draft", estimatedMinutes: 30 });
    await u.post("/api/tasks", { title: "Lab record", estimatedMinutes: 30 });
    const view = await u.get("/api/schedules?start=2026-10-20");
    const focus = view.body.blocks.filter((x: { kind: string }) => x.kind === "focus");
    expect(focus).toHaveLength(2);
    expect(view.body.dayItems.map((i: { title: string }) => i.title).sort()).toEqual(["Topic 1", "Topic 2"]);
    const [a, b] = focus;
    // Move one block to 19:00 → locked.
    await u.patch(`/api/schedules/blocks/${a.id}`, { startAt: IST("2026-10-20", "19:00"), endAt: IST("2026-10-20", "19:30") });
    // Availability shrinks to the evening: the unlocked block moves, the locked one stays.
    const weekly = Object.fromEntries(["1", "2", "3", "4", "5", "6", "7"].map((d) => [d, [{ start: "18:00", end: "21:00" }]]));
    await u.put("/api/availability", { weekly, blocked: [], overrides: [] });
    const after = (await u.get("/api/schedules?start=2026-10-20")).body.blocks.filter((x: { kind: string; status: string }) => x.kind === "focus" && x.status === "planned");
    const locked = after.find((x: { id: string }) => x.id === a.id);
    expect(locked).toMatchObject({ locked: true, startAt: new Date(IST("2026-10-20", "19:00")).toISOString() });
    const other = after.find((x: { taskId: string }) => x.taskId === b.taskId);
    expect(Date.parse(other.startAt)).toBeGreaterThanOrEqual(Date.parse(IST("2026-10-20", "18:00")));
  });
});

describe("forecast", () => {
  it("shows what's lined up and follows pace and revision changes instantly", async () => {
    const { u, roadmapId } = await setup("Forecaster", { newPace: "rare", revision: "decent" });
    let days = await forecast(u, 7);
    expect(days.map((d) => d.date)).toEqual(["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
    // Rare: new items on Wed, Fri, Mon.
    expect(days.map((d) => count(d, "new"))).toEqual([1, 0, 1, 0, 0, 1, 0]);
    // Wednesday's item is revised the next day (first SM-2 interval).
    expect(count(days[1], "revision")).toBe(1);
    expect(days[1]!.items[0]).toMatchObject({ kind: "revision", label: "Revision · Notes" });

    await u.patch(`/api/roadmaps/${roadmapId}/follow`, { newPace: "frequent" });
    days = await forecast(u, 7);
    expect(days.map((d) => count(d, "new"))).toEqual([2, 2, 2, 2, 0, 0, 0]); // 10 items: 2 today + 8 more
    await u.patch(`/api/roadmaps/${roadmapId}/follow`, { revision: "off" });
    days = await forecast(u, 7);
    expect(days.every((d) => count(d, "revision") === 0)).toBe(true);
  });

  it("applies the study limit and writes nothing", async () => {
    const { u } = await setup("Previewer", { newPace: "frequent" });
    await u.patch("/api/me", { preferences: { planning: { autoPlan: true, maxStudyMinutesPerDay: 60, dailyReviewCap: 5 } } });
    const days = await forecast(u, 3);
    // Revisions take priority: today's 2 topics come back tomorrow as 2 × 20-min revisions, leaving
    // 20 of the 60 minutes — not enough for a 30-min topic, so new material waits a day.
    expect(days.map((d) => [count(d, "revision"), count(d, "new")])).toEqual([
      [2, 0],
      [0, 2],
      [2, 0],
    ]);

    // The forecast is read-only.
    const before = { tasks: (await t.database.db.select().from(tasks)).length, blocks: (await t.database.db.select().from(scheduleBlocks)).length };
    await u.get("/api/forecast?days=7");
    const after = { tasks: (await t.database.db.select().from(tasks)).length, blocks: (await t.database.db.select().from(scheduleBlocks)).length };
    expect(after).toEqual(before);
  });
});
