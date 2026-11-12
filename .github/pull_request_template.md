<!--
PR title: <type>(<scope>): <summary>   e.g.  fix(today): keep the tick when the server confirms late
Types: feat · fix · perf · refactor · docs · test · chore · build · ci
See CONTRIBUTING.md for details.
-->

## Summary
<!-- What does this PR do, in one or two sentences? -->


## Why
<!-- The problem or need behind it. Link the issue. -->
Closes #

## Type of change
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Performance improvement
- [ ] Refactor (no behaviour change)
- [ ] Documentation
- [ ] Build / CI / tooling
- [ ] Breaking change (existing behaviour, API or data changes in a way users or deployers must act on)

## What changed
<!-- The main changes, grouped by area. Point reviewers to the files that matter most. -->
- **Server:**
- **Web:**
- **Shared:**

## How it was tested
<!-- Commands you ran and what you checked by hand. -->
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Tried it in the browser:
  <!-- e.g. "Created a task with a reminder 2 minutes ahead, got the notification, ticked it, reminder not sent again." -->

**New or updated tests:**
<!-- List them, or explain why none were needed. -->

## Screenshots / recording
<!-- Required for UI changes: desktop and phone width, light and dark theme. Delete if not applicable. -->
| Before | After |
|---|---|
|  |  |

## Database
- [ ] No schema change
- [ ] Schema changed: migration generated with `npm run db:generate` and committed (SQL + snapshot)
- [ ] The migration is **additive** (no renames or drops), safe while the previous version is still running

## Deployment notes
<!-- New env variables, config changes, manual steps, or "None". New variables must also be added to .env.example and the README. -->
None

## Checklist
- [ ] The PR does one thing and the title follows Conventional Commits
- [ ] Follows the conventions in CONTRIBUTING.md and docs/EXTENDING.md (modules talk via events, `s.now()` not `Date.now()`, input validated)
- [ ] No secrets, personal data or local paths in code, logs or screenshots
- [ ] Works at phone width (360 px) and with the keyboard
- [ ] Docs updated (README, docs/EXTENDING.md, `.env.example`) if behaviour or setup changed
