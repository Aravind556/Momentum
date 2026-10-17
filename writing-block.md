# PRD & Master Build Prompt: Social Accountability and Adaptive Productivity Platform

## 1. Your Role

Act as a senior product engineer, product designer, software architect, and pragmatic technical lead. Your task is to design and build a production-quality web application that combines collaborative goal tracking, adaptive daily scheduling, Pomodoro focus sessions, automatic progress verification, and social accountability.

Do not build a generic to-do list or a simple Pomodoro timer with a leaderboard. Build a cohesive product in which users plan their day, execute tasks in structured time blocks, track authentic progress, and stay accountable to their friends.

You are responsible for making thoughtful product decisions, implementing the application end to end, and ensuring that the result is functional, polished, secure, and maintainable.

Before writing code:
1. Inspect the existing repository, its framework, dependencies, architecture, and current implementation.
2. Identify existing features that can be reused.
3. Establish a clear implementation plan.
4. If the repository is empty, initialize an appropriate project structure.
5. Implement the product in working, testable increments rather than generating disconnected UI mockups.

Do not stop after creating a plan or a static frontend. Build the actual application, including database persistence, authentication, business logic, and functional interactions.

---

# 2. Product Overview

## 2.1 Product Vision

Create a centralized platform where people can plan, schedule, execute, and track their personal goals while collaborating with small groups of friends.

The product solves three interconnected problems:

- People have goals but struggle to convert them into realistic daily schedules.
- Productivity information is scattered across platforms such as LeetCode, GitHub, YouTube, and manual task managers.
- People often lose consistency because their progress is private, accountability is weak, and there is little social reinforcement.

Our platform combines these activities into one system.

Users should be able to define what they want to accomplish, specify when they are available, automatically generate a schedule, execute tasks using focus sessions, track completion, and optionally share their progress with friends.

The platform must make daily execution easier rather than create another administrative burden.

## 2.2 Core Product Pillars

### Pillar A: Adaptive Daily Planning

Convert goals and available time into a realistic, constraint-aware daily schedule.

### Pillar B: Social Accountability

Enable friends to create private groups, participate in challenges, view shared progress, and compete or collaborate through meaningful metrics.

### Pillar C: Verifiable Progress

Track actual task completion using integrations where reliable data is available, while supporting manual completion for other tasks.

These pillars must work together. A scheduled task should connect to its focus sessions, its completion record, the user's daily statistics, and the relevant group's progress.

## 2.3 Target Audience

The initial audience is college students, software developers, and ambitious learners who want to:

- Prepare for coding interviews and placements.
- Complete DSA practice consistently.
- Follow educational playlists and courses.
- Build personal or open-source projects.
- Study for examinations.
- Establish sustainable productivity habits with friends.

Keep the underlying system extensible enough to support fitness, reading, learning, and other personal goals later.

---

# 3. Product Terminology

Use the following terminology consistently across the UI, API, and data model.

- **Circle:** A private social group containing friends who share goals or challenges.
- **Goal:** A desired outcome, such as solving 100 coding problems or completing a course.
- **Task:** An actionable unit of work contributing to a goal.
- **Schedule Block:** A time interval allocated to a task or commitment.
- **Focus Session:** An actual timer session associated with a task.
- **Challenge:** A time-bound shared activity with participation and completion rules.
- **Leaderboard:** A ranking of Circle members based on clearly defined performance metrics.
- **Integration:** An external service used to retrieve or verify progress.

A user can belong to multiple Circles. Each Circle has independent membership, goals, challenges, activity, and leaderboard settings.

A task may be personal or part of a shared challenge. Do not assume every personal task is visible to every Circle member.

---

# 4. User Accounts and Onboarding

Implement a complete authentication and onboarding experience.

## 4.1 Authentication

Support:

- Account registration and login.
- Secure password hashing if using password-based authentication.
- Logout and session management.
- Password recovery where supported by the chosen authentication provider.
- A protected application dashboard.
- Proper handling of unauthenticated access.

Use an established authentication solution rather than implementing cryptographic or session-management primitives from scratch.

## 4.2 Onboarding

After registration, guide the user through a lightweight onboarding process:

1. Choose a display name and profile avatar.
2. Set a default daily availability window.
3. Choose a timezone.
4. Optionally create a first Circle or join an existing one.
5. Create an initial goal and task.
6. Generate the first daily schedule.

Do not force users to configure every setting before accessing the application.

Provide useful defaults that users can modify later.

## 4.3 User Profile

Each profile should support:

- Display name and username.
- Avatar.
- Short bio, optionally.
- Current streak and historical consistency statistics.
- Connected integrations.
- Circle memberships.
- Privacy settings.
- Notification preferences.

Never expose private task details, account credentials, or personal schedule information to other users without appropriate permission.

---

# 5. Circles: Collaborative Social Spaces

## 5.1 Creating Circles

Users can create multiple Circles for different purposes.

Examples:

- DSA Preparation
- Semester Study Group
- Fitness Accountability
- Project Builders
- Thirty-Day Learning Challenge

Each Circle should have:

- Name and optional description.
- Owner and membership list.
- Invitation mechanism.
- Shared challenges.
- Shared activity feed.
- Leaderboard and scoring configuration.
- Membership and privacy controls.

A user may own one Circle and be a regular member of several others.

## 5.2 Invitations and Membership

Implement:

- Invitation links or invitation codes.
- Join and leave functionality.
- Owner or admin controls for removing members.
- Appropriate permissions for shared content.
- Protection against unauthorized access to private Circles.

An invitation must be validated by the backend. Do not rely on client-side checks alone.

## 5.3 Circle Dashboard

Each Circle should provide a central dashboard containing:

- Member overview.
- Today's shared progress.
- Active challenges.
- Leaderboard.
- Recent activity.
- Upcoming deadlines.
- Weekly completion summary.

The experience should feel social and collaborative without becoming a noisy public social network.

---

# 6. Goal and Task Management

## 6.1 Goals

Users can create goals with:

- Title and description.
- Goal category.
- Start date and optional deadline.
- Target quantity, when applicable.
- Daily, weekly, or custom recurrence.
- Priority.
- Personal or Circle visibility.
- Optional associated challenge.
- Progress calculation method.

Examples:

- Solve 100 LeetCode problems this month.
- Finish a 20-hour course within two weeks.
- Complete a project milestone by Sunday.
- Study operating systems for one hour every day.

## 6.2 Tasks

A task should contain, where applicable:

- Title and description.
- Associated goal.
- Estimated duration.
- Priority.
- Due date.
- Earliest start and latest finish.
- Splittable or indivisible scheduling rule.
- Minimum and maximum session duration.
- Required uninterrupted duration.
- Dependencies on other tasks.
- Recurrence rules.
- Completion criteria.
- Verification method.
- Optional external resource URL.
- Current status.
- Actual recorded work duration.

Task status should distinguish between:

- Not started.
- Scheduled.
- In progress.
- Completed.
- Partially completed.
- Skipped or cancelled.

Avoid treating a timer reaching zero as proof that the task itself has been completed.

## 6.3 Task Types

Support at least these scheduling categories:

**Indivisible task**

Must be allocated one continuous block of the required duration.

Example: solving a LeetCode Medium problem in a 50-minute session.

**Splittable task**

Can be distributed across multiple sessions while retaining progress.

Example: reading a textbook chapter or watching a long lecture.

**Sequential task**

Contains ordered subtasks or segments that must be completed in sequence.

Example: a YouTube playlist where video 2 cannot be scheduled before video 1.

**Fixed commitment**

Occupies an exact time interval and cannot be automatically moved.

Example: a college class, meeting, interview, or appointment.

**Flexible commitment**

Has a preferred time or window but can be moved by the scheduler.

Example: a workout that should happen between 5 PM and 8 PM.

Support combinations of these properties where meaningful rather than forcing every task into a single rigid category.

---

# 7. Core Differentiator: Adaptive Daily Scheduling Engine

This is the most important part of the product.

The scheduler must transform goals, task requirements, availability, fixed commitments, and deadlines into a practical daily timetable.

It must be a real scheduling engine, not a hardcoded sample calendar.

## 7.1 User Availability

Users can specify:

- The earliest time they want to work.
- The latest time they want to work.
- Days of the week on which they are available.
- Recurring unavailable intervals.
- Date-specific exceptions.
- Preferred focus-session lengths.
- Preferred break durations.
- Optional lunch and rest periods.
- Preferred task categories for particular periods.

For example, a user might normally work between 10 AM and 10 PM.

On a particular Tuesday, they have a class from 12 PM to 3 PM. The scheduler must exclude that interval from available work time.

Another day may have an appointment from 4 PM to 5 PM. The user should be able to add it without changing their default weekly availability.

All time calculations must respect the user's timezone, including daylight-saving transitions where applicable.

## 7.2 Availability Calculation

Calculate usable time by subtracting fixed commitments and unavailable intervals from the user's allowed working window.

Conceptually:

Available intervals = Working window − Fixed commitments − Unavailable intervals.

Merge overlapping unavailable intervals safely, validate time ranges, and handle events that cross midnight when supported.

Do not allocate tasks outside the user's allowed window unless the user explicitly changes that window.

## 7.3 Task Scheduling Constraints

The scheduler must understand the difference between hard constraints and preferences.

Hard constraints include:

- Fixed commitments cannot be overwritten.
- Indivisible tasks require a sufficiently long continuous interval.
- Tasks cannot overlap.
- Task dependencies must be respected.
- A sequential playlist must retain its order.
- Tasks must obey their permitted scheduling windows.
- Completed work must not be silently discarded.

Soft constraints include:

- Preferred task order.
- Priority.
- Deadlines.
- Preferred time of day.
- Desired breaks.
- Distribution of work across days.
- Avoiding excessive context switching.
- Balancing daily workload.

When constraints cannot all be satisfied, report the conflict and offer alternatives rather than silently producing an invalid schedule.

## 7.4 Example Scheduling Rules

Consider the following tasks:

- LeetCode Medium: 50 minutes, indivisible.
- YouTube lecture: 25-minute sessions, divisible.
- Project work: 90 minutes, divisible into 45-minute sessions.
- College class: 12 PM–3 PM, fixed commitment.
- Work availability: 10 AM–10 PM.

A valid schedule might allocate:

- 10:00–10:50: LeetCode Medium.
- 10:50–11:00: Break.
- 11:00–11:25: Lecture segment.
- 11:25–11:35: Break.
- 11:35–12:00: Another eligible 25-minute task or a shorter lecture segment if permitted.
- 12:00–3:00: College class.
- After 3:00: Remaining tasks, meals, breaks, and other commitments as appropriate.

This is illustrative, not a fixed schedule template. The actual output must be generated from the user's inputs.

If a task requires 50 uninterrupted minutes and only 35 minutes remain before a fixed commitment, do not schedule it in that interval.

If no valid slot exists, leave the task unscheduled and explain why.

## 7.5 Divisible Tasks

For divisible tasks:

- Allow configurable session lengths.
- Respect minimum and maximum session duration.
- Preserve cumulative progress.
- Allow sessions to be distributed across multiple days.
- Respect deadlines and task dependencies.
- Avoid creating unnecessarily small fragments.
- Allow the user to configure whether partial progress counts toward completion.

For example, a 90-minute project task could become two 45-minute blocks.

However, splitting must respect the task's rules. Do not automatically divide every task into identical Pomodoro intervals.

## 7.6 Indivisible Tasks

For indivisible tasks:

- Reserve the entire required duration continuously.
- Do not insert another task into the middle.
- Do not split the task around a break unless the task explicitly permits that behavior.
- If there is no suitable interval, suggest an alternative slot.
- Allow the user to modify the task constraint intentionally.

For a 50-minute coding task, a 25-minute block is insufficient even if the next interval is otherwise available.

## 7.7 Breaks and Recovery Time

Support configurable breaks between focus sessions.

Users should be able to choose presets such as:

- 25-minute focus / 5-minute break.
- 50-minute focus / 10-minute break.
- Custom durations.

Breaks should be treated as scheduling intervals so tasks do not overlap with them.

Allow the user to skip a break or extend it manually, while updating the remaining schedule appropriately.

## 7.8 Scheduling Algorithm

Use a deterministic scheduling algorithm for core placement logic.

A suitable initial approach is:

1. Generate the available intervals.
2. Load eligible tasks and their constraints.
3. Resolve dependencies and task ordering.
4. Prioritize tasks based on urgency, deadline, priority, and configured preferences.
5. Find suitable continuous intervals for indivisible tasks.
6. Allocate divisible tasks into valid segments.
7. Insert configured breaks.
8. Validate that no hard constraints have been violated.
9. Return the schedule, unscheduled tasks, and explanations for conflicts.

A greedy scheduler with a well-defined priority strategy is acceptable for the MVP.

Design the scheduling interface so a more advanced optimization algorithm, such as constraint programming with Google OR-Tools, can be introduced later.

Do not use an LLM as the authoritative scheduling algorithm. AI can interpret natural-language requests, propose task durations, or explain results, but final placement must pass deterministic constraint validation.

## 7.9 Regeneration and Schedule Changes

Users must be able to:

- Generate a schedule automatically.
- Drag or manually move blocks.
- Lock specific blocks.
- Mark blocks as completed.
- Skip tasks.
- Reschedule unfinished work.
- Regenerate the remaining schedule.
- Add new tasks during the day.

When regenerating:

- Preserve completed sessions.
- Preserve fixed commitments.
- Respect locked blocks.
- Preserve accumulated task progress.
- Avoid changing already completed historical records.
- Report tasks that no longer fit.
- Never silently delete user data.

If a focus session runs over its scheduled time, offer the user a choice to continue, finish, or reschedule affected tasks.

---

# 8. Daily Calendar and Timeline Interface

The schedule should be a primary screen, not a secondary feature hidden inside task management.

Build a responsive daily timeline with:

- Time labels.
- Focus blocks.
- Fixed commitments.
- Breaks.
- Unscheduled tasks.
- Completion indicators.
- Current-time indicator.
- Task duration.
- Task priority.
- Progress information.
- Drag-and-drop adjustments where practical.

Users should be able to switch between day and week views.

Provide a quick-add interaction for creating tasks directly from the schedule.

Use distinct but restrained visual treatments for task types. Avoid excessive colors, gradients, decorative cards, and unnecessary animations.

When a block is selected, show its details and allow the user to edit it.

On mobile, use a touch-friendly agenda or timeline layout rather than compressing the desktop calendar.

---

# 9. Pomodoro and Focus Sessions

Implement an integrated timer connected to scheduled tasks.

## 9.1 Timer Features

Support:

- Start.
- Pause.
- Resume.
- Complete.
- Stop early.
- Skip break.
- Extend session.
- Configurable focus and break durations.
- Session history.
- Task association.
- Optional completion notes.

A timer should know which task and schedule block it belongs to.

## 9.2 Accurate Timing

Do not implement a timer that depends solely on repeatedly decrementing a frontend counter.

Persist the session's start time, relevant pause intervals, and completion information. Calculate elapsed time from timestamps so browser refreshes and temporary disconnections do not corrupt the result.

Support appropriate session recovery when the user returns to the application.

Define whether background time counts as active focus time. Make the behavior explicit to the user and configurable where appropriate.

## 9.3 Focus Analytics

Record separately:

- Planned duration.
- Actual elapsed session duration.
- Active focus duration.
- Paused duration.
- Task completion outcome.

A completed timer must not automatically mark an external activity as verified.

For example, a 50-minute LeetCode focus session and an accepted LeetCode submission are different events.

## 9.4 Social Focus Presence

As a later feature, allow Circle members to optionally share that they are currently focusing.

Support privacy controls and do not expose a user's entire personal schedule by default.

---

# 10. Playlist Import and Automatic Multi-Day Planning

This is a high-value workflow for learners.

## 10.1 Playlist Import

Allow users to submit a supported YouTube playlist URL.

Where supported by the chosen API and access permissions, retrieve:

- Playlist title.
- Video titles.
- Video durations.
- Video order.
- Video URLs.
- Available completion or progress metadata.

Validate the URL, handle inaccessible or private playlists, and display useful error messages.

Never assume every YouTube playlist can be retrieved successfully. If metadata access fails, offer manual lesson creation or another fallback.

## 10.2 Playlist Scheduling Configuration

After importing a playlist, let the user specify:

- Target completion date.
- Available study days.
- Daily time budget.
- Preferred focus-session duration.
- Whether a video should remain continuous.
- Whether videos may be split across sessions.
- Whether the playlist must be completed in order.
- Optional revision or practice sessions.

## 10.3 Automatic Distribution

The scheduler should:

1. Calculate the total remaining duration.
2. Retrieve or confirm the user's available intervals across the selected days.
3. Respect task dependencies and video ordering.
4. Distribute the playlist across suitable blocks.
5. Account for breaks.
6. Respect existing tasks and commitments.
7. Detect when the deadline is infeasible.
8. Present a proposed schedule before applying it.

Do not distribute videos by simply dividing the number of videos by the number of days. Use durations and actual available time.

For example, a playlist containing twelve videos totaling six hours should be distributed according to the available study intervals, not necessarily three videos per day.

## 10.4 Video Progress

Track:

- Not started.
- Partially watched.
- Completed.
- Last known playback position when available.

Distinguish a completed focus session from a completed video.

If a video is split into two sessions, resume from the saved timestamp when technically possible.

Never claim to have verified playback or video completion if the platform has no reliable way to establish it.

---

# 11. Integrations and Automatic Verification

The platform should support external activity verification through modular integration adapters.

## 11.1 LeetCode

Allow users to connect or configure their LeetCode username.

Where a reliable and permitted data source is available, retrieve supported information such as:

- Accepted submissions.
- Problem identifiers.
- Problem difficulty.
- Submission timestamps.
- Daily problem-solving activity.

Allow a task such as "Solve two LeetCode Medium problems today" to define its completion criteria.

Only count qualifying activities according to those criteria.

Do not count duplicate submissions or unrelated activity as new completed problems.

LeetCode does not provide a straightforward official public API covering all the desired information. Treat unofficial data sources as potentially unreliable. Make the integration replaceable, handle failures, and never make the application dependent on a single unofficial endpoint.

If automatic verification is unavailable, provide manual completion with a clear status indicating that the result was not independently verified.

## 11.2 GitHub

Where supported by GitHub APIs and user permissions, integrate:

- Repository selection.
- Commit and pull request activity.
- Contribution timestamps.
- Repository milestones.
- Optional issue completion.

Allow users to define meaningful criteria, such as opening a pull request or closing a specific issue.

Do not treat every commit as proof of productive work.

Use OAuth or an appropriate authorization flow. Store access tokens securely and request the minimum necessary permissions.

## 11.3 Verification Status

Every task should clearly indicate its verification method:

- Verified by integration.
- Manually marked complete.
- Evidence submitted, if supported.
- Pending verification.
- Verification unavailable.
- Verification failed.

Never silently change the verification status when an integration fails.

## 11.4 Integration Architecture

Create a common adapter interface so integrations can be added independently.

Each integration should support, as appropriate:

- Connection and authorization.
- Data retrieval.
- Data normalization.
- Rate-limit handling.
- Error handling.
- Retry behavior.
- Last successful synchronization.
- Disconnect and token revocation.

Keep provider-specific API logic out of the core task and scheduling services.

---

# 12. Leaderboards and Consistency Metrics

The leaderboard should reward sustained effort rather than encourage users to inflate trivial tasks.

## 12.1 Metrics

Support:

- Daily completion rate.
- Weekly completion rate.
- Monthly completion rate.
- Active days.
- Current streak.
- Longest streak.
- Tasks completed.
- Verified achievements.
- Planned versus completed work.
- Improvement over the previous period.

## 12.2 Configurable Ranking

Allow Circle owners to select a ranking mode:

- Consistency: proportion of scheduled commitments completed.
- Volume: number of eligible completed tasks.
- Challenge progress: progress toward shared milestones.
- Balanced: a transparent combination of selected metrics.

Avoid arbitrary point inflation.

Do not compare raw task counts across users without acknowledging differences in workload and task definitions.

For consistency metrics, use a clearly documented denominator. Days with no planned activity should not automatically count as failures.

Users should be able to see why their score changed.

## 12.3 Streaks

Implement daily and weekly streaks based on configurable eligibility rules.

Handle timezones and day boundaries correctly.

Allow reasonable flexibility for rest days and planned breaks. Do not create punitive streak mechanics that require users to be active every day.

---

# 13. Challenges and Shared Goals

Users should be able to create time-bound group challenges.

Examples:

- Solve 50 problems in 30 days.
- Finish a course within two weeks.
- Complete a project milestone this weekend.
- Study for an exam for five consecutive days.

Each challenge should have:

- Title and description.
- Start and end dates.
- Participants.
- Completion criteria.
- Optional shared task templates.
- Individual or collective targets.
- Progress tracking.
- Challenge leaderboard.
- Completion summary.

Support both individual competition and collaborative targets.

For example, a group might collectively aim to solve 200 problems, while each member also tracks their own progress.

Challenge participation must not expose unrelated personal tasks.

---

# 14. Activity Feed and Social Interaction

Build a lightweight activity feed for Circle members.

Possible activities include:

- Completing a verified task.
- Completing a challenge milestone.
- Achieving a streak milestone.
- Finishing a playlist.
- Completing a focus session, when the user chooses to share it.
- Publishing a weekly progress recap.

Support basic reactions and short comments if practical for the MVP.

Allow members to control what activities are shared.

Avoid exposing sensitive information such as private task descriptions, exact personal schedules, or external account details without consent.

Do not turn the application into a general-purpose social media feed.

---

# 15. Weekly Reports and Personal Analytics

Provide a personal analytics dashboard with:

- Planned work versus completed work.
- Focus time.
- Task completion rate.
- Daily and weekly trends.
- Goal progress.
- Current and longest streaks.
- Distribution of time across categories.
- Overdue or repeatedly rescheduled tasks.
- Weekly comparison.

A weekly recap should identify actionable patterns.

For example:

"You completed 18 of 21 planned tasks this week. Your completion rate was lower on days when your schedule contained more tasks than your available time could accommodate."

Only produce insights supported by actual recorded data.

Do not claim that an activity was productive merely because the timer was running.

An AI-generated accountability summary can be added later, but it must use the user's actual records and avoid fabricated explanations.

---

# 16. Notifications and Reminders

Implement configurable notifications for:

- Upcoming scheduled blocks.
- Starting a challenge.
- A task approaching its deadline.
- A focus session ending.
- A friend completing a milestone.
- An invitation to a Circle.
- A weekly recap.

Avoid excessive notifications.

Allow users to disable or customize notification categories.

Use timezone-aware scheduling and prevent duplicate reminders.

Start with in-app notifications. Add browser push or email notifications only when the infrastructure and permissions are configured correctly.

---

# 17. Application Pages and Navigation

Create the following main areas.

## 17.1 Home / Today

The default landing page after login.

Show:

- Today's date.
- Daily completion summary.
- Current or next task.
- Today's schedule.
- Remaining tasks.
- Quick task creation.
- Start or resume focus session.
- Schedule generation and rescheduling actions.

The most important information should be visible immediately without excessive scrolling.

## 17.2 Planner

Show the daily and weekly calendar.

Allow users to generate schedules, manage availability, create fixed commitments, move blocks, and inspect unscheduled tasks.

## 17.3 Goals and Tasks

Provide goal creation, task management, recurrence configuration, completion tracking, and filtering.

## 17.4 Circles

List the user's Circles and provide access to each Circle's dashboard, members, challenges, feed, and leaderboard.

## 17.5 Challenges

Display active, upcoming, and completed challenges.

## 17.6 Focus

Provide the timer, current task, session history, and focus statistics.

## 17.7 Analytics

Show personal productivity statistics, historical trends, and weekly recaps.

## 17.8 Integrations

Allow users to connect, configure, synchronize, and disconnect external accounts.

## 17.9 Settings

Include account, timezone, availability, scheduling preferences, notifications, privacy, and security settings.

Use a coherent navigation system. On desktop, a compact sidebar is appropriate. On mobile, provide a touch-friendly navigation pattern.

---

# 18. Design System and User Experience

Create a premium, modern, minimalist productivity application.

The interface should feel focused, calm, and intentional rather than gamified to the point of distraction.

## 18.1 Design Principles

- Clear visual hierarchy.
- Strong typography.
- Consistent spacing.
- Restrained color palette.
- Functional use of color for task categories and status.
- Accessible contrast.
- Responsive layouts.
- Fast navigation.
- Clear loading, empty, success, and error states.
- Subtle, purposeful animation.
- Consistent component behavior.

Use a dark theme as the primary design direction, with a well-implemented light theme if practical.

Avoid generic AI-generated landing-page aesthetics, excessive gradients, oversized headings in application screens, unnecessary glassmorphism, and decorative UI that reduces information density.

## 18.2 Interaction Quality

Implement real interactions for:

- Creating, editing, and deleting tasks.
- Generating and regenerating schedules.
- Starting and stopping timers.
- Moving schedule blocks.
- Joining and leaving Circles.
- Inviting friends.
- Changing leaderboard filters.
- Configuring availability.
- Completing tasks.
- Importing playlists.
- Connecting integrations.

Every visible button must perform its intended action or clearly communicate why the action is unavailable.

Do not use fake buttons, dead links, hardcoded success messages, or controls that merely look interactive.

## 18.3 Accessibility

Support keyboard navigation, accessible labels, visible focus states, sensible semantic markup, and sufficient contrast.

Do not rely on color alone to convey task status.

Respect reduced-motion preferences.

---

# 19. Recommended Technical Architecture

First inspect the existing repository and preserve a suitable existing stack. If starting from scratch, use a modern TypeScript-based web stack.

Suggested defaults:

### Frontend
- React.
- TypeScript.
- Vite or an appropriate full-stack framework.
- Tailwind CSS.
- A consistent accessible component library, such as shadcn/ui.
- A suitable calendar or timeline implementation.
- A lightweight state-management solution where needed.

### Backend
- Node.js with a structured API layer, such as Express or an equivalent framework.
- TypeScript for shared domain types where appropriate.
- Server-side validation for every state-changing request.
- Modular services for scheduling, tasks, memberships, integrations, and analytics.

### Database
- PostgreSQL.
- Prisma, Drizzle, or another suitable ORM.
- Proper foreign keys, indexes, transactions, and migration management.

### Authentication
- A mature authentication provider or a well-established authentication library compatible with the chosen stack.

### Background Processing
- A background job system for integration synchronization, notifications, and recurring tasks where required.
- A scheduler or queue backed by an appropriate persistent store.

Do not introduce Redis or additional infrastructure without a concrete need.

### Deployment
- Environment-based configuration.
- Production build and database migrations.
- A deployment-ready configuration.
- A documented approach for running the application locally.

These are defaults, not mandatory choices if the existing repository already has a suitable architecture.

---

# 20. Data Model

Design a normalized relational schema. At minimum, account for the following entities.

## User
- ID.
- Username.
- Display name.
- Email or authentication-provider identifier.
- Avatar.
- Timezone.
- Preferences.
- Created timestamp.

## Circle
- ID.
- Name.
- Description.
- Owner ID.
- Visibility.
- Settings.
- Created timestamp.

## CircleMembership
- ID.
- Circle ID.
- User ID.
- Role.
- Joined timestamp.
- Membership status.

Enforce unique membership per Circle and user.

## CircleInvitation
- ID.
- Circle ID.
- Inviter ID.
- Invitation token or securely generated code.
- Expiration.
- Usage status.

## Goal
- ID.
- Owner ID.
- Optional Circle ID.
- Title.
- Description.
- Category.
- Target.
- Start date.
- Deadline.
- Recurrence configuration.
- Visibility.
- Status.

## Task
- ID.
- Owner ID.
- Optional goal ID.
- Optional Circle or challenge association.
- Title.
- Description.
- Estimated duration.
- Priority.
- Scheduling constraints.
- Splittable flag.
- Minimum and maximum session duration.
- Completion criteria.
- Verification configuration.
- Recurrence configuration.
- Status.

## ScheduleBlock
- ID.
- User ID.
- Task ID, when applicable.
- Block type.
- Start timestamp.
- End timestamp.
- Status.
- Locked flag.
- Source, such as automatic or manual scheduling.
- Associated schedule version.

## AvailabilityRule
- ID.
- User ID.
- Weekday or recurrence rule.
- Start and end times.
- Timezone or reference to the user's timezone.
- Active status.

## CalendarCommitment
- ID.
- User ID.
- Title.
- Start and end timestamps.
- Recurrence configuration.
- Fixed or flexible status.

## FocusSession
- ID.
- User ID.
- Task ID.
- Schedule block ID, when applicable.
- Start timestamp.
- End timestamp.
- Accumulated active duration.
- Paused duration.
- Session status.

Store pause events or equivalent records where necessary for accurate elapsed-time calculations.

## TaskCompletion
- ID.
- Task ID.
- User ID.
- Completion timestamp.
- Completion method.
- Verification status.
- External evidence reference, if applicable.

## IntegrationConnection
- ID.
- User ID.
- Provider.
- External account identifier.
- Encrypted credentials or secure token reference.
- Last synchronization timestamp.
- Connection status.

Never store plaintext OAuth tokens or passwords.

## Challenge
- ID.
- Circle ID.
- Creator ID.
- Title.
- Description.
- Start date.
- End date.
- Completion rules.
- Scoring configuration.
- Status.

## ChallengeParticipant
- ID.
- Challenge ID.
- User ID.
- Participation status.
- Progress.

## Activity
- ID.
- Actor ID.
- Circle ID, when applicable.
- Activity type.
- Associated resource.
- Visibility.
- Timestamp.

## Notification
- ID.
- User ID.
- Notification type.
- Payload.
- Read status.
- Created timestamp.

Use appropriate join tables for many-to-many relationships and audit records where necessary.

You may add, remove, or reshape entities to fit the actual implementation. Avoid creating an unnecessarily complicated schema before it is needed.

---

# 21. Backend Services and API Design

Organize backend functionality around clear domain boundaries.

At minimum, provide services for:

- Authentication and profiles.
- Goals and tasks.
- Availability and calendar commitments.
- Schedule generation and validation.
- Schedule modifications and regeneration.
- Focus sessions.
- Task completion and verification.
- Circles and membership.
- Invitations.
- Challenges and participation.
- Leaderboards and analytics.
- Integrations and synchronization.
- Notifications.

Use consistent API conventions and structured validation.

Potential endpoint groups include:

- `/api/auth`
- `/api/users`
- `/api/goals`
- `/api/tasks`
- `/api/availability`
- `/api/commitments`
- `/api/schedules`
- `/api/focus-sessions`
- `/api/circles`
- `/api/invitations`
- `/api/challenges`
- `/api/leaderboards`
- `/api/integrations`
- `/api/analytics`
- `/api/notifications`

These paths are examples, not a requirement to create an endpoint for every operation.

Implement proper pagination for activity feeds and other growing collections.

Use database transactions for operations that must succeed or fail together, especially schedule updates, membership changes, and completion records.

---

# 22. Security, Privacy, and Reliability

Treat user data and external integrations as sensitive.

Requirements:

- Enforce authorization on the server.
- Prevent users from accessing another user's private tasks or schedule.
- Validate all request payloads.
- Protect against common web vulnerabilities.
- Rate-limit sensitive endpoints.
- Use secure session or token handling.
- Encrypt sensitive integration credentials at rest.
- Keep secrets out of source control and client-side bundles.
- Verify webhook signatures where webhooks are used.
- Handle expired credentials and revoked access.
- Support account and integration disconnection.
- Avoid logging secrets or unnecessary personal information.
- Apply appropriate database indexes and constraints.
- Handle concurrent task updates safely.
- Prevent duplicate task completion events and duplicate scheduled jobs.

For integrations, treat external data as untrusted input and isolate provider failures from core application functionality.

Do not expose private calendar details merely because a user belongs to the same Circle as another person.

---

# 23. Testing Requirements

Create meaningful automated tests rather than relying solely on manual browser testing.

## Scheduling Tests

Test cases must include:

- Normal task placement.
- Overlapping fixed commitments.
- Indivisible tasks with insufficient time.
- Divisible tasks spanning multiple intervals.
- Break insertion.
- Task dependencies.
- Conflicting deadlines.
- No available time.
- Date-specific exceptions.
- Overnight intervals if supported.
- Timezone and daylight-saving boundaries.
- Regeneration while preserving completed blocks.
- Locked blocks.
- Tasks that no longer fit after a change.
- Concurrent modifications.
- Invalid or impossible schedules.

Verify that no generated schedule contains overlapping blocks or violates hard constraints.

## Task and Focus Tests

Test:

- Task creation and updates.
- Completion and reopening rules.
- Timer persistence across refreshes.
- Paused session accounting.
- Duplicate completion prevention.
- Focus-session recovery.
- Separation of session completion and external verification.

## Social Tests

Test:

- Circle creation.
- Invitations and membership.
- Authorization boundaries.
- Leaving a Circle.
- Challenge participation.
- Leaderboard calculations.
- Private versus shared content.

## Integration Tests

Test provider errors, unavailable endpoints, invalid credentials, duplicate external events, rate limits, and retry behavior.

Do not depend on live third-party APIs for every automated test. Use fixtures and mocked provider responses for deterministic testing.

---

# 24. Performance and Maintainability

The application should remain responsive as users create more tasks, schedule blocks, and activity records.

- Fetch only the data needed for the current screen.
- Avoid unnecessary full-page reloads.
- Optimize database queries and indexes.
- Avoid excessive client-side polling.
- Use appropriate caching for external data.
- Make synchronization jobs idempotent.
- Keep business logic separate from UI components.
- Use shared validation schemas and domain types where practical.
- Handle loading and error states consistently.
- Document important scheduling decisions and constraints.

Do not overengineer the first release with microservices or a complex distributed architecture.

A modular monolith is a reasonable starting point.

---

# 25. MVP Scope and Development Priorities

Implement the product in the following order.

## Phase 1: Functional Foundation

Build:

1. Authentication and profiles.
2. Task and goal creation.
3. Availability configuration.
4. Fixed commitments.
5. Daily schedule generation.
6. Divisible and indivisible task rules.
7. Daily timeline.
8. Pomodoro timer.
9. Completion tracking.
10. Persistent storage.

The scheduling engine must be functional and tested before adding complex social features.

## Phase 2: Social Accountability

Build:

1. Circle creation.
2. Invitations and membership.
3. Circle dashboards.
4. Shared challenges.
5. Leaderboards.
6. Activity feed.
7. Personal and group statistics.

Ensure privacy and authorization work correctly.

## Phase 3: Integrations

Build:

1. LeetCode integration where feasible.
2. GitHub integration.
3. Verification status and history.
4. Retry handling and synchronization.
5. Manual completion fallbacks.

Prioritize one reliable integration over several unreliable integrations.

## Phase 4: Playlist Planning

Build:

1. Playlist URL input.
2. Metadata retrieval.
3. Video duration and ordering.
4. Multi-day schedule generation.
5. Partial progress tracking.
6. Resume support.
7. Deadline feasibility checks.

## Phase 5: Retention and Polish

Build:

1. Weekly recaps.
2. Configurable notifications.
3. Schedule recovery and rescheduling.
4. Advanced analytics.
5. Optional shared focus presence.
6. AI-assisted planning explanations, if justified.

Do not implement every future feature before validating the core experience.

---

# 26. Acceptance Criteria

The product is not complete until the following workflows function end to end.

### Workflow A: A User Plans a Day

1. The user signs in.
2. They set their working hours.
3. They add a fixed class or appointment.
4. They create multiple tasks with different scheduling constraints.
5. They generate a schedule.
6. The scheduler respects availability and task rules.
7. The user can edit or regenerate the schedule.
8. Changes persist after refreshing the page.

### Workflow B: A User Completes Work

1. The user opens a scheduled task.
2. They start a focus session.
3. They pause or resume it.
4. The timer accurately tracks elapsed time.
5. The user finishes the session.
6. The user records the task outcome.
7. The application updates progress and analytics.
8. The task is not falsely marked as externally verified.

### Workflow C: Friends Collaborate

1. A user creates a Circle.
2. They invite friends.
3. Friends join.
4. Members create or join a shared challenge.
5. Progress is recorded.
6. The Circle leaderboard updates.
7. Members can view permitted shared activity.
8. Private information remains private.

### Workflow D: A User Imports a Playlist

1. The user submits a supported playlist URL.
2. The application retrieves available metadata.
3. The user selects a target deadline and session preferences.
4. The scheduler distributes the videos across available time.
5. The schedule respects fixed commitments and existing tasks.
6. The user can adjust the proposed schedule.
7. Video progress persists across sessions.

### Workflow E: A User Misses a Task

1. A scheduled block is missed or interrupted.
2. The task is not automatically marked complete.
3. The application identifies the remaining work.
4. The user can regenerate the remaining schedule.
5. Completed blocks, fixed commitments, and locked blocks remain intact.
6. Any task that no longer fits is clearly identified.

---

# 27. Development and Delivery Instructions

Work directly in the available repository.

Follow these rules:

1. Inspect before modifying.
2. Keep the application runnable throughout development.
3. Implement real database persistence.
4. Do not substitute mock data for essential production workflows.
5. Use seed data only for development and clearly label it.
6. Keep credentials and environment-specific settings in environment variables.
7. Provide database migrations.
8. Add useful automated tests.
9. Run the available lint, type-check, test, and build commands.
10. Fix issues caused by your changes.
11. Document local setup and required environment variables.
12. Document integration limitations and any required API credentials.
13. Do not claim an integration works until it has been tested or its limitations have been explicitly documented.
14. Do not leave core workflows as TODOs or nonfunctional placeholders.
15. If an external service requires credentials or approval that are unavailable, implement the integration boundary and a clear setup path without pretending the connection is live.

When requirements are ambiguous, make a sensible, documented decision and continue. Ask for clarification only when a missing decision genuinely blocks implementation.

Prioritize correctness of the scheduling engine, data integrity, and functional end-to-end workflows over the number of features.

---

# 28. Final Product Standard

The finished application should feel like a cohesive productivity service rather than a collection of disconnected tools.

A new user should be able to:

- Create an account.
- Configure their available hours.
- Add tasks and fixed commitments.
- Generate a realistic daily schedule.
- Start focus sessions directly from scheduled tasks.
- Track actual progress.
- Create a Circle and invite friends.
- Participate in challenges.
- Compare meaningful consistency statistics.
- Import a supported playlist and distribute it across multiple days.

The central experience should be effortless:

**Define your goals → Generate your schedule → Focus on the next task → Record real progress → Stay accountable with friends.**

Build a polished, reliable, privacy-conscious product around this loop.

Start by inspecting the repository and preparing a concise implementation plan. Then proceed to implement the application, validate it, and deliver a working result with clear setup instructions.
