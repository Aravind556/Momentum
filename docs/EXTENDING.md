# Extending Cadence

Cadence is built so new features are **added**, not threaded through existing code. Every recipe below is "write one implementation, register it in one place". Each section says which files to touch, what to implement, and how to test it.

General rules:
- **Server features live in `server/src/modules/<name>/`**, with `schema.ts`, service files, `routes.ts` and `index.ts`. `index.ts` exports an `AppModule` (routes, jobs, `register` hook); add it to `modules/index.ts`. New tables also get one export line in `core/db/schema.ts`. Then run `npm run db:generate`.
- **React to other features through events** (`core/events.ts`): `s.events.on("task.completed", …)` inside your module's `register`. If you need a new event, add it to `DomainEvents` and emit it *after* your transaction commits.
- **Pure logic goes in `shared/`** (no I/O) with unit tests. Server and web both import it.
- **Use `s.now()`, never `Date.now()`,** in anything the logic compares. Tests move the clock.
- **Tests** live in `server/test/*.test.ts`. `setupTestEnv({ fetch })` gives you a fresh in-memory Postgres, real auth, all modules, a fake `fetch`, and a controllable `t.clock.now`.

---

## Add a coding platform (e.g. AtCoder)

1. **Recognise its links** in `shared/src/platforms.ts`: add `"atcoder"` to `CATEGORIES` and `CATEGORY_META`, and a `PlatformDef` with `parse(url)` → `{ key, titleGuess }` and `problemUrl(key)`. Add cases to `platforms.test.ts`.
2. **Write the adapter** `server/src/modules/platforms/atcoder.ts`, implementing `IntegrationAdapter` (`types.ts`):
   - `provider`, `label`, `description`, `handlePattern`, `spacingMs` (the platform's rate limit) and `limitations`;
   - `verifyAccount(conn)`: confirm the public handle exists and return its canonical form;
   - `fetchEvents(conn, since, ctx)`: return accepted submissions as `{ externalId, type: "accepted_submission", occurredAt, data: SubmissionData }`. `SubmissionData` is `{ problemKey, title, url, difficulty, tags }`, the shared shape everything else relies on.
   - `problemInfo(key)` (optional): title, difficulty and tags for pasted links;
   - `evaluate(criteria, events)`: decide whether a verification config is satisfied.

   Always fetch through the `fetchFn` you're given: it is rate-limited per platform, and user clicks go ahead of background work.
3. **Verification modes**: add the provider to `verificationSchema` in `shared/src/domain.ts` (usually `problem` + `count`), and map it in `verificationFor` (`planning/daily.ts`) and in the swap code (`planning/today.ts`).
4. **Register it**: add the factory to `ADAPTERS` in `modules/platforms/registry.ts`. Platform names are plain text in the database, so **no migration** is needed.
5. **UI**: add a `--platform-atcoder` colour token in `web/src/index.css` and a dot in `features/roadmaps/CategoryDot.tsx`. Settings → Coding platforms lists it automatically.
6. **Test**: copy the Codeforces test in `server/test/platforms.test.ts` with a fake API.

## Add a source of daily work (e.g. contest reminders)

Anything that should appear on Today, be scheduled, tracked and verified is a `DailySource` (`modules/planning/sources.ts`):

```ts
export const contestSource: DailySource = {
  key: "contest",          // stored in tasks.source
  fixed: true,             // optional: can't be swapped away
  deferrable: false,       // optional: may move to a later day if it doesn't fit
  async desired(ctx) {     // everything you want on ctx.day, including what's already planned
    return upcomingContests(ctx).map((c) => ({ sourceId: c.id, title: c.name, kind: "due", ... }));
  },
  async onComplete(s, task, verified) { /* react when the learner finishes it */ },
  async swapOptions(ctx, task) { return []; },        // optional
  async forecast(ctx, days) { return []; },           // optional: for "Coming up"
};
```

Register it in your module's `register`: `registerDailySource(contestSource)`. The day builder does the rest: diffing, the load guard, scheduling and roll-over. Rules:
- **Don't return items that were finished, skipped or cancelled today** (`ctx.todays` holds this source's tasks for the day).
- **Count finished and pinned items toward any daily quota**, so completing work never pulls in more.
- **Never write inside `desired`**: push side effects to `ctx.after`, which runs after the plan is committed.

If your data changes outside the user's own actions, emit `plan.stale` for the affected users and their Today updates.

## Use a different repetition algorithm (e.g. FSRS)

Implement `RepetitionAlgorithm` (`modules/repetition/algorithm.ts`):

```ts
export const fsrs: RepetitionAlgorithm = {
  id: "fsrs",
  initial: () => ({ ef: 0, reps: 0, baseInterval: 1, state: { stability: …, difficulty: … } }),
  review: (card, rating) => …,                  // keep extra state in card.state
  dueDate: (card, lastReviewedOn, multiplier) => …,
};
```

Add it to `ALGORITHMS`. Cards store their algorithm in `reviews.algorithm`, so both can coexist. To use it for new cards, change `startCard` in `repetition/service.ts`, or make it a per-follow setting. The forecast in `roadmaps/daily-source.ts` uses SM-2 directly; route it through the algorithm if you switch.

## Add a notification channel (e.g. Telegram)

Implement `Notifier` (`modules/notify/channels.ts`):

```ts
registerNotifier({
  id: "telegram",
  async send(s, to, msg) { await sendTelegram(chatIdFor(to.userId), `${msg.subject}\n${msg.lines.join("\n")}`); },
});
```

`deliver()` claims a row in `email_log` per (user, key, channel) **before** sending, so every reminder reaches each channel at most once, however often the job runs. Add a preference (in `preferencesSchema`, `shared/src/domain.ts`) if users should be able to turn it off.

## Change how points work

The rules are `shared/src/points.ts` (`basePoints`, `awardPoints`) plus each group's `points` config. Every point-earning event is a row in `group_points` (`modules/groups/points.ts`), and the leaderboard sums them. To reward something new (say, revisions done on time), record a row from an event handler in `modules/groups/index.ts` with a new `sourceType`.

## Replace the scheduler

`shared/src/scheduler/types.ts` defines `Scheduler`. `generateSchedule(input, scheduler)` accepts any implementation, and `validateSchedule` checks the result's hard constraints, so a constraint solver can be dropped in and validated the same way.
