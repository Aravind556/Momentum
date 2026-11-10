import type { TaskReminder } from "@momentum/shared";
import type { FollowSettings, PointsConfig, Preferences, Recurrence, TimeRange, VerificationConfig } from "@momentum/shared";

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
  user: { id: string; email: string; name: string; username: string | null };
  profile: Profile;
  memberships: Array<{ groupId: string; role: string }>;
  connections: Array<{ provider: string; status: string }>;
  streak: { current: number; longest: number };
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  goalId: string | null;
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
  reminder: TaskReminder | null;
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
  /** Day-plan items (problems, revisions, group tasks): open all day unless `timed`. */
  dayItems: Array<{ taskId: string; day: string; title: string; category: string; source: string; label: string | null; status: "pending" | "done" | "skipped"; timed: boolean }>;
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

export interface Group {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  points: PointsConfig;
  role: string;
  memberCount: number;
  myRank: number | null;
  myPoints: number;
}

export interface GroupMember extends PublicUser {
  role: "owner" | "admin" | "member";
  joinedAt: string;
  streak: number | null;
}

export interface GroupOverview {
  group: Omit<Group, "role" | "memberCount" | "myRank" | "myPoints"> & { myRole: "owner" | "admin" | "member" };
  members: GroupMember[];
}

export interface LeaderboardView {
  period: "week" | "month" | "all";
  rows: Array<{ rank: number | null; user: PublicUser; points: number; completions: number; firsts: number; solved: number }>;
  hiddenCount: number;
  rules: string;
}

export interface GroupTaskToday {
  id: string;
  kind: "problem" | "custom" | "potd";
  title: string;
  description: string | null;
  category: string;
  url: string | null;
  difficulty: string | null;
  repeat: "once" | "daily" | "weekdays";
  dueTime: string;
  dueAt: string;
  points: number;
  estMinutes: number;
  doneCount: number;
  memberCount: number;
  members: Array<{ user: PublicUser; done: boolean; completedAt: string | null; rank: number | null; points: number | null; verifiedBy: "submission" | "self" | null }>;
}

export interface SharedRoadmap {
  id: string;
  title: string;
  description: string | null;
  archived: boolean;
  owner: PublicUser | null;
  isOwner: boolean;
  total: number;
  memberCount: number;
  followers: Array<{ user: PublicUser | null; active: boolean; done: number; doneThisWeek: number }>;
  iFollow: boolean;
  isGroupRoadmap: boolean;
  almostGroup: boolean;
}

/** A coding platform the server can verify against (from GET /integrations). */
export interface Platform {
  provider: string;
  label: string;
  description: string;
  handlePattern: string;
  limitations: string[];
  available: boolean;
  unavailableReason: string | null;
  connection: { status: string; externalAccountId: string; lastSyncAt: string | null; lastError: string | null; nextSyncAfter: string | null } | null;
}

export interface Notification {
  id: string;
  type: string;
  payload: { message?: string; link?: string; [k: string]: unknown };
  readAt: string | null;
  createdAt: string;
}

export type Category = "leetcode" | "codeforces" | "codechef" | "other";

export interface FollowInfo {
  settings: FollowSettings;
  active: boolean;
  startedAt: string;
  viaGroupId: string | null;
}

export interface RoadmapSummary {
  id: string;
  title: string;
  description: string | null;
  ownerId: string;
  isOwner: boolean;
  archived: boolean;
  total: number;
  done: number;
  skipped: number;
  remaining: number;
  followers: number;
  follow: FollowInfo | null;
  projectedFinish: string | null;
}

export interface RoadmapItem {
  id: string;
  roadmapId: string;
  position: number;
  title: string;
  url: string | null;
  category: Category;
  platform: string | null;
  problemKey: string | null;
  difficulty: string | null;
  estMinutes: number;
  section: string | null;
  status: "queued" | "active" | "done" | "skipped";
  doneAt: string | null;
  verifiedBy: "submission" | "self" | null;
}

export interface RoadmapDetail extends RoadmapSummary {
  items: RoadmapItem[];
}

export interface ReviewCard {
  id: string;
  title: string;
  url: string | null;
  category: Category;
  platform: string | null;
  dueDate: string;
  lastReviewedOn: string;
  reps: number;
  baseInterval: number;
  multiplier: number;
  roadmap: { id: string; title: string } | null;
}

export interface TodayItem {
  taskId: string;
  title: string;
  url: string | null;
  category: string;
  source: "manual" | "roadmap" | "review" | "group" | string;
  label: string | null;
  estMinutes: number;
  status: "pending" | "done" | "skipped";
  check: "submission" | "self";
  verifiedBy: "submission" | "self" | null;
  completedAt: string | null;
  block: { startAt: string; endAt: string; status: string } | null;
  review: { cardId: string; quality: number | null } | null;
  recurring: boolean;
  swappable: boolean;
  dueAt: string | null;
  reminder: TaskReminder | null;
}

export interface TodayView {
  day: string;
  items: TodayItem[];
  summary: { total: number; done: number; minutesPlanned: number };
  deferred: number;
}
