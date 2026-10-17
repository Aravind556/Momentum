import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IST, setHours, setupTestEnv, signUp, type Client, type TestEnv } from "./helpers.js";

const DAY = "2026-10-20";
let t: TestEnv;

beforeAll(async () => {
  t = await setupTestEnv();
});
afterAll(async () => t.close());

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

describe("auth", () => {
  it("rejects unauthenticated access and missing CSRF header", async () => {
    const { default: request } = await import("supertest");
    expect((await request(t.app).get("/api/tasks")).status).toBe(401);
    const u = await signUp(t.app, "Csrf");
    const res = await u.agent.post("/api/tasks").send({ title: "x", estimatedMinutes: 30 });
    expect(res.status).toBe(403);
  });
});

describe("Workflow A — plan a day", () => {
  let u: Client;
  beforeAll(async () => {
    u = await signUp(t.app, "Planner");
    await setHours(u, "10:00", "22:00");
  });

  it("generates a schedule around a fixed class, persisting it", async () => {
    t.clock.now = Date.parse(IST(DAY, "08:00"));
    const c = await u.post("/api/commitments", { title: "College class", startAt: IST(DAY, "12:00"), endAt: IST(DAY, "15:00") });
    expect(c.status).toBe(201);
    const lc = await u.post("/api/tasks", { title: "LeetCode Medium", estimatedMinutes: 50, priority: 3 });
    const lecture = await u.post("/api/tasks", { title: "Lecture", estimatedMinutes: 50, splittable: true, preferredSessionMinutes: 25 });
    const project = await u.post("/api/tasks", { title: "Project", estimatedMinutes: 90, splittable: true, preferredSessionMinutes: 45 });
    expect([lc.status, lecture.status, project.status]).toEqual([201, 201, 201]);

    const gen = await u.post("/api/schedules/generate", { date: DAY });
    expect(gen.status).toBe(200);
    expect(gen.body.unscheduled).toEqual([]);

    const view = await u.get(`/api/schedules?start=${DAY}`);
    const focus = view.body.blocks.filter((b: { kind: string }) => b.kind === "focus");
    const of = (id: string) => focus.filter((b: { taskId: string }) => b.taskId === id).map((b: { startAt: string; endAt: string }) => `${hhmm(b.startAt)}-${hhmm(b.endAt)}`);
    expect(of(lc.body.id)).toEqual(["10:00-10:50"]);
    expect(of(lecture.body.id)).toEqual(["11:00-11:25", "11:35-12:00"]);
    expect(of(project.body.id)).toEqual(["15:00-15:45", "15:55-16:40"]);
    expect(view.body.commitments).toHaveLength(1);
    // no block overlaps the class
    for (const b of view.body.blocks) {
      expect(new Date(b.endAt) <= new Date(IST(DAY, "12:00")) || new Date(b.startAt) >= new Date(IST(DAY, "15:00"))).toBe(true);
    }
  });

  it("lets the user move (and thereby lock) a block, and keeps it on regeneration", async () => {
    const view = await u.get(`/api/schedules?start=${DAY}`);
    const project = view.body.blocks.find((b: { title: string; segment: number }) => b.title === "Project" && b.segment === 2);
    const moved = await u.patch(`/api/schedules/blocks/${project.id}`, { startAt: IST(DAY, "18:00"), endAt: IST(DAY, "18:45") });
    expect(moved.status).toBe(200);
    expect(moved.body.block.locked).toBe(true);

    const clash = await u.patch(`/api/schedules/blocks/${project.id}`, { startAt: IST(DAY, "12:30"), endAt: IST(DAY, "13:15") });
    expect(clash.status).toBe(409);

    await u.post("/api/schedules/generate", { date: DAY });
    const after = await u.get(`/api/schedules?start=${DAY}`);
    const kept = after.body.blocks.find((b: { id: string }) => b.id === project.id);
    expect(hhmm(kept.startAt)).toBe("18:00");
    const projectMinutes = after.body.blocks
      .filter((b: { title: string; kind: string }) => b.title === "Project" && b.kind === "focus")
      .reduce((s: number, b: { startAt: string; endAt: string }) => s + (Date.parse(b.endAt) - Date.parse(b.startAt)) / 60000, 0);
    expect(projectMinutes).toBe(90); // locked block counted, not double-booked
  });

  it("explains tasks that cannot fit", async () => {
    await u.post("/api/tasks", { title: "Marathon study", estimatedMinutes: 600, priority: 1 });
    const gen = await u.post("/api/schedules/generate", { date: DAY });
    const item = gen.body.unscheduled.find((x: { title: string }) => x.title === "Marathon study");
    expect(item.code).toBe("no_continuous_slot");
    expect(item.reason).toMatch(/uninterrupted/);
  });

  it("rejects planning a past day and validates input", async () => {
    expect((await u.post("/api/schedules/generate", { date: "2026-10-01" })).status).toBe(400);
    expect((await u.post("/api/tasks", { title: "", estimatedMinutes: 30 })).status).toBe(400);
    const bad = await u.post("/api/tasks", { title: "x", estimatedMinutes: 60, splittable: false, maxSessionMinutes: 30 });
    expect(bad.status).toBe(400);
  });

  it("rejects dependency cycles", async () => {
    const a = await u.post("/api/tasks", { title: "A", estimatedMinutes: 20 });
    const b = await u.post("/api/tasks", { title: "B", estimatedMinutes: 20, dependsOn: [a.body.id] });
    const res = await u.put(`/api/tasks/${a.body.id}`, { title: "A", estimatedMinutes: 20, dependsOn: [b.body.id] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("dependency_cycle");
  });

  it("prevents concurrent regeneration from double-booking", async () => {
    const results = await Promise.all([
      u.post("/api/schedules/generate", { date: DAY }),
      u.post("/api/schedules/generate", { date: DAY }),
      u.post("/api/schedules/generate", { date: DAY }),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const view = await u.get(`/api/schedules?start=${DAY}`);
    const active = view.body.blocks.filter((b: { status: string }) => b.status !== "missed" && b.status !== "skipped");
    active.sort((a: { startAt: string }, b: { startAt: string }) => Date.parse(a.startAt) - Date.parse(b.startAt));
    for (let i = 1; i < active.length; i++) {
      expect(Date.parse(active[i].startAt)).toBeGreaterThanOrEqual(Date.parse(active[i - 1].endAt));
    }
  });

  it("detects stale task edits (optimistic concurrency)", async () => {
    const task = await u.post("/api/tasks", { title: "Versioned", estimatedMinutes: 30 });
    const ok = await u.put(`/api/tasks/${task.body.id}`, { title: "V2", estimatedMinutes: 30, version: 1 });
    expect(ok.status).toBe(200);
    const stale = await u.put(`/api/tasks/${task.body.id}`, { title: "V3", estimatedMinutes: 30, version: 1 });
    expect(stale.status).toBe(409);
  });
});

describe("Workflow E — missed work", () => {
  it("marks missed blocks, never completes them, and regenerates the remainder", async () => {
    const u = await signUp(t.app, "Misser");
    await setHours(u, "10:00", "20:00");
    t.clock.now = Date.parse(IST(DAY, "09:00"));
    const task = await u.post("/api/tasks", { title: "Essay", estimatedMinutes: 120, splittable: true, preferredSessionMinutes: 60 });
    await u.post("/api/commitments", { title: "Meeting", startAt: IST(DAY, "16:00"), endAt: IST(DAY, "17:00") });
    await u.post("/api/schedules/generate", { date: DAY });

    // Do the first session via a focus session, then miss the second one.
    const view = await u.get(`/api/schedules?start=${DAY}`);
    const first = view.body.blocks.find((b: { taskId: string; segment: number }) => b.taskId === task.body.id && b.segment === 1);
    t.clock.now = Date.parse(first.startAt);
    const s = await u.post("/api/focus-sessions", { blockId: first.id, plannedMinutes: 60 });
    t.clock.now += 60 * 60_000;
    await u.post(`/api/focus-sessions/${s.body.id}/finish`, {});

    t.clock.now = Date.parse(IST(DAY, "15:00"));
    const gen = await u.post("/api/schedules/generate", { date: DAY });
    expect(gen.status).toBe(200);

    const after = await u.get(`/api/schedules?start=${DAY}`);
    const blocks = after.body.blocks.filter((b: { taskId: string }) => b.taskId === task.body.id);
    expect(blocks.find((b: { id: string }) => b.id === first.id).status).toBe("completed");
    const missed = blocks.filter((b: { status: string }) => b.status === "missed");
    expect(missed).toHaveLength(1);
    const planned = blocks.filter((b: { status: string }) => b.status === "planned");
    expect(planned.reduce((m: number, b: { startAt: string; endAt: string }) => m + (Date.parse(b.endAt) - Date.parse(b.startAt)) / 60000, 0)).toBe(60);
    for (const b of planned) {
      expect(Date.parse(b.startAt)).toBeGreaterThanOrEqual(t.clock.now);
      expect(Date.parse(b.endAt) <= Date.parse(IST(DAY, "16:00")) || Date.parse(b.startAt) >= Date.parse(IST(DAY, "17:00"))).toBe(true);
    }
    const tasks = await u.get("/api/tasks");
    expect(tasks.body.find((x: { id: string }) => x.id === task.body.id).status).not.toBe("completed");
  });
});

describe("authorization boundaries", () => {
  it("never exposes another user's tasks or blocks", async () => {
    const a = await signUp(t.app, "Alice");
    const b = await signUp(t.app, "Bob");
    const task = await a.post("/api/tasks", { title: "Private plan", estimatedMinutes: 30 });
    expect((await b.put(`/api/tasks/${task.body.id}`, { title: "hijack", estimatedMinutes: 30 })).status).toBe(404);
    expect((await b.post(`/api/tasks/${task.body.id}/complete`, {})).status).toBe(404);
    expect((await b.del(`/api/tasks/${task.body.id}`)).status).toBe(404);
    expect((await b.get("/api/tasks")).body.find((x: { id: string }) => x.id === task.body.id)).toBeUndefined();
    expect((await b.post("/api/focus-sessions", { taskId: task.body.id, plannedMinutes: 25 })).status).toBe(404);
  });
});
