import { z } from "zod";
import { isValidTimezone } from "./time.js";

export const TASK_STATUSES = ["not_started", "scheduled", "in_progress", "completed", "partial", "skipped", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const BLOCK_KINDS = ["focus", "break", "commitment"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const BLOCK_STATUSES = ["planned", "in_progress", "completed", "partial", "skipped", "missed"] as const;
export type BlockStatus = (typeof BLOCK_STATUSES)[number];

export const VERIFICATION_STATUSES = ["verified", "manual", "evidence", "pending", "unavailable", "failed"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  verified: "Verified by integration",
  manual: "Manually marked complete",
  evidence: "Evidence submitted",
  pending: "Pending verification",
  unavailable: "Verification unavailable",
  failed: "Verification failed",
};

export const GOAL_CATEGORIES = ["dsa", "course", "project", "study", "fitness", "reading", "other"] as const;
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<GoalCategory, string> = {
  dsa: "DSA / Coding",
  course: "Course",
  project: "Project",
  study: "Study",
  fitness: "Fitness",
  reading: "Reading",
  other: "Other",
};

export const PRIORITY_LABELS: Record<number, string> = { 1: "Low", 2: "Normal", 3: "High", 4: "Urgent" };

export const NOTIFICATION_CATEGORIES = ["upcoming_block", "deadline", "focus_end", "group", "reminder", "integration", "weekly_recap"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use HH:mm");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const isoDateTime = z.string().datetime({ offset: true });
const weekday = z.number().int().min(1).max(7);
export const timezoneSchema = z.string().refine(isValidTimezone, "Unknown timezone");

export const timeRangeSchema = z.object({ start: hhmm, end: hhmm }).refine((r) => r.start !== r.end, "Range is empty");

export const recurrenceSchema = z
  .object({
    type: z.enum(["none", "daily", "weekdays", "weekly"]),
    weekdays: z.array(weekday).optional(),
  })
  .refine((r) => r.type !== "weekly" || (r.weekdays?.length ?? 0) > 0, "Pick at least one weekday");
export type Recurrence = z.infer<typeof recurrenceSchema>;

export const preferencesSchema = z.object({
  focusMinutes: z.number().int().min(5).max(240).default(50),
  breakMinutes: z.number().int().min(0).max(60).default(10),
  /** When true, time in a background tab counts as focus time until the user pauses. */
  countBackgroundTime: z.boolean().default(true),
  partialCountsTowardCompletion: z.boolean().default(true),
  /**
   * Reminders while today's plan has open items: a browser push every few hours, and one final
   * email at the end of the day. Nothing is sent once everything is done.
   */
  reminders: z
    .object({
      /** Browser push every `every` hours from `startHour` while anything is open. */
      push: z.boolean().default(true),
      every: z.number().int().min(1).max(12).default(4),
      startHour: z.number().int().min(0).max(23).default(9),
      /** The final reminder of the day (email + push) at this local hour. */
      email: z.boolean().default(true),
      hour: z.number().int().min(0).max(23).default(21),
      /** A push when a group task is due within two hours and still open. */
      groupDueSoon: z.boolean().default(true),
    })
    .default({ push: true, every: 4, startHour: 9, email: true, hour: 21, groupDueSoon: true }),
  /** Daily automation: build each day's plan from roadmaps, revisions and group tasks. */
  planning: z
    .object({
      /** Also place the day's work into free time on the schedule. */
      autoPlan: z.boolean().default(true),
      /** Load guard: new roadmap items beyond this many minutes move to a later day. */
      maxStudyMinutesPerDay: z.number().int().min(15).max(16 * 60).default(180),
      /** At most this many revisions per day across all roadmaps (the rest carry over). */
      dailyReviewCap: z.number().int().min(0).max(30).default(5),
    })
    .default({ autoPlan: true, maxStudyMinutesPerDay: 180, dailyReviewCap: 5 }),
  /** Category -> enabled. Missing categories are enabled. */
  notifications: z.partialRecord(z.enum(NOTIFICATION_CATEGORIES), z.boolean()).default({}),
  privacy: z
    .object({
      shareCompletions: z.boolean().default(true),
      shareFocusSessions: z.boolean().default(false),
      shareStreaks: z.boolean().default(true),
      showOnLeaderboard: z.boolean().default(true),
      shareFocusPresence: z.boolean().default(false),
    })
    .default({
      shareCompletions: true,
      shareFocusSessions: false,
      shareStreaks: true,
      showOnLeaderboard: true,
      shareFocusPresence: false,
    }),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const DEFAULT_PREFERENCES: Preferences = preferencesSchema.parse({});

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,24}$/, "3–24 characters: letters, numbers, underscore")
    .optional(),
  avatar: z.string().max(16).optional(),
  bio: z.string().max(280).optional(),
  timezone: timezoneSchema.optional(),
  preferences: preferencesSchema.partial().optional(),
  completeOnboarding: z.boolean().optional(),
});

export const availabilitySchema = z.object({
  weekly: z.record(z.string().regex(/^[1-7]$/), z.array(timeRangeSchema).max(4)),
  blocked: z.array(timeRangeSchema.and(z.object({ weekdays: z.array(weekday).min(1), label: z.string().max(60).optional() }))).max(20),
  overrides: z
    .array(z.object({ date: isoDate, off: z.boolean().optional(), windows: z.array(timeRangeSchema).max(4).optional() }))
    .max(366),
});
export type AvailabilityInput = z.infer<typeof availabilitySchema>;

export const goalInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional().nullable(),
  category: z.enum(GOAL_CATEGORIES).default("other"),
  startDate: isoDate.optional().nullable(),
  deadline: isoDate.optional().nullable(),
  targetQuantity: z.number().int().positive().max(100000).optional().nullable(),
  targetUnit: z.string().max(40).optional().nullable(),
  recurrence: recurrenceSchema.default({ type: "none" }),
  priority: z.number().int().min(1).max(4).default(2),
  progressMethod: z.enum(["tasks", "quantity", "minutes"]).default("tasks"),
});
export type GoalInput = z.infer<typeof goalInputSchema>;

export const verificationSchema = z
  .discriminatedUnion("provider", [
    z.object({ provider: z.literal("none") }),
    z.object({
      provider: z.literal("leetcode"),
      /**
       * problem: an accepted submission of `slug` · count: N distinct problems ·
       * potd: that day's LeetCode Problem of the Day (UTC day).
       */
      mode: z.enum(["count", "potd", "problem"]).default("count"),
      count: z.number().int().min(1).max(50).default(1),
      difficulty: z.enum(["Any", "Easy", "Medium", "Hard"]).default("Any"),
      slug: z.string().regex(/^[a-z0-9-]{1,120}$/).optional(),
    }),
    z.object({
      provider: z.literal("codeforces"),
      /** problem: an accepted submission of `key` (e.g. "1850A") · count: N distinct problems. */
      mode: z.enum(["count", "problem"]).default("count"),
      count: z.number().int().min(1).max(50).default(1),
      minRating: z.number().int().min(0).max(4000).optional(),
      key: z.string().regex(/^\d{1,6}[A-Z]\d?$/).optional(),
    }),
  ])
  .refine((v) => v.provider === "none" || v.mode !== "problem" || (v.provider === "leetcode" ? !!v.slug : !!v.key), {
    message: "Pick the problem to verify",
    path: ["mode"],
  });
export type VerificationConfig = z.infer<typeof verificationSchema>;

const minuteField = z.number().int().min(5).max(24 * 60);

export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000).optional().nullable(),
    goalId: z.string().optional().nullable(),
    estimatedMinutes: minuteField,
    priority: z.number().int().min(1).max(4).default(2),
    dueAt: isoDateTime.optional().nullable(),
    earliestStartAt: isoDateTime.optional().nullable(),
    latestFinishAt: isoDateTime.optional().nullable(),
    timeWindow: timeRangeSchema.optional().nullable(),
    preferredTime: z.enum(["morning", "afternoon", "evening"]).optional().nullable(),
    splittable: z.boolean().default(false),
    minSessionMinutes: minuteField.optional().nullable(),
    maxSessionMinutes: minuteField.optional().nullable(),
    preferredSessionMinutes: minuteField.optional().nullable(),
    maxMinutesPerDay: minuteField.optional().nullable(),
    dependsOn: z.array(z.string()).max(20).default([]),
    recurrence: recurrenceSchema.default({ type: "none" }),
    verification: verificationSchema.default({ provider: "none" }),
    completionCriteria: z.string().max(500).optional().nullable(),
    resourceUrl: z.string().url().max(2000).optional().nullable(),
  })
  .refine(
    (t) => !t.minSessionMinutes || !t.maxSessionMinutes || t.minSessionMinutes <= t.maxSessionMinutes,
    { message: "Minimum session must not exceed maximum session", path: ["minSessionMinutes"] },
  )
  .refine((t) => t.splittable || !t.maxSessionMinutes || t.maxSessionMinutes >= t.estimatedMinutes, {
    message: "An indivisible task needs one session of its full duration",
    path: ["maxSessionMinutes"],
  });
export type TaskInput = z.infer<typeof taskInputSchema>;

export const commitmentInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    flexible: z.boolean().default(false),
    /** Fixed: exact start/end of the first occurrence. */
    startAt: isoDateTime.optional().nullable(),
    endAt: isoDateTime.optional().nullable(),
    /** Flexible: a window on a date (or weekly) and a duration. */
    date: isoDate.optional().nullable(),
    window: timeRangeSchema.optional().nullable(),
    durationMinutes: minuteField.optional().nullable(),
    recurrence: recurrenceSchema.default({ type: "none" }),
    until: isoDate.optional().nullable(),
  })
  .superRefine((c, ctx) => {
    if (!c.flexible) {
      if (!c.startAt || !c.endAt) ctx.addIssue({ code: "custom", message: "Start and end are required", path: ["startAt"] });
      else if (Date.parse(c.endAt) <= Date.parse(c.startAt))
        ctx.addIssue({ code: "custom", message: "End must be after start", path: ["endAt"] });
      else if (Date.parse(c.endAt) - Date.parse(c.startAt) > 24 * 3600_000)
        ctx.addIssue({ code: "custom", message: "A commitment can last at most 24 hours", path: ["endAt"] });
    } else {
      if (!c.window || !c.durationMinutes)
        ctx.addIssue({ code: "custom", message: "Window and duration are required", path: ["window"] });
      if (c.recurrence.type === "none" && !c.date) ctx.addIssue({ code: "custom", message: "Pick a date", path: ["date"] });
    }
  });
export type CommitmentInput = z.infer<typeof commitmentInputSchema>;

export const generateScheduleSchema = z.object({
  date: isoDate,
  /** Optional multi-day horizon end (inclusive). */
  endDate: isoDate.optional(),
  /** "remaining" keeps everything in the past and regenerates from now. */
  mode: z.enum(["full", "remaining"]).default("remaining"),
});

export const blockUpdateSchema = z.object({
  startAt: isoDateTime.optional(),
  endAt: isoDateTime.optional(),
  locked: z.boolean().optional(),
  status: z.enum(["planned", "completed", "partial", "skipped"]).optional(),
});

export const quickTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  estimatedMinutes: minuteField.default(30),
});

export const focusStartSchema = z.object({
  taskId: z.string().optional().nullable(),
  blockId: z.string().optional().nullable(),
  plannedMinutes: z.number().int().min(1).max(240),
  kind: z.enum(["focus", "break"]).default("focus"),
});

export const focusFinishSchema = z.object({
  note: z.string().max(1000).optional().nullable(),
  /** What happened to the task — independent from the timer. */
  taskOutcome: z.enum(["none", "completed", "partial"]).default("none"),
});

export const completeTaskSchema = z.object({
  outcome: z.enum(["completed", "partial"]).default("completed"),
  occurrenceDate: isoDate.optional(),
  note: z.string().max(1000).optional().nullable(),
  evidenceUrl: z.string().url().max(2000).optional().nullable(),
});

export const groupInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional().nullable(),
});
