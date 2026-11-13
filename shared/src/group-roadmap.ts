import { z } from "zod";
import { addDays, isoWeekday } from "./time.js";

/**
 * Assigned group roadmaps: an admin assigns a roadmap to a group with one pace for everyone, and
 * each group day the next items become that day's work for every member.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");

export const GROUP_ROADMAP_REVISIONS = ["frequent", "decent", "rare", "off"] as const;

export const groupRoadmapInputSchema = z.object({
  roadmapId: z.string().min(1),
  itemsPerDay: z.number().int().min(1).max(10).default(1),
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one day").max(7).default([1, 2, 3, 4, 5]),
  startDate: date,
  dueTime: hhmm.default("23:59"),
  /** Spaced-repetition revisions for members who don't follow the roadmap themselves. */
  revision: z.enum(GROUP_ROADMAP_REVISIONS).default("decent"),
});
export type GroupRoadmapInput = z.infer<typeof groupRoadmapInputSchema>;

/** Changes to an assignment. No defaults: anything left out stays as it is. */
export const groupRoadmapPatchSchema = z.object({
  itemsPerDay: z.number().int().min(1).max(10).optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one day").max(7).optional(),
  dueTime: hhmm.optional(),
  revision: z.enum(GROUP_ROADMAP_REVISIONS).optional(),
  status: z.enum(["active", "paused"]).optional(),
});
export type GroupRoadmapPatch = z.infer<typeof groupRoadmapPatchSchema>;

/** The group days (dates whose weekday is in `weekdays`) from `from` to `to`, both inclusive. */
export function groupDaysBetween(from: string, to: string, weekdays: number[]): string[] {
  const out: string[] = [];
  for (let d = from, i = 0; d <= to && i < 3660; d = addDays(d, 1), i++) if (weekdays.includes(isoWeekday(d))) out.push(d);
  return out;
}

/**
 * The next `perDay` items for a group day: roadmap order, skipping anything already scheduled on
 * an earlier day. Items added to the roadmap later simply join the end of the queue.
 */
export function nextGroupSlice(orderedItemIds: readonly string[], scheduled: ReadonlySet<string>, perDay: number): string[] {
  const out: string[] = [];
  for (const id of orderedItemIds) {
    if (out.length >= perDay) break;
    if (!scheduled.has(id)) out.push(id);
  }
  return out;
}
