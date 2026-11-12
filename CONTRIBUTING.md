# Contributing to Momentum

Thanks for helping make Momentum better! This guide covers how to set up the project, the conventions the code follows, and what a pull request needs before it can be merged.

## Contents
- [Ground rules](#ground-rules)
- [Development setup](#development-setup)
- [Branches](#branches)
- [Commit messages](#commit-messages)
- [Code conventions](#code-conventions)
- [Database changes](#database-changes)
- [Tests](#tests)
- [Pull requests](#pull-requests)
- [Review and merging](#review-and-merging)

## Ground rules
- **Open an issue first** for anything bigger than a small fix, so the approach can be agreed before you spend time on it.
- **One change per pull request.** A bug fix and a refactor are two PRs.
- **Never commit secrets.** `.env` is ignored by git; only `.env.example` (blank values) is tracked.
- Be kind and constructive in issues and reviews.

## Development setup

Requires **Node.js 20+**.

```bash
git clone https://github.com/<your-username>/Momentum.git
cd Momentum
npm install
cp .env.example .env          # set BETTER_AUTH_SECRET; leave DATABASE_URL empty to use PGlite
npm run db:seed               # optional demo data
npm run dev                   # web on http://localhost:5173, API on :3001
```

Leave `DATABASE_URL` empty for local work: an embedded Postgres (PGlite) is used, so you never touch a shared database.

Before pushing, run:

```bash
npm run typecheck
npm test
npm run build
```

## Branches

Branch from `main` and name the branch after the kind of change:

| Prefix | Use for | Example |
|---|---|---|
| `feat/` | a new feature | `feat/telegram-reminders` |
| `fix/` | a bug fix | `fix/tick-not-saving` |
| `perf/` | a performance improvement | `perf/batch-forecast-queries` |
| `refactor/` | restructuring without behaviour change | `refactor/split-planner-routes` |
| `docs/` | documentation only | `docs/deployment-guide` |
| `chore/` | tooling, dependencies, CI | `chore/bump-vite` |

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary in the imperative, max ~72 chars>

<optional body: what changed and why, wrapped at ~80 chars>

<optional footer: Closes #123, BREAKING CHANGE: …>
```

- **type:** `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`.
- **scope:** the area touched, e.g. `today`, `tasks`, `roadmaps`, `groups`, `notify`, `progress`, `auth`, `db`, `docker`, `web`.

Examples:

```
feat(notify): add per-task reminders
fix(today): keep the tick when the server confirms late
perf(planning): compute the forecast in one pass
```

## Code conventions

The architecture and extension recipes are in **[docs/EXTENDING.md](docs/EXTENDING.md)**. Read it before adding a feature. The rules that matter most:

**Server**
- A feature lives in `server/src/modules/<name>/` (`schema.ts`, services, `routes.ts`, `index.ts`) and is registered with one line in `server/src/modules/index.ts`.
- Modules talk to each other through **domain events** (`server/src/core/events.ts`), never by importing each other's internals. Emit events only **after** the transaction commits.
- Use **`s.now()`**, never `Date.now()`, in logic. Tests control the clock.
- Validate every request body with zod (`parse(...)`). Every `/api` route requires a signed-in user unless there's a clear reason otherwise.
- Avoid one database query per item in loops. The production database is remote, so each query costs tens of milliseconds.

**Shared**
- `shared/` holds pure logic (no I/O, no Node or DOM APIs) used by both server and web, with unit tests next to it.

**Web**
- Data fetching goes through TanStack Query and `web/src/lib/api.ts`. Mutations use `useAction` and invalidate only the queries they affect.
- Build UI from the components in `web/src/components/ui.tsx`, with colours from the theme tokens in `index.css`. No hard-coded colours.
- Every screen must work at phone width (360 px), with touch-sized controls and keyboard access.

**General**
- TypeScript strict mode, no `any` without a comment explaining why.
- Comments explain *why*, not *what*.
- Keep user-facing text short, plain and friendly.

## Database changes

1. Change the Drizzle schema (`server/src/modules/<name>/schema.ts`; export new tables from `server/src/core/db/schema.ts`).
2. Run `npm run db:generate` and commit the generated SQL in `server/drizzle/` together with the snapshot in `server/drizzle/meta/`.
3. **Keep migrations additive:** add tables and nullable columns (or columns with defaults). Rename or drop in a later release, once no running version uses the old column. During a deploy, the old and new backends briefly share the database.
4. Never edit a migration that has already been merged.

## Tests

- **Shared logic:** unit tests next to the code, `shared/src/*.test.ts`.
- **API behaviour:** integration tests in `server/test/*.test.ts`. `setupTestEnv()` gives a fresh in-memory Postgres, real auth, every module, a fake `fetch` and a controllable clock (`t.clock.now`).
- Bug fixes need a test that fails without the fix.
- Tests must not call real external services or a real database.

```bash
npm test                                   # everything
npm test -w server -- test/roadmaps.test.ts   # one file
```

## Pull requests

1. Push your branch and open a PR against `main`.
2. Fill in the [pull request template](.github/pull_request_template.md). It opens automatically.
3. Keep the PR focused, ideally under ~400 changed lines excluding generated files. Split larger work.
4. Include screenshots or a short recording for any UI change, on **desktop and phone width**, in **light and dark** themes.
5. Mark the PR as a **draft** while it's still in progress.

**PR title:** the same format as a commit message, e.g. `feat(roadmaps): import from a GitHub README`.

## Review and merging
- At least one approving review is required, and all checks must pass.
- Respond to every review comment, with a change or a reply.
- PRs are **squash-merged**, so the PR title becomes the commit message on `main`.
- After merging, delete your branch.

Thank you for contributing!
