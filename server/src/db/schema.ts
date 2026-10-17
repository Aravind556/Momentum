import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Preferences, Recurrence, TimeRange, VerificationConfig } from "@cadence/shared";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ---------------------------------------------------------------- auth (better-auth) */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ---------------------------------------------------------------- profile & availability */

export const profiles = pgTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatar: text("avatar").notNull().default("🙂"),
  bio: text("bio"),
  timezone: text("timezone").notNull().default("UTC"),
  preferences: jsonb("preferences").$type<Preferences>().notNull(),
  onboardedAt: ts("onboarded_at"),
  /** Incremented on every schedule generation. */
  scheduleVersion: integer("schedule_version").notNull().default(0),
  /** Unscheduled tasks and warnings from the most recent generation. */
  lastScheduleReport: jsonb("last_schedule_report").$type<Record<string, unknown> | null>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** work = allowed working range; blocked = recurring unavailable range. */
    kind: text("kind", { enum: ["work", "blocked"] }).notNull(),
    weekdays: integer("weekdays").array().notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    label: text("label"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("availability_user_idx").on(t.userId)],
);

export const availabilityOverrides = pgTable(
  "availability_overrides",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    off: boolean("off").notNull().default(false),
    windows: jsonb("windows").$type<TimeRange[]>(),
  },
  (t) => [uniqueIndex("availability_override_unique").on(t.userId, t.date)],
);

export const commitments = pgTable(
  "commitments",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    flexible: boolean("flexible").notNull().default(false),
    startAt: ts("start_at"),
    endAt: ts("end_at"),
    date: text("date"),
    window: jsonb("window").$type<TimeRange>(),
    durationMinutes: integer("duration_minutes"),
    recurrence: jsonb("recurrence").$type<Recurrence>().notNull(),
    until: text("until"),
    createdAt: createdAt(),
  },
  (t) => [index("commitments_user_idx").on(t.userId)],
);

/* ---------------------------------------------------------------- circles & challenges */

export const circles = pgTable("circles", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  visibility: text("visibility", { enum: ["private"] }).notNull().default("private"),
  settings: jsonb("settings").$type<{ rankingMode: "consistency" | "volume" | "challenge" | "balanced" }>().notNull(),
  createdAt: createdAt(),
});

export const circleMemberships = pgTable(
  "circle_memberships",
  {
    id: id(),
    circleId: text("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
    status: text("status", { enum: ["active", "left", "removed"] }).notNull().default("active"),
    joinedAt: ts("joined_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("membership_unique").on(t.circleId, t.userId), index("membership_user_idx").on(t.userId)],
);

export const circleInvitations = pgTable("circle_invitations", {
  id: id(),
  circleId: text("circle_id")
    .notNull()
    .references(() => circles.id, { onDelete: "cascade" }),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  maxUses: integer("max_uses").notNull().default(25),
  uses: integer("uses").notNull().default(0),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

export const challenges = pgTable(
  "challenges",
  {
    id: id(),
    circleId: text("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    metric: text("metric", { enum: ["completions", "focus_minutes", "verified"] }).notNull(),
    individualTarget: integer("individual_target"),
    collectiveTarget: integer("collective_target"),
    taskTemplate: jsonb("task_template").$type<{ title: string; estimatedMinutes: number; splittable: boolean } | null>(),
    createdAt: createdAt(),
  },
  (t) => [index("challenges_circle_idx").on(t.circleId)],
);

export const challengeParticipants = pgTable(
  "challenge_participants",
  {
    id: id(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["joined", "left"] }).notNull().default("joined"),
    joinedAt: ts("joined_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("participant_unique").on(t.challengeId, t.userId)],
);

/* ---------------------------------------------------------------- goals & tasks */

export const goals = pgTable(
  "goals",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    circleId: text("circle_id").references(() => circles.id, { onDelete: "set null" }),
    challengeId: text("challenge_id").references(() => challenges.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull().default("other"),
    startDate: text("start_date"),
    deadline: text("deadline"),
    targetQuantity: integer("target_quantity"),
    targetUnit: text("target_unit"),
    recurrence: jsonb("recurrence").$type<Recurrence>().notNull(),
    priority: integer("priority").notNull().default(2),
    visibility: text("visibility", { enum: ["private", "circle"] }).notNull().default("private"),
    progressMethod: text("progress_method", { enum: ["tasks", "quantity", "minutes"] }).notNull().default("tasks"),
    status: text("status", { enum: ["active", "completed", "archived"] }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("goals_owner_idx").on(t.ownerId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
    challengeId: text("challenge_id").references(() => challenges.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    estimatedMinutes: integer("estimated_minutes").notNull(),
    priority: integer("priority").notNull().default(2),
    dueAt: ts("due_at"),
    earliestStartAt: ts("earliest_start_at"),
    latestFinishAt: ts("latest_finish_at"),
    timeWindow: jsonb("time_window").$type<TimeRange | null>(),
    preferredTime: text("preferred_time", { enum: ["morning", "afternoon", "evening"] }),
    splittable: boolean("splittable").notNull().default(false),
    minSessionMinutes: integer("min_session_minutes"),
    maxSessionMinutes: integer("max_session_minutes"),
    preferredSessionMinutes: integer("preferred_session_minutes"),
    maxMinutesPerDay: integer("max_minutes_per_day"),
    recurrence: jsonb("recurrence").$type<Recurrence>().notNull(),
    verification: jsonb("verification").$type<VerificationConfig>().notNull(),
    completionCriteria: text("completion_criteria"),
    resourceUrl: text("resource_url"),
    status: text("status", {
      enum: ["not_started", "scheduled", "in_progress", "completed", "partial", "skipped", "cancelled"],
    })
      .notNull()
      .default("not_started"),
    /** Tasks sharing a group share a daily minute budget (used by playlist plans). */
    groupKey: text("group_key"),
    groupDailyMinutes: integer("group_daily_minutes"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Optimistic-concurrency counter. */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_owner_status_idx").on(t.ownerId, t.status), index("tasks_goal_idx").on(t.goalId)],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnId: text("depends_on_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnId] })],
);

export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    commitmentId: text("commitment_id").references(() => commitments.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["focus", "break", "commitment"] }).notNull(),
    /** Snapshot so history survives task deletion. */
    title: text("title").notNull(),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    /** Local working day (user timezone) this block belongs to. */
    day: text("day").notNull(),
    status: text("status", { enum: ["planned", "in_progress", "completed", "partial", "skipped", "missed"] })
      .notNull()
      .default("planned"),
    locked: boolean("locked").notNull().default(false),
    source: text("source", { enum: ["auto", "manual"] }).notNull().default("auto"),
    version: integer("version").notNull().default(0),
    segment: integer("segment"),
    /** Minutes of real work recorded against this block. */
    actualMinutes: integer("actual_minutes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("blocks_user_start_idx").on(t.userId, t.startAt),
    index("blocks_user_day_idx").on(t.userId, t.day),
    index("blocks_task_idx").on(t.taskId),
  ],
);

export const focusSessions = pgTable(
  "focus_sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    blockId: text("block_id").references(() => scheduleBlocks.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["focus", "break"] }).notNull().default("focus"),
    plannedMinutes: integer("planned_minutes").notNull(),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at"),
    status: text("status", { enum: ["active", "completed", "stopped", "abandoned"] }).notNull().default("active"),
    activeSeconds: integer("active_seconds"),
    pausedSeconds: integer("paused_seconds"),
    note: text("note"),
    taskOutcome: text("task_outcome", { enum: ["none", "completed", "partial"] }),
    createdAt: createdAt(),
  },
  (t) => [
    index("focus_user_started_idx").on(t.userId, t.startedAt),
    uniqueIndex("focus_one_active_per_user").on(t.userId).where(sql`status = 'active'`),
  ],
);

export const focusPauses = pgTable(
  "focus_pauses",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => focusSessions.id, { onDelete: "cascade" }),
    pausedAt: ts("paused_at").notNull(),
    resumedAt: ts("resumed_at"),
  },
  (t) => [index("pauses_session_idx").on(t.sessionId)],
);

export const taskCompletions = pgTable(
  "task_completions",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "once" for one-off tasks, or the local date for recurring occurrences. */
    occurrenceKey: text("occurrence_key").notNull(),
    /** Local date of completion (user timezone) for analytics. */
    day: text("day").notNull(),
    completedAt: ts("completed_at").notNull().defaultNow(),
    outcome: text("outcome", { enum: ["completed", "partial"] }).notNull(),
    method: text("method", { enum: ["manual", "integration", "evidence"] }).notNull(),
    verificationStatus: text("verification_status", {
      enum: ["verified", "manual", "evidence", "pending", "unavailable", "failed"],
    }).notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown> | null>(),
    note: text("note"),
    voidedAt: ts("voided_at"),
  },
  (t) => [
    uniqueIndex("completion_unique_active").on(t.taskId, t.occurrenceKey).where(sql`voided_at is null`),
    index("completions_user_day_idx").on(t.userId, t.day),
  ],
);

/* ---------------------------------------------------------------- playlists */

export const playlists = pgTable("playlists", {
  id: id(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  source: text("source", { enum: ["youtube", "manual"] }).notNull(),
  externalId: text("external_id"),
  url: text("url"),
  title: text("title").notNull(),
  plan: jsonb("plan").$type<Record<string, unknown> | null>(),
  createdAt: createdAt(),
});

export const playlistItems = pgTable(
  "playlist_items",
  {
    id: id(),
    playlistId: text("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    url: text("url"),
    status: text("status", { enum: ["not_started", "partial", "completed"] }).notNull().default("not_started"),
    positionSeconds: integer("position_seconds").notNull().default(0),
  },
  (t) => [uniqueIndex("playlist_item_position").on(t.playlistId, t.position)],
);

/* ---------------------------------------------------------------- integrations */

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["leetcode", "github"] }).notNull(),
    externalAccountId: text("external_account_id").notNull(),
    /** AES-256-GCM encrypted JSON; never plaintext. */
    encryptedCredentials: text("encrypted_credentials"),
    status: text("status", { enum: ["connected", "error", "disconnected"] }).notNull().default("connected"),
    lastSyncAt: ts("last_sync_at"),
    lastError: text("last_error"),
    failureCount: integer("failure_count").notNull().default(0),
    nextSyncAfter: ts("next_sync_after"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("integration_user_provider").on(t.userId, t.provider)],
);

export const externalEvents = pgTable(
  "external_events",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    type: text("type").notNull(),
    occurredAt: ts("occurred_at").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("external_event_unique").on(t.userId, t.provider, t.externalId),
    index("external_events_user_time").on(t.userId, t.occurredAt),
  ],
);

/* ---------------------------------------------------------------- social & notifications */

export const activities = pgTable(
  "activities",
  {
    id: id(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    circleId: text("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    /** Only the shareable summary; never private task descriptions. */
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
  },
  (t) => [
    index("activities_circle_time").on(t.circleId, t.createdAt),
    uniqueIndex("activities_dedupe").on(t.circleId, t.dedupeKey),
  ],
);

export const activityReactions = pgTable(
  "activity_reactions",
  {
    id: id(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("reaction_unique").on(t.activityId, t.userId, t.emoji)],
);

export const activityComments = pgTable(
  "activity_comments",
  {
    id: id(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("comments_activity_idx").on(t.activityId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe").on(t.userId, t.dedupeKey),
    index("notifications_user_time").on(t.userId, t.createdAt),
  ],
);

/** Lease table so periodic jobs never run twice concurrently (across processes, too). */
export const jobLeases = pgTable("job_leases", {
  key: text("key").primaryKey(),
  lockedUntil: ts("locked_until").notNull(),
  lastRunAt: ts("last_run_at"),
});
