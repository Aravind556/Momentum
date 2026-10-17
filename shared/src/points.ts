import { z } from "zod";
import { difficultyBucket } from "./platforms.js";

/**
 * Group points. Every completed group task or shared-roadmap item earns base points by difficulty;
 * group tasks also reward speed: the first finishers of each occurrence get a bonus.
 * Groups can tune the numbers; the rules are shown on the group page.
 */
export const pointsConfigSchema = z.object({
  easy: z.number().int().min(0).max(1000).default(10),
  medium: z.number().int().min(0).max(1000).default(20),
  hard: z.number().int().min(0).max(1000).default(30),
  /** Items without a difficulty (topics, custom tasks, CodeChef). */
  other: z.number().int().min(0).max(1000).default(10),
  /** Bonus percent for 1st, 2nd, 3rd finisher of a group task occurrence. */
  bonus: z.array(z.number().int().min(0).max(500)).max(5).default([50, 30, 10]),
});
export type PointsConfig = z.infer<typeof pointsConfigSchema>;
export const DEFAULT_POINTS: PointsConfig = pointsConfigSchema.parse({});

export function basePoints(difficulty: string | number | null | undefined, cfg: PointsConfig = DEFAULT_POINTS): number {
  const b = difficultyBucket(difficulty);
  return b === "Easy" ? cfg.easy : b === "Medium" ? cfg.medium : b === "Hard" ? cfg.hard : cfg.other;
}

/** Points for finishing in `rank` place (1-based); ranks past the bonus list get the base. */
export function awardPoints(base: number, rank: number | null, cfg: PointsConfig = DEFAULT_POINTS): number {
  const pct = rank && rank >= 1 ? (cfg.bonus[rank - 1] ?? 0) : 0;
  return Math.round(base * (1 + pct / 100));
}

export function pointsRulesText(cfg: PointsConfig = DEFAULT_POINTS): string {
  const bonus = cfg.bonus.length ? ` First ${cfg.bonus.length} to finish a group task get +${cfg.bonus.join("/+")}%.` : "";
  return `Easy ${cfg.easy} · Medium ${cfg.medium} · Hard ${cfg.hard} · Other ${cfg.other} points.${bonus}`;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const groupTaskInputSchema = z
  .object({
    kind: z.enum(["problem", "custom", "potd"]),
    title: z.string().trim().max(200).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    /** Problem link (kind "problem") or an optional resource link (kind "custom"). */
    url: z.string().url().max(2000).nullable().optional(),
    repeat: z.enum(["once", "daily", "weekdays"]).default("once"),
    startDate: isoDate,
    endDate: isoDate.nullable().optional(),
    /** Local time the task is due on each day it occurs. */
    dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("23:59"),
    points: z.number().int().min(0).max(1000).optional(),
    estMinutes: z.number().int().min(5).max(600).optional(),
  })
  .refine((v) => v.kind !== "problem" || !!v.url, { message: "Paste the problem link", path: ["url"] })
  .refine((v) => v.kind !== "custom" || !!v.title, { message: "Give the task a title", path: ["title"] })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: "End date must be on or after the start date", path: ["endDate"] });
export type GroupTaskInput = z.infer<typeof groupTaskInputSchema>;
