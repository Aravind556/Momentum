import { clampInterval, overlaps, type Interval } from "../intervals.js";
import { DAY_MS, MINUTE, localDayBounds, localToInstant } from "../time.js";
import { computeFreeIntervals, computeWorkWindows } from "./availability.js";
import type {
  PlannedBlock,
  ScheduleResult,
  ScheduleWarning,
  Scheduler,
  SchedulerInput,
  SchedulerTask,
  UnscheduledTask,
  WorkWindow,
} from "./types.js";

const STEP_MINUTES = 5;
const STEP = STEP_MINUTES * MINUTE;

const snapUp = (ms: number) => Math.ceil(ms / STEP) * STEP;
const snapDown = (ms: number) => Math.floor(ms / STEP) * STEP;
const lenMin = (i: Interval) => Math.round((i.end - i.start) / MINUTE);

/** Session sizing for splittable tasks. */
export function sessionBounds(t: SchedulerTask, defaultFocus: number) {
  const target = t.preferredSessionMinutes ?? defaultFocus;
  const maxS = Math.max(t.maxSessionMinutes ?? target, 1);
  const minS = Math.max(1, Math.min(t.minSessionMinutes ?? Math.min(15, target), maxS));
  const chunkTarget = Math.min(Math.max(target, minS), maxS);
  return { minS, maxS, chunkTarget };
}

/**
 * Chooses how many minutes of a splittable task to place in a gap of `space` minutes.
 * Avoids leaving a remainder shorter than the minimum session. Returns 0 if nothing sensible fits.
 */
export function pickChunk(remaining: number, space: number, minS: number, maxS: number, target: number): number {
  if (space <= 0 || remaining <= 0) return 0;
  if (remaining <= target && remaining <= space) return remaining;
  let chunk = Math.min(target, space, remaining);
  if (chunk < minS && chunk < remaining) return 0;
  const leftover = remaining - chunk;
  if (leftover > 0 && leftover < minS) {
    if (remaining <= space && remaining <= maxS) return remaining;
    const shrunk = remaining - minS;
    if (shrunk >= minS) chunk = Math.min(chunk, shrunk);
    else return 0;
  }
  return chunk;
}

interface Ctx {
  input: SchedulerInput;
  windows: WorkWindow[];
  breakMs: number;
  placed: PlannedBlock[];
  usage: Map<string, number>;
}

/**
 * Deterministic greedy scheduler.
 *
 * 1. Compute working windows (weekly ranges or date overrides, minus recurring blocked ranges).
 * 2. Subtract busy time (fixed commitments, locked/completed/in-progress blocks).
 * 3. Repeatedly pick the highest-ranked task whose dependencies are resolved
 *    (rank: priority + deadline urgency, then earliest deadline, indivisible first, creation order).
 * 4. Indivisible tasks get the earliest continuous slot of the full duration;
 *    splittable tasks are cut into sessions within [min, max] without leaving tiny remainders.
 *    Focus blocks keep at least `breakMinutes` between each other.
 * 5. Insert break blocks between adjacent focus blocks.
 * 6. Report unscheduled work with reasons; never place outside hard constraints.
 */
export class GreedyScheduler implements Scheduler {
  readonly name = "greedy-v1";

  schedule(input: SchedulerInput): ScheduleResult {
    const tz = input.timezone;
    const windows = computeWorkWindows(input.availability, tz, input.startDate, input.endDate);
    const ctx: Ctx = {
      input,
      windows,
      breakMs: Math.max(0, input.preferences.breakMinutes) * MINUTE,
      placed: [],
      usage: new Map(),
    };
    const unscheduled: UnscheduledTask[] = [];
    const warnings: ScheduleWarning[] = [];

    const initialFree = computeFreeIntervals(windows, input.busy, input.notBefore, STEP_MINUTES);
    const availableMinutes = initialFree.reduce((s, f) => s + lenMin(f), 0);
    const requestedMinutes = input.tasks.reduce((s, t) => s + Math.max(0, t.remainingMinutes), 0);

    const taskMap = new Map(input.tasks.map((t) => [t.id, t]));
    const satisfied = new Set(input.satisfiedTaskIds ?? []);
    /** taskId -> instant when the task's last block ends (fully placed tasks only). */
    const finishedAt = new Map<string, number>();
    /** taskId -> title of the task (for dependency explanations). */
    const failed = new Map<string, string>();

    for (const t of input.tasks) {
      if (t.remainingMinutes <= 0) finishedAt.set(t.id, t.existingBlocksEnd ?? -Infinity);
    }
    let pending = input.tasks.filter((t) => t.remainingMinutes > 0);

    // Dependencies on unknown, incomplete tasks can never be satisfied.
    for (const t of pending) {
      const missing = (t.dependsOn ?? []).filter((d) => !taskMap.has(d) && !satisfied.has(d));
      if (missing.length) {
        failed.set(t.id, t.title);
        unscheduled.push({
          taskId: t.id,
          remainingMinutes: t.remainingMinutes,
          code: "dependency_missing",
          reason: "Depends on a task that is not complete and not part of this plan.",
          suggestion: "Complete or schedule the prerequisite first, or remove the dependency.",
        });
      }
    }
    pending = pending.filter((t) => !failed.has(t.id));

    const horizonStart = localDayBounds(input.startDate, tz).start;
    const firstDayEnd = localDayBounds(input.startDate, tz).end;
    const effective = (t: SchedulerTask) => {
      let urgency = 0;
      if (t.deadline !== undefined) {
        if (t.deadline <= firstDayEnd) urgency = 2;
        else if (t.deadline <= horizonStart + 3 * DAY_MS) urgency = 1;
      }
      return t.priority + urgency;
    };
    const compare = (a: SchedulerTask, b: SchedulerTask) =>
      effective(b) - effective(a) ||
      (a.deadline ?? Infinity) - (b.deadline ?? Infinity) ||
      Number(a.splittable) - Number(b.splittable) ||
      (a.order ?? 0) - (b.order ?? 0) ||
      a.id.localeCompare(b.id);

    while (pending.length) {
      const resolved = (d: string) => satisfied.has(d) || finishedAt.has(d) || failed.has(d);
      const ready = pending.filter((t) => (t.dependsOn ?? []).every(resolved));
      if (!ready.length) break;

      const blockedByFailure = ready.filter((t) => (t.dependsOn ?? []).some((d) => failed.has(d)));
      if (blockedByFailure.length) {
        for (const t of blockedByFailure) {
          const dep = (t.dependsOn ?? []).find((d) => failed.has(d))!;
          failed.set(t.id, t.title);
          unscheduled.push({
            taskId: t.id,
            remainingMinutes: t.remainingMinutes,
            code: "dependency_unscheduled",
            reason: `Waits for "${failed.get(dep)}", which could not be fully scheduled.`,
            suggestion: "Free up time for the prerequisite or extend the planning range.",
          });
        }
        pending = pending.filter((t) => !failed.has(t.id));
        continue;
      }

      ready.sort(compare);
      const task = ready[0]!;
      pending = pending.filter((t) => t !== task);

      let depEnd = -Infinity;
      for (const d of task.dependsOn ?? []) depEnd = Math.max(depEnd, finishedAt.get(d) ?? -Infinity);

      const outcome = task.splittable ? placeSplittable(ctx, task, depEnd) : placeIndivisible(ctx, task, depEnd);
      if (outcome.unscheduled) {
        unscheduled.push(outcome.unscheduled);
        failed.set(task.id, task.title);
      } else {
        finishedAt.set(task.id, Math.max(outcome.lastEnd, task.existingBlocksEnd ?? -Infinity));
      }
      if (task.deadline !== undefined && outcome.lastEnd > task.deadline) {
        warnings.push({
          taskId: task.id,
          code: "after_deadline",
          message: `"${task.title}" is scheduled to finish after its deadline.`,
        });
      }
      if (outcome.missedPreferred) {
        warnings.push({
          taskId: task.id,
          code: "preferred_window_missed",
          message: `"${task.title}" could not be placed entirely within its preferred time of day.`,
        });
      }
    }

    for (const t of pending) {
      unscheduled.push({
        taskId: t.id,
        remainingMinutes: t.remainingMinutes,
        code: "dependency_cycle",
        reason: "Its dependencies form a cycle, so no valid order exists.",
        suggestion: "Remove one of the circular dependencies.",
      });
    }

    if (requestedMinutes > availableMinutes) {
      warnings.push({
        code: "overloaded",
        message: `Tasks need ${requestedMinutes} min but only ${availableMinutes} min are free in this range.`,
      });
    }

    const blocks = [...ctx.placed, ...buildBreaks(ctx)].sort((a, b) => a.start - b.start);
    return { blocks, unscheduled, warnings, windows, availableMinutes, requestedMinutes };
  }
}

interface PlaceOutcome {
  lastEnd: number;
  unscheduled?: UnscheduledTask;
  missedPreferred?: boolean;
}

function capLeft(ctx: Ctx, t: SchedulerTask, day: string): number {
  let cap = Infinity;
  if (t.maxMinutesPerDay !== undefined) cap = t.maxMinutesPerDay - (ctx.usage.get(`t|${t.id}|${day}`) ?? 0);
  const budget = t.groupId !== undefined ? ctx.input.groupBudgets?.[t.groupId] : undefined;
  if (budget !== undefined) cap = Math.min(cap, budget - (ctx.usage.get(`g|${t.groupId}|${day}`) ?? 0));
  return Math.max(0, cap);
}

function record(ctx: Ctx, t: SchedulerTask, block: PlannedBlock) {
  ctx.placed.push(block);
  const m = lenMin(block);
  const tk = `t|${t.id}|${block.day}`;
  ctx.usage.set(tk, (ctx.usage.get(tk) ?? 0) + m);
  if (t.groupId !== undefined) {
    const gk = `g|${t.groupId}|${block.day}`;
    ctx.usage.set(gk, (ctx.usage.get(gk) ?? 0) + m);
  }
}

/**
 * Candidate free intervals for a task: windows − busy − already placed blocks,
 * where focus blocks are padded by the break length so focus sessions never touch.
 */
function candidates(
  ctx: Ctx,
  t: SchedulerTask,
  depEnd: number,
  opts: { preferredOnly: boolean; ignoreBounds?: boolean },
): WorkWindow[] {
  const isFocus = (t.kind ?? "focus") === "focus";
  const pad = isFocus ? ctx.breakMs : 0;
  const occupied: Interval[] = [];
  for (const b of ctx.input.busy) {
    const padThis = b.taskId !== undefined && b.kind !== "commitment" ? pad : 0;
    occupied.push({ start: b.start - padThis, end: b.end + padThis });
  }
  for (const p of ctx.placed) {
    const padThis = p.kind === "focus" ? pad : 0;
    occupied.push({ start: p.start - padThis, end: p.end + padThis });
  }
  const free = computeFreeIntervals(ctx.windows, occupied, ctx.input.notBefore, STEP_MINUTES);
  if (opts.ignoreBounds) return free;

  const lo = Math.max(t.earliestStart ?? -Infinity, depEnd);
  const hi = t.latestEnd ?? Infinity;
  const out: WorkWindow[] = [];
  for (const f of free) {
    let c = clampInterval(f, lo, hi);
    if (c && t.allowedWindow) {
      c = clampInterval(
        c,
        localToInstant(f.day, t.allowedWindow.startMinute, ctx.input.timezone),
        localToInstant(f.day, t.allowedWindow.endMinute, ctx.input.timezone),
      );
    }
    if (c && opts.preferredOnly && t.preferredWindow) {
      const pw = {
        start: localToInstant(f.day, t.preferredWindow.startMinute, ctx.input.timezone),
        end: localToInstant(f.day, t.preferredWindow.endMinute, ctx.input.timezone),
      };
      c = clampInterval(c, pw.start, pw.end);
    }
    if (!c) continue;
    const start = snapUp(c.start);
    const end = snapDown(c.end);
    if (end > start) out.push({ start, end, day: f.day });
  }
  return out;
}

function placeIndivisible(ctx: Ctx, t: SchedulerTask, depEnd: number): PlaceOutcome {
  const D = t.remainingMinutes;
  const kind = t.kind === "commitment" ? "commitment" : "focus";
  const passes = t.preferredWindow ? [true, false] : [false];
  let capBlocked = false;
  for (const preferredOnly of passes) {
    for (const c of candidates(ctx, t, depEnd, { preferredOnly })) {
      if (lenMin(c) < D) continue;
      if (capLeft(ctx, t, c.day) < D) {
        capBlocked = true;
        continue;
      }
      const block: PlannedBlock = { taskId: t.id, kind, start: c.start, end: c.start + D * MINUTE, day: c.day };
      record(ctx, t, block);
      return { lastEnd: block.end, missedPreferred: !!t.preferredWindow && !preferredOnly };
    }
  }

  const bounded = candidates(ctx, t, depEnd, { preferredOnly: false });
  const unbounded = candidates(ctx, t, depEnd, { preferredOnly: false, ignoreBounds: true });
  const longest = bounded.reduce((m, c) => Math.max(m, lenMin(c)), 0);
  let u: UnscheduledTask;
  if (capBlocked) {
    u = {
      taskId: t.id,
      remainingMinutes: D,
      code: "daily_limit",
      reason: "A slot exists, but it would exceed the daily limit for this task or its group.",
      suggestion: "Raise the daily limit or extend the date range.",
    };
  } else if (!bounded.length && unbounded.length) {
    u = {
      taskId: t.id,
      remainingMinutes: D,
      code: "outside_window",
      reason: "No free time within the task's allowed start/finish window or after its prerequisites.",
      suggestion: "Widen the task's time window or move its prerequisites earlier.",
    };
  } else if (!bounded.length) {
    u = {
      taskId: t.id,
      remainingMinutes: D,
      code: "no_time",
      reason: "No free time left in your working hours for this range.",
      suggestion: "Extend your working hours, move a commitment, or schedule it on another day.",
    };
  } else {
    u = {
      taskId: t.id,
      remainingMinutes: D,
      code: "no_continuous_slot",
      reason: `Needs ${D} uninterrupted minutes; the longest free gap is ${longest} min.`,
      suggestion: "Free a longer gap, schedule it on another day, or allow it to be split.",
    };
  }
  return { lastEnd: -Infinity, unscheduled: u };
}

function placeSplittable(ctx: Ctx, t: SchedulerTask, depEnd: number): PlaceOutcome {
  const { minS, maxS, chunkTarget } = sessionBounds(t, ctx.input.preferences.focusMinutes);
  let remaining = t.remainingMinutes;
  let segment = 0;
  let lastEnd = -Infinity;
  let missedPreferred = false;
  const passes = t.preferredWindow ? [true, false] : [false];

  for (const preferredOnly of passes) {
    while (remaining > 0) {
      let placedOne = false;
      for (const c of candidates(ctx, t, depEnd, { preferredOnly })) {
        const space = Math.min(lenMin(c), capLeft(ctx, t, c.day));
        const chunk = pickChunk(remaining, space, minS, maxS, chunkTarget);
        if (chunk <= 0) continue;
        segment += 1;
        const block: PlannedBlock = {
          taskId: t.id,
          kind: "focus",
          start: c.start,
          end: c.start + chunk * MINUTE,
          day: c.day,
          segment,
        };
        record(ctx, t, block);
        remaining -= chunk;
        lastEnd = Math.max(lastEnd, block.end);
        if (!preferredOnly && t.preferredWindow) missedPreferred = true;
        placedOne = true;
        break;
      }
      if (!placedOne) break;
    }
  }

  if (remaining > 0) {
    const placedMin = t.remainingMinutes - remaining;
    const anyFree = candidates(ctx, t, depEnd, { preferredOnly: false }).length > 0;
    return {
      lastEnd,
      missedPreferred,
      unscheduled: {
        taskId: t.id,
        remainingMinutes: remaining,
        code: placedMin > 0 ? "partial" : anyFree ? "no_continuous_slot" : "no_time",
        reason:
          placedMin > 0
            ? `Only ${placedMin} of ${t.remainingMinutes} min fit; ${remaining} min remain unscheduled.`
            : anyFree
              ? `No free gap of at least ${minS} min (the minimum session length).`
              : "No free time left in your working hours for this range.",
        suggestion: "Extend the date range or working hours, or lower the minimum session length.",
      },
    };
  }
  return { lastEnd, missedPreferred };
}

/** Breaks between adjacent focus blocks separated only by free working time. */
function buildBreaks(ctx: Ctx): PlannedBlock[] {
  if (ctx.breakMs <= 0) return [];
  const focus: Array<Interval & { fresh: boolean }> = [
    ...ctx.placed.filter((p) => p.kind === "focus").map((p) => ({ start: p.start, end: p.end, fresh: true })),
    ...ctx.input.busy
      .filter((b) => b.taskId !== undefined && b.kind !== "commitment" && b.kind !== "break")
      .map((b) => ({ start: b.start, end: b.end, fresh: false })),
  ].sort((a, b) => a.start - b.start);

  const others: Interval[] = [
    ...ctx.input.busy.filter((b) => !(b.taskId !== undefined && b.kind !== "commitment")),
    ...ctx.placed.filter((p) => p.kind !== "focus"),
  ];
  const out: PlannedBlock[] = [];
  for (let i = 0; i + 1 < focus.length; i++) {
    const a = focus[i]!;
    const b = focus[i + 1]!;
    if (!a.fresh && !b.fresh) continue;
    const gap = b.start - a.end;
    if (gap < ctx.breakMs || gap > ctx.breakMs + 15 * MINUTE) continue;
    const brk = { start: a.end, end: a.end + ctx.breakMs };
    if (ctx.input.notBefore !== undefined && brk.start < ctx.input.notBefore) continue;
    if (others.some((o) => overlaps(o, { start: a.end, end: b.start }))) continue;
    const win = ctx.windows.find((w) => w.start <= brk.start && brk.end <= w.end);
    if (!win) continue;
    out.push({ taskId: null, kind: "break", start: brk.start, end: brk.end, day: win.day });
  }
  return out;
}

export const defaultScheduler: Scheduler = new GreedyScheduler();

export function generateSchedule(input: SchedulerInput, scheduler: Scheduler = defaultScheduler): ScheduleResult {
  return scheduler.schedule(input);
}
