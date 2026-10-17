import type { Preferences, Recurrence, TimeRange, VerificationConfig } from "@cadence/shared";

export interface Profile {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string | null;
  timezone: string;
  preferences: Preferences;
  onboardedAt: string | null;
  scheduleVersion: number;
}

export interface Me {
  user: { id: string; email: string; name: string };
  profile: Profile;
  memberships: Array<{ circleId: string; role: string }>;
  connections: Array<{ provider: string; status: string }>;
  streak: { current: number; longest: number };
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  goalId: string | null;
  challengeId: string | null;
  estimatedMinutes: number;
  priority: number;
  dueAt: string | null;
  earliestStartAt: string | null;
  latestFinishAt: string | null;
  timeWindow: TimeRange | null;
  preferredTime: "morning" | "afternoon" | "evening" | null;
  splittable: boolean;
  minSessionMinutes: number | null;
  maxSessionMinutes: number | null;
  preferredSessionMinutes: number | null;
  maxMinutesPerDay: number | null;
  recurrence: Recurrence;
  verification: VerificationConfig;
  completionCriteria: string | null;
  resourceUrl: string | null;
  status: string;
  version: number;
  dependsOn: string[];
  workedMinutes: number;
  lastCompletion: { occurrenceKey: string; outcome: string; verificationStatus: string; completedAt: string } | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  category: string;
  deadline: string | null;
  startDate: string | null;
  targetQuantity: number | null;
  targetUnit: string | null;
  priority: number;
  visibility: "private" | "circle";
  circleId: string | null;
  progressMethod: "tasks" | "quantity" | "minutes";
  status: string;
  recurrence: Recurrence;
  progress: { current: number; target: number; ratio: number; taskCount: number; minutes: number };
}

export interface Block {
  id: string;
  taskId: string | null;
  commitmentId: string | null;
  kind: "focus" | "break" | "commitment";
  title: string;
  startAt: string;
  endAt: string;
  day: string;
  status: "planned" | "in_progress" | "completed" | "partial" | "skipped" | "missed";
  locked: boolean;
  source: "auto" | "manual";
  segment: number | null;
  actualMinutes: number | null;
}

export interface UnscheduledItem {
  schedulerId: string;
  taskId: string | null;
  commitmentId: string | null;
  occurrenceDate: string | null;
  title: string;
  remainingMinutes: number;
  priority: number;
  splittable: boolean;
  reason: string | null;
  suggestion: string | null;
  code: string | null;
}

export interface ScheduleReport {
  version: number;
  generatedAt: string;
  placedBlocks: number;
  unscheduled: Array<{ taskId: string; title: string; remainingMinutes: number; code: string; reason: string; suggestion?: string }>;
  warnings: Array<{ taskId?: string; code: string; message: string }>;
  availableMinutes: number;
  requestedMinutes: number;
}

export interface ScheduleView {
  timezone: string;
  startDate: string;
  endDate: string;
  now: string;
  blocks: Block[];
  commitments: Array<{ commitmentId: string; title: string; start: string; end: string; date: string }>;
  windows: Array<{ day: string; start: string; end: string }>;
  unscheduled: UnscheduledItem[];
  lastReport: ScheduleReport | null;
}

export interface FocusSession {
  id: string;
  taskId: string | null;
  blockId: string | null;
  kind: "focus" | "break";
  plannedMinutes: number;
  startedAt: string;
  endedAt: string | null;
  status: "active" | "completed" | "stopped" | "abandoned";
  taskTitle: string | null;
  serverNow: string;
  elapsedSeconds: number;
  activeSeconds: number;
  pausedSeconds: number;
  isPaused: boolean;
  remainingSeconds: number;
  note: string | null;
  taskOutcome: string | null;
}

export interface Commitment {
  id: string;
  title: string;
  flexible: boolean;
  startAt: string | null;
  endAt: string | null;
  date: string | null;
  window: TimeRange | null;
  durationMinutes: number | null;
  recurrence: Recurrence;
  until: string | null;
}

export interface PublicUser {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string | null;
}

export interface Circle {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  settings: { rankingMode: string };
  role: string;
  memberCount: number;
}

export interface Challenge {
  id: string;
  circleId: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  metric: "completions" | "focus_minutes" | "verified";
  individualTarget: number | null;
  collectiveTarget: number | null;
  status: "upcoming" | "active" | "completed";
  joined: boolean;
  participantCount?: number;
  myProgress?: number;
  collective?: number | { value: number; target: number | null; ratio: number | null };
}

export interface Activity {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
  actor: PublicUser | null;
  reactions: Array<{ emoji: string; count: number; reacted: boolean }>;
  comments: Array<{ id: string; body: string; createdAt: string; author: PublicUser | null }>;
}

export interface Notification {
  id: string;
  type: string;
  payload: { message?: string; link?: string; [k: string]: unknown };
  readAt: string | null;
  createdAt: string;
}
