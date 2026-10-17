import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { generateSchedule } from "./greedy.js";
import { validateSchedule } from "./validate.js";
import { computeWorkWindows } from "./availability.js";
import { localToInstant, parseHHMM } from "../time.js";
import type { AvailabilitySpec, BusyInterval, ScheduleResult, SchedulerInput, SchedulerTask } from "./types.js";

const TZ = "Asia/Kolkata";
const DAY = "2026-10-20"; // a Tuesday

const at = (time: string, date = DAY, tz = TZ) => localToInstant(date, parseHHMM(time), tz);
const fmt = (ms: number, tz = TZ) => DateTime.fromMillis(ms, { zone: tz }).toFormat("HH:mm");

const allWeek = (start: string, end: string): AvailabilitySpec["weekly"] =>
  Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, [{ start, end }]]));

function input(over: Partial<SchedulerInput> & { tasks: SchedulerTask[] }): SchedulerInput {
  return {
    timezone: TZ,
    startDate: DAY,
    endDate: DAY,
    availability: { weekly: allWeek("10:00", "22:00"), blocked: [], overrides: [] },
    busy: [],
    preferences: { focusMinutes: 25, breakMinutes: 10 },
    ...over,
  };
}

function task(id: string, minutes: number, extra: Partial<SchedulerTask> = {}): SchedulerTask {
  return { id, title: id, remainingMinutes: minutes, priority: 2, splittable: false, ...extra };
}

function run(i: SchedulerInput): ScheduleResult {
  const r = generateSchedule(i);
  expect(validateSchedule(i, r)).toEqual([]);
  return r;
}

const focusOf = (r: ScheduleResult, id: string) =>
  r.blocks.filter((b) => b.taskId === id).map((b) => `${fmt(b.start)}-${fmt(b.end)}`);

const commitment = (start: string, end: string, label = "class", date = DAY): BusyInterval => ({
  start: at(start, date),
  end: at(end, date),
  kind: "commitment",
  label,
});

describe("availability", () => {
  it("subtracts blocked ranges and applies date overrides", () => {
    const spec: AvailabilitySpec = {
      weekly: allWeek("10:00", "22:00"),
      blocked: [{ start: "13:00", end: "14:00", weekdays: [2], label: "lunch" }],
      overrides: [{ date: "2026-10-21", windows: [{ start: "18:00", end: "20:00" }] }, { date: "2026-10-22", off: true }],
    };
    const w = computeWorkWindows(spec, TZ, DAY, "2026-10-22");
    expect(w.map((x) => `${x.day} ${fmt(x.start)}-${fmt(x.end)}`)).toEqual([
      "2026-10-20 10:00-13:00",
      "2026-10-20 14:00-22:00",
      "2026-10-21 18:00-20:00",
    ]);
  });

  it("supports windows that cross midnight", () => {
    const spec: AvailabilitySpec = { weekly: { 2: [{ start: "22:00", end: "02:00" }] }, blocked: [], overrides: [] };
    const w = computeWorkWindows(spec, TZ, DAY, DAY);
    expect(w).toHaveLength(1);
    expect((w[0]!.end - w[0]!.start) / 60000).toBe(240);
    expect(w[0]!.day).toBe(DAY);
  });
});

describe("GreedyScheduler", () => {
  it("reproduces the PRD example: indivisible first, lecture segments, class respected", () => {
    const r = run(
      input({
        busy: [commitment("12:00", "15:00")],
        tasks: [
          task("leetcode", 50, { priority: 3 }),
          task("lecture", 50, { splittable: true, preferredSessionMinutes: 25 }),
          task("project", 90, { splittable: true, preferredSessionMinutes: 45 }),
        ],
      }),
    );
    expect(focusOf(r, "leetcode")).toEqual(["10:00-10:50"]);
    expect(focusOf(r, "lecture")).toEqual(["11:00-11:25", "11:35-12:00"]);
    expect(focusOf(r, "project")).toEqual(["15:00-15:45", "15:55-16:40"]);
    const breaks = r.blocks.filter((b) => b.kind === "break").map((b) => `${fmt(b.start)}-${fmt(b.end)}`);
    expect(breaks).toContain("10:50-11:00");
    expect(breaks).toContain("11:25-11:35");
    expect(breaks).not.toContain("12:00-12:10"); // no break swallowed by the class
    expect(r.unscheduled).toEqual([]);
  });

  it("never schedules an indivisible task in a gap that is too short", () => {
    const r = run(
      input({
        availability: { weekly: allWeek("11:25", "13:00"), blocked: [], overrides: [] },
        busy: [commitment("12:00", "13:00")],
        tasks: [task("lc", 50)],
      }),
    );
    expect(r.blocks).toEqual([]);
    expect(r.unscheduled[0]).toMatchObject({ taskId: "lc", code: "no_continuous_slot" });
    expect(r.unscheduled[0]!.reason).toContain("35 min");
  });

  it("handles overlapping fixed commitments", () => {
    const r = run(
      input({
        availability: { weekly: allWeek("10:00", "14:00"), blocked: [], overrides: [] },
        busy: [commitment("10:30", "12:00"), commitment("11:00", "12:30", "meeting")],
        tasks: [task("a", 30), task("b", 60)],
      }),
    );
    expect(focusOf(r, "b")).toEqual(["12:30-13:30"]);
    expect(focusOf(r, "a")).toEqual(["10:00-10:30"]);
  });

  it("splits divisible tasks across multiple intervals", () => {
    const r = run(
      input({
        availability: { weekly: allWeek("09:00", "12:00"), blocked: [], overrides: [] },
        busy: [commitment("10:00", "11:00")],
        tasks: [task("read", 100, { splittable: true, preferredSessionMinutes: 50, minSessionMinutes: 20 })],
      }),
    );
    expect(focusOf(r, "read")).toEqual(["09:00-09:50", "11:00-11:50"]);
  });

  it("does not leave a fragment shorter than the minimum session", () => {
    const r = run(
      input({
        tasks: [task("t", 60, { splittable: true, preferredSessionMinutes: 50, minSessionMinutes: 20, maxSessionMinutes: 60 })],
      }),
    );
    // 50 + 10 would leave a 10-minute fragment; the task fits in one 60-minute session instead.
    expect(focusOf(r, "t")).toEqual(["10:00-11:00"]);
  });

  it("does not insert breaks when breaks are disabled", () => {
    const r = run(
      input({
        preferences: { focusMinutes: 25, breakMinutes: 0 },
        tasks: [task("a", 30), task("b", 30)],
      }),
    );
    expect(r.blocks.filter((b) => b.kind === "break")).toEqual([]);
    expect([...focusOf(r, "a"), ...focusOf(r, "b")].sort()).toEqual(["10:00-10:30", "10:30-11:00"]);
  });

  it("respects task dependencies and sequential playlists", () => {
    const r = run(
      input({
        tasks: [
          task("v3", 20, { dependsOn: ["v2"], priority: 4 }),
          task("v2", 20, { dependsOn: ["v1"], priority: 4 }),
          task("v1", 20),
          task("other", 30, { priority: 3 }),
        ],
      }),
    );
    const s = (id: string) => r.blocks.find((b) => b.taskId === id)!.start;
    expect(s("v1")).toBeLessThan(s("v2"));
    expect(s("v2")).toBeLessThan(s("v3"));
  });

  it("reports dependency cycles and missing prerequisites", () => {
    const r = run(
      input({
        tasks: [task("a", 20, { dependsOn: ["b"] }), task("b", 20, { dependsOn: ["a"] }), task("c", 20, { dependsOn: ["ghost"] })],
      }),
    );
    expect(r.blocks).toEqual([]);
    const codes = Object.fromEntries(r.unscheduled.map((u) => [u.taskId, u.code]));
    expect(codes).toEqual({ a: "dependency_cycle", b: "dependency_cycle", c: "dependency_missing" });
  });

  it("propagates failure to dependents when a prerequisite does not fit", () => {
    const r = run(
      input({
        availability: { weekly: allWeek("10:00", "11:00"), blocked: [], overrides: [] },
        tasks: [task("big", 120), task("after", 20, { dependsOn: ["big"] })],
      }),
    );
    expect(r.unscheduled.map((u) => [u.taskId, u.code])).toEqual([
      ["big", "no_continuous_slot"],
      ["after", "dependency_unscheduled"],
    ]);
  });

  it("prioritises urgent deadlines when time is scarce", () => {
    const r = run(
      input({
        availability: { weekly: allWeek("10:00", "11:00"), blocked: [], overrides: [] },
        tasks: [task("later", 60, { priority: 3 }), task("dueToday", 60, { priority: 2, deadline: at("18:00") })],
      }),
    );
    expect(focusOf(r, "dueToday")).toEqual(["10:00-11:00"]);
    expect(r.unscheduled.map((u) => u.taskId)).toEqual(["later"]);
  });

  it("warns when work lands after a deadline", () => {
    const r = run(
      input({
        busy: [commitment("10:00", "12:00")],
        tasks: [task("t", 30, { deadline: at("11:00") })],
      }),
    );
    expect(focusOf(r, "t")).toEqual(["12:00-12:30"]);
    expect(r.warnings.map((w) => w.code)).toContain("after_deadline");
  });

  it("reports when there is no available time at all", () => {
    const r = run(
      input({
        availability: { weekly: {}, blocked: [], overrides: [] },
        tasks: [task("t", 30), task("s", 30, { splittable: true })],
      }),
    );
    expect(r.blocks).toEqual([]);
    expect(r.unscheduled.map((u) => u.code)).toEqual(["no_time", "no_time"]);
    expect(r.warnings.map((w) => w.code)).toContain("overloaded");
  });

  it("honours date-specific exceptions without changing the weekly default", () => {
    const i = input({
      startDate: DAY,
      endDate: "2026-10-21",
      availability: {
        weekly: allWeek("10:00", "12:00"),
        blocked: [],
        overrides: [{ date: DAY, off: true }],
      },
      tasks: [task("t", 60)],
    });
    const r = run(i);
    expect(r.blocks[0]!.day).toBe("2026-10-21");
  });

  it("schedules within overnight windows", () => {
    const r = run(
      input({
        availability: { weekly: { 2: [{ start: "23:00", end: "01:30" }] }, blocked: [], overrides: [] },
        tasks: [task("night", 120)],
      }),
    );
    expect(focusOf(r, "night")).toEqual(["23:00-01:00"]);
    expect(r.blocks[0]!.day).toBe(DAY);
  });

  it("handles the daylight-saving spring-forward day (23-hour day)", () => {
    const tz = "America/New_York";
    const day = "2026-03-08"; // clocks jump 02:00 -> 03:00
    const i: SchedulerInput = {
      timezone: tz,
      startDate: day,
      endDate: day,
      availability: { weekly: allWeek("01:00", "05:00"), blocked: [], overrides: [] },
      busy: [],
      preferences: { focusMinutes: 60, breakMinutes: 0 },
      tasks: [task("long", 240, { splittable: true, preferredSessionMinutes: 60 })],
    };
    const r = generateSchedule(i);
    expect(validateSchedule(i, r)).toEqual([]);
    expect(r.availableMinutes).toBe(180); // only 3 real hours exist in 01:00–05:00
    expect(r.unscheduled[0]).toMatchObject({ code: "partial", remainingMinutes: 60 });
  });

  it("handles the fall-back day (25-hour day)", () => {
    const tz = "America/New_York";
    const day = "2026-11-01";
    const i: SchedulerInput = {
      timezone: tz,
      startDate: day,
      endDate: day,
      availability: { weekly: allWeek("00:30", "03:00"), blocked: [], overrides: [] },
      busy: [],
      preferences: { focusMinutes: 60, breakMinutes: 0 },
      tasks: [],
    };
    expect(generateSchedule(i).availableMinutes).toBe(210);
  });

  it("regenerates around completed and locked blocks without double-booking", () => {
    const now = at("11:02");
    const busy: BusyInterval[] = [
      { start: at("10:00"), end: at("10:50"), kind: "completed", taskId: "lc" },
      { start: at("14:00"), end: at("15:00"), kind: "locked", taskId: "proj" },
    ];
    const i = input({
      notBefore: now,
      busy,
      tasks: [
        task("lc", 0, { existingBlocksEnd: at("10:50") }),
        task("proj", 45, { splittable: true, preferredSessionMinutes: 45 }),
        task("after", 30, { dependsOn: ["lc"] }),
      ],
    });
    const r = run(i);
    for (const b of r.blocks) expect(b.start).toBeGreaterThanOrEqual(now);
    expect(focusOf(r, "after")[0]).toBe("11:05-11:35");
    // focus blocks keep the break distance from the locked block too
    for (const b of r.blocks.filter((x) => x.kind === "focus")) {
      expect(b.end <= at("13:50") || b.start >= at("15:10")).toBe(true);
    }
  });

  it("reports tasks that no longer fit after a change", () => {
    const base = input({
      availability: { weekly: allWeek("10:00", "12:00"), blocked: [], overrides: [] },
      tasks: [task("a", 60), task("b", 50)],
    });
    expect(run(base).unscheduled).toEqual([]);
    const changed = { ...base, busy: [commitment("10:00", "11:00", "new meeting")] };
    const r = run(changed);
    expect(r.unscheduled).toHaveLength(1);
  });

  it("respects hard time windows and earliest/latest bounds", () => {
    const r = run(
      input({
        tasks: [
          task("gym", 60, { allowedWindow: { startMinute: 17 * 60, endMinute: 20 * 60 } }),
          task("late", 30, { earliestStart: at("19:00"), latestEnd: at("21:00") }),
          task("impossible", 30, { latestEnd: at("09:00") }),
        ],
      }),
    );
    expect(focusOf(r, "gym")).toEqual(["17:00-18:00"]);
    expect(focusOf(r, "late")).toEqual(["19:00-19:30"]);
    expect(r.unscheduled[0]).toMatchObject({ taskId: "impossible", code: "outside_window" });
  });

  it("prefers the preferred time of day but falls back with a warning", () => {
    const r = run(
      input({
        busy: [commitment("17:00", "22:00", "event")],
        tasks: [
          task("study", 60, { preferredWindow: { startMinute: 12 * 60, endMinute: 17 * 60 } }),
          task("evening", 60, { preferredWindow: { startMinute: 18 * 60, endMinute: 22 * 60 } }),
        ],
      }),
    );
    expect(focusOf(r, "study")).toEqual(["12:00-13:00"]);
    expect(r.warnings.find((w) => w.taskId === "evening")?.code).toBe("preferred_window_missed");
  });

  it("distributes work across days with daily caps and group budgets", () => {
    const i = input({
      endDate: "2026-10-23",
      groupBudgets: { playlist: 60 },
      tasks: [
        task("v1", 40, { groupId: "playlist", splittable: true, preferredSessionMinutes: 40 }),
        task("v2", 40, { groupId: "playlist", splittable: true, preferredSessionMinutes: 40, dependsOn: ["v1"] }),
        task("v3", 40, { groupId: "playlist", splittable: true, preferredSessionMinutes: 40, dependsOn: ["v2"] }),
      ],
    });
    const r = run(i);
    const perDay = new Map<string, number>();
    for (const b of r.blocks.filter((x) => x.kind === "focus")) {
      perDay.set(b.day, (perDay.get(b.day) ?? 0) + (b.end - b.start) / 60000);
    }
    for (const m of perDay.values()) expect(m).toBeLessThanOrEqual(60);
    expect([...perDay.values()].reduce((a, b) => a + b, 0)).toBe(120);
    expect(r.unscheduled).toEqual([]);
  });

  it("places flexible commitments inside their window without break padding", () => {
    const r = run(
      input({
        tasks: [
          task("workout", 60, { kind: "commitment", priority: 4, allowedWindow: { startMinute: 17 * 60, endMinute: 20 * 60 } }),
        ],
      }),
    );
    expect(r.blocks[0]).toMatchObject({ kind: "commitment" });
    expect(fmt(r.blocks[0]!.start)).toBe("17:00");
  });

  it("is deterministic", () => {
    const i = input({
      tasks: [task("a", 30), task("b", 30), task("c", 45, { splittable: true }), task("d", 25, { priority: 4 })],
    });
    expect(generateSchedule(i)).toEqual(generateSchedule(i));
  });

  it("never produces overlapping blocks on a randomized workload", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let round = 0; round < 50; round++) {
      const tasks: SchedulerTask[] = [];
      const n = 3 + Math.floor(rand() * 10);
      for (let k = 0; k < n; k++) {
        tasks.push(
          task(`t${k}`, 5 * (2 + Math.floor(rand() * 24)), {
            splittable: rand() > 0.5,
            priority: 1 + Math.floor(rand() * 4),
            dependsOn: k > 0 && rand() > 0.7 ? [`t${Math.floor(rand() * k)}`] : [],
            preferredSessionMinutes: rand() > 0.5 ? 25 : 50,
          }),
        );
      }
      const busy: BusyInterval[] = [];
      for (let k = 0; k < 3; k++) {
        const s = 10 * 60 + Math.floor(rand() * 10 * 12) * 5;
        busy.push({ start: localToInstant(DAY, s, TZ), end: localToInstant(DAY, s + 30 + Math.floor(rand() * 12) * 5, TZ), kind: "commitment" });
      }
      const i = input({ busy, tasks, preferences: { focusMinutes: 25, breakMinutes: rand() > 0.5 ? 5 : 10 } });
      run(i);
    }
  });
});
