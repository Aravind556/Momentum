import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { outbox } from "../src/modules/notify/channels.js";
import { pushOutbox } from "../src/modules/notify/push.js";
import { sendReminders } from "../src/modules/notify/reminders.js";
import { IST, setHours, setupTestEnv, signUp, type Client, type TestEnv } from "./helpers.js";

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const subs = new Map<string, unknown[]>();
const fakeFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname === "codeforces.com") {
    if (url.pathname === "/api/user.info") return Response.json({ status: "OK", result: [{ handle: url.searchParams.get("handles") }] });
    if (url.pathname === "/api/user.status") return Response.json({ status: "OK", result: subs.get(url.searchParams.get("handle")!) ?? [] });
    if (url.pathname === "/api/problemset.problems") {
      return Response.json({ status: "OK", result: { problems: [{ contestId: 4, index: "A", name: "Watermelon", rating: 800, tags: [] }] } });
    }
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

let t: TestEnv;
beforeAll(async () => {
  t = await setupTestEnv({ fetch: fakeFetch });
});
afterAll(async () => t.close());
beforeEach(() => {
  outbox.length = 0;
  pushOutbox.length = 0;
});

const mailTo = (u: Client) => outbox.filter((m) => m.to === `${u.username}@example.com`);
const pushesTo = (u: Client) => pushOutbox.filter((p) => p.userId === u.userId);
const at = async (time: string, day = "2026-10-20") => {
  t.clock.now = Date.parse(IST(day, time));
  await sendReminders(t.services);
};
async function subscribe(u: Client) {
  const r = await u.post("/api/push/subscriptions", { endpoint: `https://push.example.com/${u.userId}`, keys: { p256dh: "BPkey", auth: "authkey" } });
  expect(r.status).toBe(201);
}

describe("reminders", () => {
  it("pushes every 4 hours while tasks are open, then sends one final email", async () => {
    t.clock.now = Date.parse(IST("2026-10-20", "08:00"));
    const u = await signUp(t.app, "Remindme");
    await setHours(u, "09:00", "22:00");
    await subscribe(u);
    expect((await u.get("/api/push/key")).body).toMatchObject({ enabled: true, subscribed: true });
    await u.post("/api/roadmaps", { title: "Reading", items: "Read chapter 1\nRead chapter 2", follow: { newPace: "frequent" } });

    await at("08:30"); // before the first slot (09:00)
    expect(pushesTo(u)).toHaveLength(0);
    await at("09:05");
    await at("10:00"); // same 4-hour slot → nothing new
    expect(pushesTo(u).map((p) => p.title)).toEqual(["2 tasks left today"]);
    expect(pushesTo(u)[0]!.body).toContain("Read chapter 1 — Reading");

    // Finish one: the 13:00 push lists only what's left.
    const items = (await u.get("/api/today")).body.items as Array<{ taskId: string; title: string }>;
    await u.post(`/api/today/tasks/${items.find((i) => i.title === "Read chapter 1")!.taskId}/check`);
    await at("13:10");
    await at("17:00");
    expect(pushesTo(u).map((p) => p.title)).toEqual(["2 tasks left today", "1 task left today", "1 task left today"]);
    expect(mailTo(u)).toHaveLength(0); // no emails during the day

    // 21:00: the final reminder — email + push + in-app, once.
    await at("21:05");
    await at("21:30");
    expect(mailTo(u).map((m) => m.subject)).toEqual(["1 task still open today"]);
    expect(mailTo(u)[0]!.text).toContain("Last reminder for today");
    expect(pushesTo(u)).toHaveLength(4);
    expect((await u.get("/api/notifications")).body.items[0].payload.message).toBe("Last reminder: 1 task still open today");

    // Next day, everything done → silence.
    t.clock.now = Date.parse(IST("2026-10-21", "08:00"));
    for (const i of (await u.get("/api/today")).body.items as Array<{ taskId: string }>) await u.post(`/api/today/tasks/${i.taskId}/check`);
    await at("09:10", "2026-10-21");
    await at("21:10", "2026-10-21");
    expect(pushesTo(u)).toHaveLength(4);
    expect(mailTo(u)).toHaveLength(1);
  });

  it("respects the user's settings", async () => {
    t.clock.now = Date.parse(IST("2026-10-20", "08:00"));
    const u = await signUp(t.app, "Tuned");
    await setHours(u, "09:00", "22:00");
    await subscribe(u);
    await u.post("/api/roadmaps", { title: "Reading", items: "Read chapter 1", follow: { newPace: "frequent" } });
    await u.patch("/api/me", { preferences: { reminders: { push: true, every: 2, startHour: 10, email: false, hour: 20, groupDueSoon: true } } });
    for (const time of ["09:30", "10:05", "11:00", "12:10", "14:15", "20:10"]) await at(time);
    // Every 2 hours from 10:00 (10, 12, 14), then the final push; no email when it's off.
    expect(pushesTo(u)).toHaveLength(4);
    expect(mailTo(u)).toHaveLength(0);

    const v = await signUp(t.app, "Quiet");
    await setHours(v, "09:00", "22:00");
    await subscribe(v);
    await v.post("/api/roadmaps", { title: "Reading", items: "Read chapter 1", follow: { newPace: "frequent" } });
    await v.patch("/api/me", { preferences: { reminders: { push: false, every: 4, startHour: 9, email: false, hour: 21, groupDueSoon: false } } });
    for (const time of ["09:30", "13:30", "21:30"]) await at(time);
    expect(pushesTo(v)).toHaveLength(0);
    expect(mailTo(v)).toHaveLength(0);
  });

  it("syncs before reminding, and pushes when a group task is due soon", async () => {
    t.clock.now = Date.parse(IST("2026-10-20", "08:00"));
    const lead = await signUp(t.app, "Leader");
    const mate = await signUp(t.app, "Teammate");
    for (const u of [lead, mate]) await setHours(u, "09:00", "22:00");
    await subscribe(mate);
    await mate.put("/api/integrations/codeforces", { handle: "teammate" });
    await mate.patch("/api/me", { preferences: { reminders: { push: true, every: 12, startHour: 9, email: true, hour: 21, groupDueSoon: true } } });
    const g = await lead.post("/api/groups", { name: "CF club" });
    const inv = await lead.post(`/api/groups/${g.body.id}/invitations`, {});
    await mate.post(`/api/invitations/${inv.body.code}/accept`);
    await lead.post(`/api/groups/${g.body.id}/tasks`, { kind: "problem", url: "https://codeforces.com/problemset/problem/4/A", startDate: "2026-10-20", dueTime: "19:00" });

    await at("09:10"); // the regular push
    await at("17:30"); // due within 2 hours → one nudge
    await at("17:45");
    expect(pushesTo(mate).map((p) => p.title)).toEqual(["1 task left today", "Due by 19:00: Watermelon"]);

    // Solved at 18:30 but never synced: the final reminder syncs first and has nothing to say.
    subs.set("teammate", [{ id: 1, creationTimeSeconds: sec(IST("2026-10-20", "18:30")), verdict: "OK", problem: { contestId: 4, index: "A", name: "Watermelon", rating: 800, tags: [] } }]);
    await at("21:10");
    expect(mailTo(mate)).toHaveLength(0);
    expect(pushesTo(mate)).toHaveLength(2);
    expect((await lead.get(`/api/groups/${g.body.id}/today`)).body.tasks[0].doneCount).toBe(1);
  });
});
