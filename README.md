<div align="center">

<img src="web/public/momentum-icons/master-logo.svg" alt="Momentum logo" width="120" height="120" />

# Momentum

**Make every day count.**

A study planner for CS students that plans your day, reminds you about what's left,
verifies your coding practice and keeps your study group on track.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

[Features](#features) · [Getting started](#getting-started) · [Configuration](#configuration) · [Deployment](#deployment) · [Architecture](#architecture) · [Contributing](#contributing)

</div>

---

## Why Momentum?

Most planners make you do the planning. Momentum builds your day for you, from your roadmaps, revisions, deadlines and group tasks, fits it around your classes and free time, and only reminds you about what you haven't done yet. Coding problems are ticked off automatically when an accepted LeetCode or Codeforces submission is found.

## Features

### Today: your plan, built for you
- A daily plan built automatically from roadmaps, spaced-repetition revisions, group tasks and your own tasks.
- Placed into your free time around classes and blocked time. A load guard moves anything beyond your study limit to a later day.
- One tap to finish a task. Coding problems are verified against your accepted submissions.
- **Swap** an item, **skip** it for today, set a time, set a reminder or start a **focus session**.
- **Coming up:** the next 7 days, estimated live from your current settings.

### Tasks and calendar
- Your own tasks with deadlines, durations, repeats and an optional per-task reminder.
- A week calendar with study blocks and classes. Drag a block to move and lock it.
- Weekly availability, recurring blocked time, days off and one-off hours.

### Roadmaps and spaced repetition
- Paste problem links (LeetCode, Codeforces, CodeChef), any URLs, topics, `# Section` headings or a YouTube playlist. A copy-ready prompt template lets you generate a roadmap with any AI assistant.
- Pace presets (**Frequent / Decent / Rare**) control new items per day and revision intensity.
- **SM-2 spaced repetition:** finished items return at growing intervals; rate each revision Again / Hard / Good / Easy.
- Projected finish date, per-item progress, reorder, skip and pause.

### Groups
- Invite codes, owner / admin / member roles, shared roadmaps (each member at their own pace).
- **Group tasks:** a problem, a custom task or LeetCode's daily problem, once, daily or on weekdays, verified per member.
- **Leaderboard** (7 days / 30 days / all time) with points by difficulty and bonuses for the first finishers.

### Progress
- One motivating chart of everything you finish (tasks, problems, revisions, focus time), streaks and totals.
- Solved problems by platform and difficulty, a 26-week heatmap and a feed of accepted submissions.

### Reminders that know what's left
| Reminder | When (your timezone) | Sent only if |
|---|---|---|
| Browser push | every 4 h from 09:00 (09:00, 13:00, 17:00) | something on today's plan is open |
| End-of-day email + push | 21:00 | something is still open |
| Group task due soon | 2 h before it's due | the group task is open |
| Per-task reminder | the exact time you choose | that task isn't done |

All hours are adjustable in Settings. Momentum syncs your latest submissions before nagging, so solved work never triggers a reminder.

### Works everywhere
- Installable web app (PWA) with browser notifications on desktop and mobile.
- Responsive layout with touch-sized controls on phones, plus light and dark themes.

## Supported platforms

| Platform | Connect with | Notes |
|---|---|---|
| LeetCode | Public username | Unofficial endpoint; only the latest ~20 accepted submissions are visible, so press **Sync now** after a long session. Can be disabled with `LEETCODE_ENABLED=false`. |
| Codeforces | Public handle | Official API, rate-limited to one request every 2 s. |
| CodeChef | — | Links are recognised; items are ticked by hand (no public API). |

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4, TanStack Query, React Router |
| Backend | Node.js, Express 5, Drizzle ORM, better-auth |
| Database | PostgreSQL (Neon in production), PGlite (embedded Postgres) for local development and tests |
| Notifications | Web Push (VAPID), SMTP email via Nodemailer |
| Tooling | TypeScript, npm workspaces, Vitest, tsup, Docker |

## Getting started

### Prerequisites
- **Node.js 20+** and npm.
- No database server is needed locally: an embedded Postgres (PGlite) is created under `server/.data/`.

### Install and run

```bash
git clone https://github.com/Aravind556/Momentum.git
cd Momentum
npm install
cp .env.example .env      # then set BETTER_AUTH_SECRET (see below)
npm run db:seed           # optional demo data: sign in as "demo", "friend" or "sam" / "demo-password"
npm run dev               # web on http://localhost:5173, API on :3001
```

Generate a secret with `openssl rand -base64 32`. Without `BETTER_AUTH_SECRET` you are signed out whenever the server restarts.

## Configuration

All settings are environment variables, read from `.env` in the repository root. See [`.env.example`](.env.example).

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | production | Public address of the app, e.g. `https://momentum.example.com`. Sign-in only accepts requests from this origin. |
| `BETTER_AUTH_SECRET` | production | Secret that signs sessions. Never change it once users exist. |
| `DATABASE_URL` | production | Postgres connection string (pooled). Empty = embedded PGlite. |
| `DATABASE_URL_UNPOOLED` | with Neon | Direct connection used for migrations. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | for push | Generate once with `npx web-push generate-vapid-keys`. Never change them once in use. |
| `VAPID_SUBJECT` | for push | Contact for push services, e.g. `mailto:you@example.com`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | for email | Reminder emails. Without them, emails are printed to the server log. |
| `JOBS_ENABLED` | no | `false` disables background jobs (syncs, plans, reminders). Default `true`. |
| `LEETCODE_ENABLED` | no | `false` disables the unofficial LeetCode integration. Default `true`. |
| `YOUTUBE_API_KEY` | no | Enables importing YouTube playlists into roadmaps. |
| `PORT` | no | API port. Default `3001`. |

## Deployment

### Docker Compose (recommended)

Momentum runs as two containers on a shared Docker network:

| Container | Image | Published on |
|---|---|---|
| `frontend` | nginx serving the built web app; forwards `/api` to the backend | `127.0.0.1:3002` |
| `backend` | the API ([server/Dockerfile](server/Dockerfile)); runs migrations on start | `127.0.0.1:3003` |

```bash
docker compose up -d --build                       # both
docker compose up -d --build --no-deps frontend    # redeploy only the frontend
docker compose up -d --build --no-deps backend     # redeploy only the backend
```

Put a reverse proxy with HTTPS in front of the frontend port. A minimal nginx site:

```nginx
server {
    server_name momentum.example.com;
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;   # one trusted hop: the real client address
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_read_timeout 60s;
    }

    listen 80;
}
```

Then run `sudo certbot --nginx -d momentum.example.com` for HTTPS.

`FRONTEND_PORT`, `BACKEND_PORT`, `ENV_FILE` and `TAG` override the defaults. For zero-downtime (blue-green) releases, start a second copy with `-p momentum-green` on other ports, switch the proxy, then stop the old copy. See the comments in [docker-compose.yml](docker-compose.yml). Because two backends briefly share the database during a switch, keep migrations additive.

### Without Docker

```bash
npm ci && npm run build && npm start   # the API also serves the built web app on PORT
```

## Architecture

An npm-workspaces monorepo:

```
shared/   Pure TypeScript: schemas, scheduler, SM-2, pace, points, roadmap and problem-link parsing
server/   Express 5 · Drizzle · Postgres/PGlite · better-auth
  src/core/      env, auth, database, event bus, background jobs, module contract
  src/modules/   profile · tasks · planning · focus · platforms · roadmaps
                 repetition · groups · notify · progress
  drizzle/       SQL migrations
  test/          API integration tests
web/      React 19 · Vite · Tailwind 4 · TanStack Query (features/ mirrors the server modules)
docs/     EXTENDING.md: recipes for adding platforms, daily sources, channels and more
```

- Each server module declares its routes, background jobs and event handlers. Modules react to each other through **domain events** rather than direct calls.
- Background jobs take a **Postgres lease**, so only one instance runs each job, and reminders are de-duplicated in the database.
- Platforms, daily-work sources, repetition algorithms, notification channels and the scheduler are **pluggable**. See [docs/EXTENDING.md](docs/EXTENDING.md).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the API and web app with hot reload |
| `npm test` | Unit tests (`shared`) and API integration tests (`server`, in-memory Postgres, mocked platforms) |
| `npm run typecheck` | Type-check every package |
| `npm run build` | Production build of the web app and the server |
| `npm run db:generate` | Create a migration from schema changes |
| `npm run db:migrate` | Apply migrations (also done automatically on start) |
| `npm run db:seed` | Load demo accounts and data into the local database |

## Troubleshooting

| Problem | Fix |
|---|---|
| Signed out after every restart | Set `BETTER_AUTH_SECRET`. |
| Sign-in returns 403 in production | `APP_URL` must exactly match the address in the browser (scheme, host, no trailing slash). |
| No notifications | Enable them in **Settings → Notifications**, check your timezone in Settings, and make sure something on today's plan is still open. |
| Sign-in fails and the app opened on port 5174 | Free port 5173 and restart `npm run dev`. |
| PGlite `RuntimeError: Aborted()` | The local database was damaged by a hard kill. Delete `server/.data/pglite` (erases local data). |
| A LeetCode problem won't verify | Make the profile public, then press **Sync now**. |

## Contributing

Contributions are welcome! Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, code conventions, commit style and pull request checklist. To report a security issue, see [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE).

