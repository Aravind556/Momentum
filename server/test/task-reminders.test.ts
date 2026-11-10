import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendTaskReminders } from "../src/modules/notify/task-reminders.js";
import { IST, setupTestEnv, signUp, type Client, type TestEnv } from "./helpers.js";

let t: TestEnv;
beforeAll(async () => {
  t = await setupTestEnv();
});
afterAll(async () => t.close());

const at = (date: string, time: string) => (t.clock.now = Date.parse(IST(date, time)));
const reminders = async (u: Client) =>
  ((await u.get("/api/notifications")).body.items as Array<{ payload: { message?: string } }>).map((n) => n.payload.message).filter((m) => m?.startsWith("Reminder:"));

describe("per-task reminders", () => {
  it("reminds once at the chosen time, only while the task is open", async () => {
    const u = await signUp(t.app, "Forgetful");
    at("2026-10-20", "09:00");
    const open = await u.post("/api/tasks", { title: "Submit OS report", estimatedMinutes: 30, reminder: { type: "at", at: IST("2026-10-20", "18:00") } });
    expect(open.status).toBe(201);
    expect(open.body.reminder).toEqual({ type: "at", at: IST("2026-10-20", "18:00") });
    const done = await u.post("/api/tasks", { title: "Pay hostel fee", estimatedMinutes: 10, reminder: { type: "at", at: IST("2026-10-20", "18:00") } });
    await u.post(`/api/tasks/${done.body.id}/complete`, {});

    at("2026-10-20", "17:59");
    await sendTaskReminders(t.services);
    expect(await reminders(u)).toEqual([]);

    at("2026-10-20", "18:01");
    await sendTaskReminders(t.services);
    await sendTaskReminders(t.services); // a second run never sends it again
    expect(await reminders(u)).toEqual(['Reminder: "Submit OS report" isn\'t done yet']);
  });

  it("skips reminders that are hours late instead of sending them", async () => {
    const u = await signUp(t.app, "Late");
    at("2026-10-20", "09:00");
    await u.post("/api/tasks", { title: "Old reminder", estimatedMinutes: 30, reminder: { type: "at", at: IST("2026-10-20", "10:00") } });
    at("2026-10-20", "17:00");
    await sendTaskReminders(t.services);
    expect(await reminders(u)).toEqual([]);
  });

  it("repeats daily reminders on the days the task is due, unless it's done", async () => {
    const u = await signUp(t.app, "Routine");
    at("2026-10-20", "09:00"); // Tuesday
    const gym = await u.post("/api/tasks", { title: "Gym", estimatedMinutes: 45, recurrence: { type: "weekdays" }, reminder: { type: "daily", time: "20:00" } });
    expect(gym.status).toBe(201);

    at("2026-10-20", "20:05");
    await sendTaskReminders(t.services);
    expect(await reminders(u)).toHaveLength(1);

    // Wednesday: done before 20:00, so no reminder.
    at("2026-10-21", "18:00");
    await u.post(`/api/tasks/${gym.body.id}/complete`, { occurrenceDate: "2026-10-21" });
    at("2026-10-21", "20:05");
    await sendTaskReminders(t.services);
    expect(await reminders(u)).toHaveLength(1);

    // Saturday isn't a weekday: nothing. Monday: reminded again.
    at("2026-10-24", "20:05");
    await sendTaskReminders(t.services);
    expect(await reminders(u)).toHaveLength(1);
    at("2026-10-26", "20:05");
    await sendTaskReminders(t.services);
    expect(await reminders(u)).toHaveLength(2);
  });

  it("sets and clears a reminder on its own, for the owner only", async () => {
    const u = await signUp(t.app, "Owner");
    at("2026-10-20", "09:00");
    const task = await u.post("/api/tasks", { title: "Read paper", estimatedMinutes: 30 });
    const set = await u.put(`/api/tasks/${task.body.id}/reminder`, { reminder: { type: "at", at: IST("2026-10-20", "19:00") } });
    expect(set.status).toBe(200);
    expect(set.body.reminder).toEqual({ type: "at", at: IST("2026-10-20", "19:00") });
    expect((await u.put(`/api/tasks/${task.body.id}/reminder`, { reminder: { type: "daily", time: "25:00" } })).status).toBe(400);
    const other = await signUp(t.app, "Stranger");
    expect((await other.put(`/api/tasks/${task.body.id}/reminder`, { reminder: null })).status).toBe(404);
    expect((await u.put(`/api/tasks/${task.body.id}/reminder`, { reminder: null })).body.reminder).toBeNull();
    at("2026-10-20", "19:05");
    await sendTaskReminders(t.services);
    expect(await reminders(u)).toEqual([]);
  });
});
