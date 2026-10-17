# Cadence

Plan your day, focus on the next task, record real progress, and stay accountable with friends.

**Define goals → Generate a schedule → Focus → Record real progress → Stay accountable.**

This is the implementation of [`writing-block.md`](./writing-block.md) (the PRD).

## Quick start

**Requirements:** Node.js 20+ (tested on 22) and npm. You don't need a database server, Docker or any API keys to run locally. Without `DATABASE_URL` the API uses an embedded [PGlite](https://pglite.dev) database, which is the real PostgreSQL engine compiled to WASM. It stores data in `server/.data/pglite`.

```bash
# 1. Install dependencies (first time only)
npm install

# 2. Optional: demo data — two accounts sharing a Circle, sample tasks and a challenge
npm run db:seed

# 3. Start the API (port 3001) and the web app (port 5173)
npm run dev
```

Open **http://localhost:5173** and either:
- **create an account.** A short onboarding follows (name, working hours, timezone, an optional Circle and a first task); every step can be skipped.
- **or sign in with a seeded demo account:** `demo@cadence.dev` / `demo-password`, or `friend@cadence.dev` / `demo-password`. Seeded items are labelled `[seed]`.

**Optional `.env`:** copy `.env.example` to `.env`. For local use, the useful setting is `BETTER_AUTH_SECRET`. Without it, a temporary secret is generated and **everyone is signed out whenever the server restarts**. Your data is kept either way. Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Don't put `NODE_ENV=production` or an `https://` `APP_URL` in the `.env` you use for `npm run dev`. Those settings are only for public hosting (below), and sign-in breaks locally if they're set.

### Stopping, restarting and resetting

- **Stop:** press `Ctrl+C` in the terminal running `npm run dev`. Prefer this over killing the process. PGlite writes to disk, and a hard kill during a write can leave the database unreadable (see *Troubleshooting*).
- **Restart:** run `npm run dev` again. Data persists in `server/.data/pglite`.
- **Start fresh:** stop the server, delete `server/.data/pglite` (this erases all local accounts and data), then optionally run `npm run db:seed` again.

## First steps in the app

1. **Planner → Availability:** set your working hours, recurring blocked time (lunch, gym) and date exceptions such as days off.
2. **Today → Add commitment:** classes and meetings, which are *fixed* and never moved, or *flexible* items like "a 60-minute workout between 17:00 and 20:00".
3. **Goals & Tasks → + Task:** give each task a duration and choose whether it is one continuous block or can be split into sessions. Optionally add a deadline, a time window, "must come after" dependencies, repeats, and verification.
4. **Today → Generate schedule.** Anything that doesn't fit is listed under *Needs a slot* with the reason.
5. **Start focus** on a block. When you finish, record what happened to the task. A finished timer never completes a task by itself.
6. During the day, **Regenerate remaining** re-plans what's left. Completed, running and locked blocks and fixed commitments stay put. Dragging a block moves it and locks it.
7. **Circles:** create one, then share an invitation code from the *Members* tab. Friends join under **Circles → Join**.

### Tracking the LeetCode Problem of the Day (POTD)

1. **Integrations → LeetCode:** enter your LeetCode username and click Connect. Your profile must be public; no password is needed.
2. **Goals & Tasks → + Task:** set *Repeats* to **Every day**, *Verification* to **LeetCode accepted submissions**, and *Check* to **Solve the Problem of the Day**.
3. Solve the POTD on LeetCode. The app syncs every ~30 minutes, or immediately with **Integrations → Sync now**. That day's task is then marked complete as **Verified by integration**.

Notes on how the check behaves:
- Only an **accepted** submission of **that day's** POTD counts.
- LeetCode's day runs on **UTC** (05:30–05:30 IST), matching LeetCode's own streak.
- Ticking the task yourself shows **Pending verification** until a sync confirms it.
- Only your ~20 most recent accepted submissions are visible to the app, so sync soon after the POTD on heavy days.

## Scripts, deployment and troubleshooting

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) + Vite dev server with `/api` proxy |
| `npm test` | Scheduler/domain unit tests + API integration tests (in-memory Postgres) |
| `npm run typecheck` | TypeScript across `shared`, `server`, `web` |
| `npm run build` | Production build (web → `web/dist`, API → `server/dist`) |
| `npm start` | Run the built API; it also serves `web/dist` on the same origin |
| `npm run db:generate` | Generate a SQL migration after changing `server/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (they also run automatically on server start) |
| `npm run db:seed` | **Development only**: seed demo data labelled `[seed]` |

### Production

1. Set `NODE_ENV=production`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` and `APP_URL` (the public `https://` origin). Use `DATABASE_URL` for PostgreSQL 14+, or `PGLITE_DIR` for a separate embedded database. Don't reuse the dev database, because the demo accounts have a published password.
2. Run `npm ci && npm run build && npm start`. Migrations run on boot. The API serves the built web app from the same origin, so cookies stay first-party.
3. Put it behind HTTPS. Secure cookies are enabled automatically when `APP_URL` is `https://`.

### Hosting on your own PC for friends (DuckDNS + Caddy)

This setup was prepared and works up to your router. **It was never reachable from outside**: the router had no port forward for 443, and the internet provider may use CGNAT. If you try again:

1. Create a subdomain at https://www.duckdns.org and point it at your public IP:
   `curl "https://www.duckdns.org/update?domains=<name>&token=<token>&ip=<public-ip>"`
2. Put the production values in `.env` (example: `.env.duckdns`, which is gitignored and holds generated secrets).
3. Download Caddy with the DuckDNS plugin into `.tools/` (gitignored):
   `curl -L -o .tools/caddy.exe "https://caddyserver.com/api/download?os=windows&arch=amd64&p=github.com%2Fcaddy-dns%2Fduckdns"`
   Then create `.tools/Caddyfile`:
   ```
   {
   	http_port 8089
   	auto_https disable_redirects
   }

   <name>.duckdns.org {
   	tls {
   		dns duckdns {env.DUCKDNS_TOKEN}
   	}
   	reverse_proxy 127.0.0.1:3001
   }
   ```
4. Run `npm run build`, then `npm start`. In a second terminal run `DUCKDNS_TOKEN=<token> .tools/caddy.exe run --config .tools/Caddyfile`. Allow caddy.exe through Windows Firewall when prompted.
5. On the router, forward TCP **443** to this PC's LAN IP on port 443. Test from outside your network, e.g. from a phone on mobile data.
6. If the router's WAN IP differs from your public IP (a `100.64.x`, `10.x` or `192.168.x` address), your provider uses **CGNAT**, and inbound port forwarding cannot work. Use a tunnel such as Cloudflare Tunnel instead.

While hosted, the app is only available when your PC is on and both processes are running, and anyone with the link can create an account.

### Troubleshooting

| Problem | Fix |
|---|---|
| Web app starts on **5174** instead of 5173, and sign-in fails | Another process holds port 5173 (often an old dev server). Stop it, then restart `npm run dev`. Auth only trusts the origin in `APP_URL` (default `http://localhost:5173`). |
| Signed out after every restart | Set `BETTER_AUTH_SECRET` in `.env`. |
| Sign-in fails locally after hosting setup | `.env` contains production values (`NODE_ENV=production`, `https://` `APP_URL`). Move it aside (e.g. to `.env.duckdns`) for local dev. |
| Server crashes on start with `RuntimeError: Aborted()` from PGlite | The embedded database was damaged, usually by a hard kill. Delete the data folder (`server/.data/pglite`, or the `PGLITE_DIR` you set; **this erases its data**) and start again. Stop with `Ctrl+C` to avoid it. |
| `/` shows "Cannot GET /" with `npm start` | Rebuild with `npm run build` (needs the Express 5 `/{*splat}` route in `server/src/app.ts`), and make sure no old server process is still holding port 3001. |
| Password reset email never arrives | No email provider is configured. The reset link is printed in the server terminal. |
| YouTube import says "not configured" | Set `YOUTUBE_API_KEY`, or use **Enter lessons manually**. |
| GitHub "Connect" unavailable | Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (OAuth app callback: `{APP_URL}/api/integrations/github/callback`). |

## Environment variables

See [`.env.example`](./.env.example).

| Variable | Required | Notes |
|---|---|---|
| `APP_URL` | prod | Public web origin. Used for auth callbacks and trusted-origin checks. |
| `BETTER_AUTH_SECRET` | prod | Session signing secret. In dev an ephemeral secret is generated, so sessions reset on restart. |
| `ENCRYPTION_KEY` | recommended | 32-byte base64 key for AES-256-GCM encryption of integration tokens. Derived from the auth secret if unset. |
| `DATABASE_URL` | prod | PostgreSQL. Empty means embedded PGlite. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | optional | GitHub OAuth app. Callback: `{APP_URL}/api/integrations/github/callback` |
| `YOUTUBE_API_KEY` | optional | YouTube Data API v3 for playlist import. Manual lesson entry works without it. |
| `LEETCODE_ENABLED` | optional | `false` disables the unofficial LeetCode adapter. |
| `JOBS_ENABLED` | optional | Background reminders and integration sync (default on). |

## Architecture

A modular monolith in an npm-workspaces monorepo:

```
shared/   Pure TypeScript domain: scheduling engine, validator, time/interval math,
          zod schemas shared by client and server, focus-timer math, streak & score formulas
server/   Express 5 API · Drizzle ORM · PostgreSQL/PGlite · better-auth
  src/services/      domain services (schedules, tasks, focus, completions, circles, …)
  src/integrations/  provider adapters (LeetCode, GitHub, YouTube) behind one interface
  src/jobs/          periodic jobs with Postgres-backed leases (no Redis)
  drizzle/           SQL migrations
web/      React 19 · Vite · Tailwind 4 · TanStack Query · React Router
```

### The scheduling engine (`shared/src/scheduler`)

It is deterministic and greedy, behind a `Scheduler` interface so that a constraint solver such as OR-Tools can replace it later. No LLM is involved in placement.

1. **Windows** are the weekly working hours, or a date override, minus recurring blocked ranges. Windows that cross midnight are supported and belong to the day they start. All calculations happen in the user's IANA timezone and are DST-safe (a 23-hour or 25-hour day really has 23 or 25 hours).
2. **Free time** is windows minus busy time: fixed commitments plus preserved blocks (completed, in progress, locked, past). It is snapped to 5 minutes.
3. **Ordering:** repeatedly take the highest-ranked task whose dependencies are resolved. Rank is priority plus deadline urgency, then earliest deadline, then indivisible before splittable, then creation order.
4. **Placement:**
   - Indivisible tasks take the earliest continuous slot of their full duration.
   - Splittable tasks are cut into sessions within their min/max, and never leave a remainder shorter than the minimum session.
   - Focus blocks keep at least the break length between them, and break blocks are inserted.
   - Hard daily windows ("only 17:00–20:00"), earliest start and latest finish are hard constraints.
   - The preferred time of day is soft, with a fallback and a warning.
   - Daily caps and group budgets (used by playlist plans) are enforced.
5. **Validation:** `validateSchedule` checks every hard constraint. It covers overlaps, busy collisions, working windows, indivisibility, session bounds, dependency order, bounds, spacing and caps. It runs on every generation before anything is persisted.
6. **Reporting:** unplaced work comes back with a code, a reason ("Needs 50 uninterrupted minutes; the longest free gap is 35 min") and a suggestion. Deadline misses and overload are warnings.

**Regeneration** runs in one transaction with the user's profile row locked, so concurrent requests cannot double-book. It:
- marks past planned blocks as **missed** (never as complete)
- keeps completed, running and locked blocks and fixed commitments
- counts already-recorded work, so it is never rescheduled again
- replaces only future, unlocked, planned blocks
- reports what no longer fits

Moving a block manually locks it.

### Time, completion and verification are separate

- **Focus sessions** store `startedAt`, pause records and `endedAt`. All durations are derived from timestamps, so a refresh or disconnect never corrupts them (`GET /api/focus-sessions/active` recovers a session). Background time counts by default; a setting makes the app auto-pause when the tab is hidden.
- **Finishing a timer never completes a task.** The user records the outcome (still working / partial / complete).
- **Task completions** are idempotent per task and occurrence, enforced by a partial unique index. Reopening voids a completion instead of deleting it. Each completion carries a verification status: `verified` (integration), `manual`, `evidence`, `pending`, `unavailable` or `failed`. A manual completion of an integration-checked task is `pending` until a successful sync verifies it. Provider failures never change a verification status.

### Decisions made where the PRD was open

- **Consistency score:** completed (partial = ½) divided by scheduled focus sessions that have already started in the period. Days with nothing scheduled are excluded. "Balanced" is 50% consistency + 30% completed tasks relative to the top member + 20% active days. Each leaderboard row carries a breakdown that explains it.
- **Streaks:** a day is *active* if a task was completed or a focus block was done. It is *missed* if focus work was scheduled but nothing was done. Otherwise it is *neutral*, which neither extends nor breaks a streak. An unfinished today never breaks a streak.
- **Privacy:** Circle members see only what you share. That covers completions of tasks in *shared goals or challenges* (by title), streak milestones, opt-in focus presence or session durations, and count-only leaderboard stats. Private task names, descriptions, schedules and connected accounts are never exposed. Non-members get 404 for every Circle resource.
- **Recurring tasks** produce one occurrence per matching day. Dependencies between recurring tasks are ignored.
- **Deleting a task** that has recorded history archives it instead.
- **Notifications** are in-app only, deduplicated by key, and respect per-category settings. Email and push are not configured.
- **Auth** uses better-auth: scrypt hashing, DB sessions, HTTP-only SameSite=Lax cookies and rate limits. Password-reset links are printed to the server log until an email provider is configured. As defence in depth against CSRF, every state-changing API request must carry `X-Requested-With: cadence`.

## Integrations and their limitations

| Integration | Status | Limitations |
|---|---|---|
| **LeetCode** | Works with a public username, no password. Two check modes: *N distinct problems* (optionally by difficulty) or *the Problem of the Day*. The daily-challenge queries were confirmed against the live site. The full end-to-end flow has been tested against mocked responses only. | LeetCode has **no official API**. The adapter uses the site's public GraphQL endpoint (`recentAcSubmissionList`, `activeDailyCodingChallengeQuestion`, `dailyCodingChallengeV2`), which can change or rate-limit without notice. Only the ~20 most recent accepted submissions are visible. Distinct problems are counted, so re-submissions don't count twice. POTD checks use LeetCode's UTC day. If POTD data can't be fetched, the result stays undecided and is never marked failed. Failures back off and never alter task status. |
| **GitHub** | OAuth flow implemented; needs `GITHUB_CLIENT_ID/SECRET`. Not tested against live GitHub. | It requests no scopes, so only public activity is visible. The events API covers about 90 days / 300 events. Criteria: open or merge a PR, close an issue, or push commits in a given `owner/repo`. Disconnect deletes the token and attempts revocation. |
| **YouTube playlists** | Needs `YOUTUBE_API_KEY`. Without it, manual lesson entry is offered. Tested against mocked responses only. | Private or deleted videos are skipped and counted. Playback **cannot** be verified, so video progress is self-reported and recorded as a manual completion. |

Tokens are encrypted at rest with AES-256-GCM. Provider data is treated as untrusted input, and provider errors are isolated from core features.

## Tests

- `shared`: 33 tests. Scheduler cases from PRD §23: the PRD example day, overlapping commitments, too-short gaps, splitting, fragments, breaks, dependencies and cycles, deadlines, no time, date exceptions, overnight windows, DST spring-forward and fall-back, regeneration around completed/locked blocks, tasks that stop fitting, hard and preferred windows, multi-day budgets, determinism, and a randomized no-overlap property test. Also focus math, streaks, scores and interval math.
- `server`: 18 API integration tests against a fresh in-memory Postgres with real auth and a controllable clock, covering:
  - Workflows A–E end to end
  - CSRF and auth checks
  - authorization boundaries
  - concurrent regeneration
  - optimistic concurrency
  - duplicate completions
  - invitations: used-up, invalid and removed-member cases
  - leaderboard opt-out
  - private-data leakage checks on the feed and dashboard
  - LeetCode verification, including duplicates, wrong difficulty, outage, rate limit, recovery and idempotency
  - LeetCode Problem of the Day: wrong problem, right problem on the wrong UTC day, right problem on the right day
  - playlist feasibility and the plan/apply equivalence
  - YouTube-not-configured fallback

## Known gaps and next steps

- Drag-and-drop moves blocks within a day. Moving across days in the week view is done through the block's "Edit time".
- Email delivery (password reset, digests) and browser push are not wired up.
- The greedy engine is not globally optimal. The `Scheduler` interface is the seam for an OR-Tools CP-SAT implementation.
- AI-assisted planning explanations (PRD phase 5) are not implemented.
