# Known limitations

Deliberate trade-offs and edge cases in the current design. Each says when it matters, and what to change if it ever does.

## Assigned group roadmaps

### The group's "day" follows the admin's timezone
When an admin assigns a roadmap, the assignment takes **the admin's timezone at that moment**. That timezone decides:
- which date is "today" for the group, so which items are due;
- the due time ("due by 21:00" means 21:00 in that timezone);
- whether an item counts as finished on time for first-finisher bonuses;
- which group day a member's join date falls on.

Each member's own Today still uses their own timezone. For members in the same or a nearby timezone this makes no difference. For a member several hours away:
- the group's next items can appear on their Today early or late in their own day;
- the due time shown is converted to their clock, so it may land at an odd local hour;
- an item finished just before their local midnight may already count as late for the group, or the other way round.

**If it matters:** add a timezone setting per assignment (or per group) in the assign form, defaulting to the admin's.

### Editing a roadmap after assigning it
- A group day's items are fixed the first time that day is needed, so past days never change.
- Items added to the roadmap later join the end of the queue.
- Reordering items only affects days that haven't been scheduled yet.
- Removing an item leaves a gap in a past day (it's simply skipped).

### Pace changes apply from the next group day
If an admin changes items per day or the group days, today's items (already fixed) stay as they were. The new pace starts from the next group day that hasn't been scheduled.

### Overdue items are capped on Today
At most 10 overdue items per assigned roadmap appear on a member's Today, oldest first, so a long absence doesn't flood the list. The rest appear as earlier ones are finished or skipped, and the group page always shows the full overdue count.

### "Previous items" are cached in the backend's memory
The **Previous items** section (items covered before a member joined) is read from an in-memory cache instead of the database on each view (`server/src/modules/groups/catch-up-cache.ts`):
- Ticks are always **saved to the database first** (`item_progress`); the cache is only a fast read copy, updated when the tick is saved.
- Every browser and device asks the same server, so they all see the same ticks.
- Entries unused for 30 minutes are dropped, and the cache rebuilds from the database after a restart.

**Limitation: this assumes one backend process.** With several backend containers behind a load balancer, each has its own memory. A tick handled by one container shows up in another's "Previous items" only after that container's entry expires, up to about 30 minutes later. The database is correct throughout.

**If you scale out:** drop the cache and read from the database (two small queries), or move the cache to a shared store such as Redis.

## Platforms

### LeetCode uses an unofficial endpoint
LeetCode has no public API, so verification relies on an undocumented endpoint that only shows the latest ~20 accepted submissions and could change without notice. After solving many problems at once, press **Sync now**. The integration can be turned off with `LEETCODE_ENABLED=false`.

### CodeChef can't be verified
CodeChef problem links are recognised, but there's no public API for submissions, so those items are ticked by hand.
