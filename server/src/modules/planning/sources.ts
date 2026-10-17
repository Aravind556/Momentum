import type { Preferences, VerificationConfig } from "@cadence/shared";
import type { Services } from "../../core/context.js";
import type { Tx } from "../../core/db/index.js";
import type { Task } from "../tasks/tasks.js";

/**
 * Something that can put work on a day plan: roadmap items, revisions, group tasks — and later,
 * anything else (contest reminders, course modules, ...). Each source is one implementation
 * registered with `registerDailySource`; the day builder (daily.ts) never needs to change.
 */
export interface DailyCandidate {
  sourceId: string;
  title: string;
  url: string | null;
  category: string;
  platform: string | null;
  problemKey: string | null;
  estMinutes: number;
  preferredTime: "morning" | "afternoon" | "evening" | null;
  /** Shown on the day plan (roadmap title, "Revision", group name). */
  label: string;
  /** "new" work can be moved to a later day by the load guard; "due" work cannot. */
  kind: "due" | "new";
  /** Accepted submissions count from this moment (e.g. when the roadmap was followed). */
  verifyFrom: Date;
  /** 1 (low) – 4 (urgent); higher is scheduled first. */
  priority: number;
  /** Overrides the default check (the exact problem on its platform), e.g. LeetCode's daily problem. */
  verification?: VerificationConfig;
  /** Must be done by this time (the scheduler places it before). */
  dueAt?: Date;
}

export interface DayContext {
  s: Services;
  db: Tx;
  userId: string;
  day: string;
  tz: string;
  prefs: Preferences;
  /** All tasks this source already generated for `day`, any status. */
  todays: Task[];
  /** Side effects to run after the plan is saved (e.g. marking already-solved items done). */
  after: Array<() => Promise<unknown>>;
  /** Forecast only: free minutes per future day (availability minus classes), for the load guard. */
  capacity?: Map<string, number>;
}

export interface DailySource {
  /** Stored in tasks.source. */
  key: string;
  /** Items of this source can't be swapped for something else (e.g. group tasks). */
  fixed?: boolean;
  /**
   * The full set of items this source wants on `day`, in priority order — including ones already
   * on the plan. Items finished, skipped or swapped out today must not be returned again.
   */
  desired(ctx: DayContext): Promise<DailyCandidate[]>;
  /** A generated task of this source was completed (verified = an accepted submission was found). */
  onComplete?(s: Services, task: Task, verified: boolean): Promise<void>;
  /** Other items of the same category the learner could do instead of `task` today. */
  swapOptions?(ctx: DayContext, task: Task): Promise<DailyCandidate[]>;
  /**
   * What this source expects to add on each of the coming `days` (after today), assuming today's
   * plan gets done. Read-only: used for "Coming up" and tentative week blocks.
   */
  forecast?(ctx: DayContext, days: string[]): Promise<ForecastEntry[]>;
}

export interface ForecastEntry {
  day: string;
  candidate: DailyCandidate;
}

const sources = new Map<string, DailySource>();

export function registerDailySource(source: DailySource) {
  sources.set(source.key, source);
}

export function dailySources(): DailySource[] {
  return [...sources.values()];
}

export function dailySource(key: string): DailySource | undefined {
  return sources.get(key);
}
