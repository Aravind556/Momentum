import { z } from "zod";
import { addDays, isoWeekday } from "./time.js";

/**
 * How a learner follows a roadmap. Two independent settings, both changeable at any time:
 *  - new-item pace: how many new items arrive, and on which weekdays;
 *  - revision: how often spaced-repetition reviews come back (a multiplier on SM-2 intervals).
 * Picking a preset (Frequent / Decent / Rare) sets both; either can then be changed on its own.
 */

export const PACE_PRESETS = ["frequent", "decent", "rare"] as const;
export type PacePreset = (typeof PACE_PRESETS)[number];

export const NEW_PACES = [...PACE_PRESETS, "custom"] as const;
export type NewPace = (typeof NEW_PACES)[number];
export const REVISIONS = [...PACE_PRESETS, "off", "custom"] as const;
export type Revision = (typeof REVISIONS)[number];

export interface NewPaceConfig {
  perDay: number;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[];
}
export interface RevisionConfig {
  multiplier: number;
  maxPerDay: number;
}

export const NEW_PACE_CONFIG: Record<PacePreset, NewPaceConfig> = {
  frequent: { perDay: 2, weekdays: [1, 2, 3, 4, 5, 6, 7] },
  decent: { perDay: 1, weekdays: [1, 2, 3, 4, 5] },
  rare: { perDay: 1, weekdays: [1, 3, 5] },
};

export const REVISION_CONFIG: Record<PacePreset, RevisionConfig> = {
  frequent: { multiplier: 0.5, maxPerDay: 4 },
  decent: { multiplier: 1, maxPerDay: 3 },
  rare: { multiplier: 1.5, maxPerDay: 2 },
};

export const PRESET_COPY: Record<PacePreset, { label: string; summary: string }> = {
  frequent: { label: "Frequent", summary: "2 new a day, every day · revise often" },
  decent: { label: "Decent", summary: "1 new each weekday · standard revision" },
  rare: { label: "Rare", summary: "1 new on Mon, Wed, Fri · light revision" },
};

const weekday = z.number().int().min(1).max(7);

export const followSettingsSchema = z
  .object({
    newPace: z.enum(NEW_PACES).default("decent"),
    revision: z.enum(REVISIONS).default("decent"),
    preferredTime: z.enum(["morning", "afternoon", "evening"]).nullable().default(null),
    custom: z
      .object({
        perDay: z.number().int().min(1).max(10).default(1),
        weekdays: z.array(weekday).min(1).max(7).default([1, 2, 3, 4, 5]),
        multiplier: z.number().min(0.25).max(4).default(1),
        maxPerDay: z.number().int().min(1).max(20).default(3),
      })
      .default({ perDay: 1, weekdays: [1, 2, 3, 4, 5], multiplier: 1, maxPerDay: 3 }),
    active: z.boolean().default(true),
  })
  .strict();
export type FollowSettings = z.infer<typeof followSettingsSchema>;

export function newPaceConfig(s: Pick<FollowSettings, "newPace" | "custom">): NewPaceConfig {
  return s.newPace === "custom" ? { perDay: s.custom.perDay, weekdays: s.custom.weekdays } : NEW_PACE_CONFIG[s.newPace];
}

/** null when revisions are off. */
export function revisionConfig(s: Pick<FollowSettings, "revision" | "custom">): RevisionConfig | null {
  if (s.revision === "off") return null;
  return s.revision === "custom" ? { multiplier: s.custom.multiplier, maxPerDay: s.custom.maxPerDay } : REVISION_CONFIG[s.revision];
}

/** New items due on a date (0 on a rest day). */
export function newItemsOn(s: Pick<FollowSettings, "newPace" | "custom">, date: string): number {
  const c = newPaceConfig(s);
  return c.weekdays.includes(isoWeekday(date)) ? c.perDay : 0;
}

/** The date the last remaining item would arrive at this pace, starting `from` (inclusive). */
export function projectedFinish(remaining: number, s: Pick<FollowSettings, "newPace" | "custom">, from: string): string | null {
  if (remaining <= 0) return null;
  const c = newPaceConfig(s);
  if (!c.weekdays.length || c.perDay < 1) return null;
  let left = remaining;
  for (let d = from, i = 0; i < 3660; d = addDays(d, 1), i++) {
    left -= newItemsOn(s, d);
    if (left <= 0) return d;
  }
  return null;
}

/** A partial change to follow settings (no defaults: missing fields keep their current value). */
export const followPatchSchema = z
  .object({
    newPace: z.enum(NEW_PACES),
    revision: z.enum(REVISIONS),
    preferredTime: z.enum(["morning", "afternoon", "evening"]).nullable(),
    custom: z
      .object({
        perDay: z.number().int().min(1).max(10),
        weekdays: z.array(weekday).min(1).max(7),
        multiplier: z.number().min(0.25).max(4),
        maxPerDay: z.number().int().min(1).max(20),
      })
      .partial(),
    active: z.boolean(),
  })
  .partial()
  .strict();
export type FollowPatch = z.infer<typeof followPatchSchema>;
