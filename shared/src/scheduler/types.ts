import type { Interval } from "../intervals.js";

/** Local wall-clock range, "HH:mm". If end <= start the range crosses midnight. */
export interface TimeRange {
  start: string;
  end: string;
}

export interface AvailabilitySpec {
  /** ISO weekday (1 = Monday .. 7 = Sunday) -> working ranges. Missing/empty = not available. */
  weekly: Partial<Record<number, TimeRange[]>>;
  /** Recurring unavailable intervals, e.g. lunch every weekday. */
  blocked: Array<TimeRange & { weekdays: number[]; label?: string }>;
  /** Date-specific overrides. `off` removes the day; `windows` replaces the weekly ranges. */
  overrides: Array<{ date: string; off?: boolean; windows?: TimeRange[] }>;
}

export type BusyKind = "commitment" | "locked" | "completed" | "in_progress" | "break" | "blocked";

export interface BusyInterval extends Interval {
  kind: BusyKind;
  label?: string;
  /** If set, this busy interval is (part of) the given task — counts as a focus block for break spacing. */
  taskId?: string;
}

export type TaskKind = "focus" | "commitment";

export interface SchedulerTask {
  id: string;
  title: string;
  kind?: TaskKind;
  /** Minutes still to be scheduled. 0 means already satisfied by preserved blocks. */
  remainingMinutes: number;
  /** 1 (low) .. 4 (urgent). */
  priority: number;
  splittable: boolean;
  minSessionMinutes?: number;
  maxSessionMinutes?: number;
  preferredSessionMinutes?: number;
  /** Hard bounds (epoch ms). */
  earliestStart?: number;
  latestEnd?: number;
  /** Soft: we try to finish before it and warn if we cannot. */
  deadline?: number;
  dependsOn?: string[];
  /** Soft preference, local minutes of day. */
  preferredWindow?: { startMinute: number; endMinute: number };
  /** Hard daily window, local minutes of day (e.g. a workout only between 17:00 and 20:00). */
  allowedWindow?: { startMinute: number; endMinute: number };
  /** Daily cap for this task across a multi-day horizon. */
  maxMinutesPerDay?: number;
  /** Tasks sharing a group share a daily budget (see SchedulerInput.groupBudgets). */
  groupId?: string;
  /** End of the latest preserved (locked/completed) block for this task. Dependents start after it. */
  existingBlocksEnd?: number;
  /** Stable tiebreaker, e.g. creation order. */
  order?: number;
}

export interface SchedulerPreferences {
  /** Default focus-session length for splittable tasks without their own preference. */
  focusMinutes: number;
  /** Minimum gap between consecutive focus blocks. 0 disables breaks. */
  breakMinutes: number;
}

export interface SchedulerInput {
  timezone: string;
  /** Inclusive local dates. */
  startDate: string;
  endDate: string;
  /** Nothing is placed before this instant (e.g. "now" when regenerating). */
  notBefore?: number;
  availability: AvailabilitySpec;
  busy: BusyInterval[];
  tasks: SchedulerTask[];
  /** Ids of tasks that are complete — dependencies on them are satisfied. */
  satisfiedTaskIds?: string[];
  preferences: SchedulerPreferences;
  /** groupId -> minutes per day. */
  groupBudgets?: Record<string, number>;
}

export type PlannedBlockKind = "focus" | "break" | "commitment";

export interface PlannedBlock {
  taskId: string | null;
  kind: PlannedBlockKind;
  start: number;
  end: number;
  /** Local date of the working day this block belongs to. */
  day: string;
  /** 1-based index of this segment for split tasks. */
  segment?: number;
}

export type UnscheduledCode =
  | "no_time"
  | "no_continuous_slot"
  | "partial"
  | "dependency_unscheduled"
  | "dependency_cycle"
  | "dependency_missing"
  | "outside_window"
  | "daily_limit";

export interface UnscheduledTask {
  taskId: string;
  remainingMinutes: number;
  code: UnscheduledCode;
  reason: string;
  /** Concrete next step for the user. */
  suggestion?: string;
}

export interface ScheduleWarning {
  taskId?: string;
  code: "after_deadline" | "preferred_window_missed" | "overloaded";
  message: string;
}

export interface WorkWindow extends Interval {
  day: string;
}

export interface ScheduleResult {
  blocks: PlannedBlock[];
  unscheduled: UnscheduledTask[];
  warnings: ScheduleWarning[];
  /** Working windows after overrides (before subtracting busy time). */
  windows: WorkWindow[];
  /** Total free minutes before placement. */
  availableMinutes: number;
  /** Total minutes requested by tasks. */
  requestedMinutes: number;
}

/** Pluggable engine boundary: a constraint solver (e.g. OR-Tools) can implement this later. */
export interface Scheduler {
  readonly name: string;
  schedule(input: SchedulerInput): ScheduleResult;
}
