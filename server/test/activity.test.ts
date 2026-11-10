import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IST, setupTestEnv, signUp, type TestEnv } from "./helpers.js";

let t: TestEnv;
beforeAll(async () => {
  t = await setupTestEnv();
});
afterAll(async () => t.close());

describe("progress activity", () => {
  it("counts finished work per day by type, with streak and week-over-week totals", async () => {
    const u = await signUp(t.app, "Doer");
    const day = async (date: string) => {
      t.clock.now = Date.parse(IST(date, "10:00"));
    };

    // Two own tasks two days ago, one yesterday, one self-checked roadmap topic today.
    await day("2026-10-18");
    for (const title of ["Lab record", "Read chapter 4"]) {
      const task = await u.post("/api/tasks", { title, estimatedMinutes: 30 });
      expect((await u.post(`/api/tasks/${task.body.id}/complete`, {})).status).toBe(200);
    }
    await day("2026-10-19");
    const y = await u.post("/api/tasks", { title: "Assignment", estimatedMinutes: 45 });
    await u.post(`/api/tasks/${y.body.id}/complete`, {});
    await day("2026-10-20");
    const rm = await u.post("/api/roadmaps", { title: "System design", items: "CAP theorem (45m)", follow: { newPace: "frequent" } });
    expect((await u.post(`/api/roadmap-items/${rm.body.items[0].id}/done`)).status).toBe(200);

    const res = await u.get("/api/progress/activity?days=7");
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.today).toBe("2026-10-20");
    const byDate = Object.fromEntries(res.body.days.map((d: { date: string }) => [d.date, d]));
    expect(byDate["2026-10-18"]).toMatchObject({ tasks: 2, roadmap: 0, total: 2 });
    expect(byDate["2026-10-19"]).toMatchObject({ tasks: 1, total: 1 });
    expect(byDate["2026-10-20"]).toMatchObject({ tasks: 0, roadmap: 1, total: 1 });
    expect(res.body.byKind).toMatchObject({ tasks: 3, roadmap: 1, revisions: 0, group: 0, problems: 0 });
    expect(res.body).toMatchObject({ total: 4, thisWeek: 4, lastWeek: 0, activeDays: 3, bestDay: { date: "2026-10-18", total: 2 } });
    expect(res.body.streak).toEqual({ current: 3, longest: 3, doneToday: true });

    // The next morning nothing is done yet: the streak is kept until the day is over.
    await day("2026-10-21");
    const next = await u.get("/api/progress/activity?days=7");
    expect(next.body.streak).toEqual({ current: 3, longest: 3, doneToday: false });
    // Range is clamped to 7–90 days.
    expect((await u.get("/api/progress/activity?days=500")).body.days).toHaveLength(90);
  });
});
