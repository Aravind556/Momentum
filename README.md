# Momentum

**Make every day count.**

A study planner for CS students that plans your day for you and keeps your study group on track.

## Features

**Daily plan (Today)**
- Built automatically every day from your roadmaps, revisions, group tasks and your own tasks.
- Placed into your free time around classes, blocked time and breaks, at your preferred time of day.
- A load guard keeps days realistic: new items beyond your study limit or your free time move to a later day.
- Tick to complete. LeetCode and Codeforces items only count after a matching **accepted submission** is found.
- **Swap** an item for another of the same category, **skip** it for today, or start a **focus session**.
- Re-plans instantly when anything changes (pace, follows, tasks, classes, availability, group tasks), with a short "plan updated" note.
- **Coming up:** the next 7 days, estimated live from your current settings.

**Roadmaps (learning)**
- Paste problem links (LeetCode, Codeforces, CodeChef), any other links, topics, `# Section` headings or a YouTube playlist. Titles and difficulty are filled in automatically.
- A pace preset sets new items per day and revision intensity: **Frequent / Decent / Rare**. Both can be changed separately at any time, and revisions can be turned off.
- **Spaced repetition (SM-2):** finished items come back for revision at growing intervals. Rate each revision Again / Hard / Good / Easy.
- Problems you've already solved are recognised and marked done.
- Projected finish date, per-item progress, reorder, skip and pause.

**Planner**
- **Week:** a calendar with study blocks, classes and tentative blocks for future days. Drag a block to move and lock it.
- **Tasks:** your own work (assignments, projects) with deadlines, durations, repeats, optional goals and optional problem verification. No revisions.
- **Classes:** fixed or flexible commitments the plan works around.
- **Availability:** weekly hours, recurring blocked time, days off and one-off hours.

**Groups**
- Unlimited members, invite codes, owner/admin/member roles.
- **Shared roadmaps:** members choose to subscribe, each at their own pace. When everyone follows one, it becomes a **group roadmap** with combined progress.
- **Group tasks:** a problem, a custom task or LeetCode's daily problem, set once, daily or on weekdays with a due time. They appear on everyone's Today and are verified per member.
- **Leaderboard** (7 days / 30 days / all time):
  - points by difficulty (Easy 10 / Medium 20 / Hard 30);
  - +50 / +30 / +10% for the first three finishers, ranked by submission time;
  - items from shared roadmaps count too.

**Progress**
- Solved problems per platform and difficulty, a 26-week activity heatmap, solving streak, top topics.
- A feed of accepted submissions, each with "Revise" to add it to spaced repetition.
- Focus time and task history.

**Reminders & settings**
- One email when tasks are still pending after your chosen hour, and a nudge when a group task is due within 2 hours. It syncs first, so already-solved work doesn't trigger it.
- Study limit, revision cap, auto-placing, focus and break lengths, privacy (leaderboard opt-out), in-app notifications, light and dark theme.
- Username + password sign-in.

## Platforms

| Platform | Connect with | Notes |
|---|---|---|
| LeetCode | Public username | Unofficial endpoint; only the last ~20 accepted submissions are visible, so press **Sync now** after a long session. |
| Codeforces | Public handle | Official API, rate-limited to one request every 2 s. |
| CodeChef | — | Links recognised; items are ticked by hand (no public API). |

Syncing:
- **When:** on demand (with a 60 s cooldown), whenever you tick an item, and lightly in the background.
- **Rate limits:** requests to each platform share one queue, and your clicks always go first.

## Quick start

Requires Node.js 20+. Locally, no database server is needed: an embedded Postgres (PGlite) is used.

```bash
npm install
npm run db:seed   # optional demo: sign in as "demo", "friend" or "sam" / "demo-password"
npm run dev       # http://localhost:5173
```

Copy `.env.example` to `.env` and set `BETTER_AUTH_SECRET` (otherwise you're signed out on every restart).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres, e.g. Supabase (session pooler, port 5432). TLS is automatic. Empty = embedded PGlite. |
| `BETTER_AUTH_SECRET`, `APP_URL` | Required in production. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Reminder emails. Without them, emails are printed to the server console. |
| `YOUTUBE_API_KEY` | Optional: import YouTube playlists into roadmaps. |

**Production:**
```bash
npm ci && npm run build && npm start
```
Migrations run on start, and the API serves the web app from the same origin.

**Docker** (two containers: `backend` = the API from [server/Dockerfile](server/Dockerfile), `frontend` = the web app on nginx from [web/Dockerfile](web/Dockerfile)):
```bash
docker compose up -d --build      # uses .env; frontend on 127.0.0.1:3002, backend on 127.0.0.1:3003
```
Both share the `momentum` Docker network: the frontend's nginx forwards `/api` to `backend:3001`, so the host's nginx only needs to proxy the domain to the frontend port (cookies stay first-party). Ports, the env file and the image tag come from `FRONTEND_PORT`, `BACKEND_PORT`, `ENV_FILE` and `TAG`. For blue-green, start a second copy with `-p momentum-green` and other ports; see the comments in [docker-compose.yml](docker-compose.yml). Set `APP_URL` to the public `https://` address, plus `BETTER_AUTH_SECRET`, `DATABASE_URL` (and `DATABASE_URL_UNPOOLED` for Neon) and the VAPID keys; the frontend needs no configuration. The backend trusts one proxy hop for client IPs. During a blue-green switch both backends briefly run against the same database, so keep migrations additive (add columns/tables; drop old ones in a later release).

| Script | |
|---|---|
| `npm test` | Unit + API integration tests (in-memory Postgres, mocked platforms) |
| `npm run typecheck` | All packages |
| `npm run db:generate` / `db:migrate` | Create / apply migrations |

## Architecture

An npm-workspaces monorepo:

```
shared/   pure TypeScript: schemas, scheduler, SM-2, pace, points, problem-link parsing
server/   Express 5 · Drizzle · Postgres/PGlite · better-auth
  core/     env, auth, db, event bus, jobs, module contract
  modules/  profile · tasks · planning · focus · platforms · roadmaps · repetition · groups · notify · progress
web/      React 19 · Vite · Tailwind 4 · TanStack Query  (features/ mirrors the server modules)
```

Each server module declares its routes, jobs and event handlers, and modules react to each other through domain events (`server/src/core/events.ts`). Platforms, daily-work sources, repetition algorithms, notification channels and the scheduler are pluggable interfaces. See **[docs/EXTENDING.md](docs/EXTENDING.md)**.

## Troubleshooting

| Problem | Fix |
|---|---|
| Signed out after restarts | Set `BETTER_AUTH_SECRET`. |
| Sign-in fails, app on port 5174 | Free port 5173 and restart `npm run dev`. |
| PGlite `RuntimeError: Aborted()` | The local database was damaged by a hard kill: delete `server/.data/pglite` (erases local data). |
| A LeetCode problem won't verify | Make the profile public, then press **Sync now**. |
