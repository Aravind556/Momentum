import { overlaps } from "../intervals.js";
import { MINUTE, localToInstant } from "../time.js";
import { sessionBounds } from "./greedy.js";
import type { PlannedBlock, ScheduleResult, SchedulerInput } from "./types.js";

export interface Violation {
  code:
    | "overlap"
    | "busy_overlap"
    | "outside_window"
    | "indivisible_split"
    | "session_length"
    | "dependency_order"
    | "task_bounds"
    | "before_not_before"
    | "over_allocated"
    | "break_spacing"
    | "daily_limit";
  message: string;
  taskId?: string | null;
}

/**
 * Checks a schedule against every hard constraint. Used by tests and as a runtime guard
 * before a generated schedule is persisted.
 */
export function validateSchedule(input: SchedulerInput, result: ScheduleResult): Violation[] {
  const v: Violation[] = [];
  const blocks = [...result.blocks].sort((a, b) => a.start - b.start);
  const tasks = new Map(input.tasks.map((t) => [t.id, t]));
  const byTask = new Map<string, PlannedBlock[]>();
  for (const b of blocks) {
    if (b.taskId) byTask.set(b.taskId, [...(byTask.get(b.taskId) ?? []), b]);
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.end <= b.start) v.push({ code: "overlap", message: "Block has non-positive length", taskId: b.taskId });
    for (let j = i + 1; j < blocks.length && blocks[j]!.start < b.end; j++) {
      if (overlaps(b, blocks[j]!)) v.push({ code: "overlap", message: "Blocks overlap", taskId: b.taskId });
    }
    for (const busy of input.busy) {
      if (overlaps(b, busy)) v.push({ code: "busy_overlap", message: `Overlaps ${busy.kind}`, taskId: b.taskId });
    }
    if (!result.windows.some((w) => w.start <= b.start && b.end <= w.end)) {
      v.push({ code: "outside_window", message: "Block is outside working hours", taskId: b.taskId });
    }
    if (input.notBefore !== undefined && b.start < input.notBefore) {
      v.push({ code: "before_not_before", message: "Block starts in the past", taskId: b.taskId });
    }
  }

  const breakMs = input.preferences.breakMinutes * MINUTE;
  const focusBlocks = blocks.filter((b) => b.kind === "focus");
  for (let i = 0; i + 1 < focusBlocks.length; i++) {
    const gap = focusBlocks[i + 1]!.start - focusBlocks[i]!.end;
    if (gap < breakMs) v.push({ code: "break_spacing", message: "Focus blocks too close together" });
  }

  const usage = new Map<string, number>();
  for (const [taskId, tb] of byTask) {
    const t = tasks.get(taskId);
    if (!t) continue;
    const total = tb.reduce((s, b) => s + (b.end - b.start) / MINUTE, 0);
    if (total > t.remainingMinutes + 1e-9) {
      v.push({ code: "over_allocated", message: `${total} min allocated, ${t.remainingMinutes} needed`, taskId });
    }
    if (!t.splittable && (tb.length !== 1 || Math.round(total) !== t.remainingMinutes)) {
      v.push({ code: "indivisible_split", message: "Indivisible task not in one full block", taskId });
    }
    if (t.splittable) {
      const { minS, maxS } = sessionBounds(t, input.preferences.focusMinutes);
      for (const b of tb) {
        const m = (b.end - b.start) / MINUTE;
        if (m > maxS || (m < minS && m < t.remainingMinutes && tb.length > 1)) {
          v.push({ code: "session_length", message: `Session of ${m} min outside [${minS}, ${maxS}]`, taskId });
        }
      }
    }
    for (const b of tb) {
      if ((t.earliestStart !== undefined && b.start < t.earliestStart) || (t.latestEnd !== undefined && b.end > t.latestEnd)) {
        v.push({ code: "task_bounds", message: "Block outside the task's allowed window", taskId });
      }
      if (t.allowedWindow) {
        const lo = localToInstant(b.day, t.allowedWindow.startMinute, input.timezone);
        const hi = localToInstant(b.day, t.allowedWindow.endMinute, input.timezone);
        if (b.start < lo || b.end > hi) v.push({ code: "task_bounds", message: "Block outside the task's daily window", taskId });
      }
      for (const dep of t.dependsOn ?? []) {
        const depBlocks = byTask.get(dep) ?? [];
        const depTask = tasks.get(dep);
        const depEnd = Math.max(
          ...depBlocks.map((d) => d.end),
          depTask?.existingBlocksEnd ?? -Infinity,
        );
        if (b.start < depEnd) v.push({ code: "dependency_order", message: `Starts before prerequisite ${dep} ends`, taskId });
      }
      const k = `t|${taskId}|${b.day}`;
      usage.set(k, (usage.get(k) ?? 0) + (b.end - b.start) / MINUTE);
      if (t.groupId !== undefined) {
        const g = `g|${t.groupId}|${b.day}`;
        usage.set(g, (usage.get(g) ?? 0) + (b.end - b.start) / MINUTE);
      }
    }
    for (const b of tb) {
      if (t.maxMinutesPerDay !== undefined && (usage.get(`t|${taskId}|${b.day}`) ?? 0) > t.maxMinutesPerDay) {
        v.push({ code: "daily_limit", message: "Task daily limit exceeded", taskId });
      }
    }
  }
  for (const [k, used] of usage) {
    if (!k.startsWith("g|")) continue;
    const groupId = k.split("|")[1]!;
    const budget = input.groupBudgets?.[groupId];
    if (budget !== undefined && used > budget) v.push({ code: "daily_limit", message: `Group ${groupId} over daily budget` });
  }
  return v;
}

/** Throws if the schedule violates hard constraints. */
export function assertValidSchedule(input: SchedulerInput, result: ScheduleResult): void {
  const violations = validateSchedule(input, result);
  if (violations.length) {
    throw new Error(`Scheduler produced an invalid schedule: ${violations.map((x) => x.message).join("; ")}`);
  }
}
