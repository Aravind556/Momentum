import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { addDays, awardPoints, basePoints, instantToLocalDate, localDayBounds, pointsRulesText } from "@cadence/shared";
import type { Services } from "../../core/context.js";
import type { Tx } from "../../core/db/index.js";
import { externalEvents, groupPoints, groups } from "../../core/db/schema.js";
import { tzOf } from "../planning/schedules.js";
import { ACCEPTED } from "../platforms/types.js";
import { profilesByIds, publicProfile } from "../profile/service.js";
import { activeMemberIds, requireMember } from "./service.js";

/**
 * Records a member finishing a group-task occurrence, then re-ranks everyone who finished it.
 * Ranking is by finishing time (the accepted-submission time when verified), so a late sync of an
 * earlier submission still gets the right place.
 */
export async function recordGroupTaskPoints(
  db: Tx,
  e: { groupId: string; userId: string; groupTaskId: string; occurrence: string; completedAt: Date; verifiedBy: "submission" | "self"; base: number },
) {
  await db
    .insert(groupPoints)
    .values({ groupId: e.groupId, userId: e.userId, sourceType: "group_task", sourceId: e.groupTaskId, occurrence: e.occurrence, completedAt: e.completedAt, verifiedBy: e.verifiedBy, basePoints: e.base, points: e.base })
    .onConflictDoNothing();
  const group = await db.query.groups.findFirst({ where: eq(groups.id, e.groupId) });
  const finishers = await db
    .select()
    .from(groupPoints)
    .where(and(eq(groupPoints.groupId, e.groupId), eq(groupPoints.sourceType, "group_task"), eq(groupPoints.sourceId, e.groupTaskId), eq(groupPoints.occurrence, e.occurrence)))
    .orderBy(asc(groupPoints.completedAt), asc(groupPoints.createdAt));
  for (const [i, row] of finishers.entries()) {
    const points = awardPoints(row.basePoints, i + 1, group?.points);
    if (row.rank !== i + 1 || row.points !== points) await db.update(groupPoints).set({ rank: i + 1, points }).where(eq(groupPoints.id, row.id));
  }
}

/** Flat points for finishing an item of a roadmap shared in the group (earned once per item). */
export async function recordRoadmapItemPoints(
  db: Tx,
  e: { groupId: string; userId: string; itemId: string; difficulty: string | null; completedAt: Date; verifiedBy: "submission" | "self" },
) {
  const group = await db.query.groups.findFirst({ where: eq(groups.id, e.groupId) });
  const base = basePoints(e.difficulty, group?.points);
  await db
    .insert(groupPoints)
    .values({ groupId: e.groupId, userId: e.userId, sourceType: "roadmap_item", sourceId: e.itemId, occurrence: "-", completedAt: e.completedAt, verifiedBy: e.verifiedBy, basePoints: base, points: base })
    .onConflictDoNothing();
}

export type Period = "week" | "month" | "all";

/**
 * Points leaderboard over the last 7 days, 30 days, or all time. Ties: more completions first,
 * then alphabetical. Members who opted out of leaderboards are counted but not listed.
 */
export async function leaderboard(s: Services, userId: string, groupId: string, period: Period = "week") {
  await requireMember(s.db, groupId, userId);
  const group = (await s.db.query.groups.findFirst({ where: eq(groups.id, groupId) }))!;
  const tz = await tzOf(s.db, userId);
  const today = instantToLocalDate(s.now(), tz);
  const since = period === "all" ? null : new Date(localDayBounds(addDays(today, period === "week" ? -6 : -29), tz).start);

  const ids = await activeMemberIds(s.db, groupId);
  const profs = await profilesByIds(s.db, ids);
  const visible = ids.filter((id) => profs.get(id)?.preferences.privacy.showOnLeaderboard !== false);
  const totals = visible.length
    ? await s.db
        .select({
          userId: groupPoints.userId,
          points: sql<number>`coalesce(sum(${groupPoints.points}), 0)`,
          completions: sql<number>`count(*)`,
          firsts: sql<number>`count(*) filter (where ${groupPoints.rank} = 1)`,
        })
        .from(groupPoints)
        .where(and(eq(groupPoints.groupId, groupId), inArray(groupPoints.userId, visible), since ? gte(groupPoints.completedAt, since) : undefined))
        .groupBy(groupPoints.userId)
    : [];
  // Problems solved on any platform in the period (individual effort, shown for context).
  const solved = visible.length
    ? await s.db
        .select({ userId: externalEvents.userId, n: sql<number>`count(distinct ${externalEvents.provider} || ':' || (${externalEvents.data}->>'problemKey'))` })
        .from(externalEvents)
        .where(and(inArray(externalEvents.userId, visible), eq(externalEvents.type, ACCEPTED), since ? gte(externalEvents.occurredAt, since) : undefined))
        .groupBy(externalEvents.userId)
    : [];

  const rows = visible
    .map((id) => {
      const t = totals.find((x) => x.userId === id);
      return {
        user: publicProfile(profs.get(id)!),
        points: Number(t?.points ?? 0),
        completions: Number(t?.completions ?? 0),
        firsts: Number(t?.firsts ?? 0),
        solved: Number(solved.find((x) => x.userId === id)?.n ?? 0),
      };
    })
    .sort((a, b) => b.points - a.points || b.completions - a.completions || a.user.displayName.localeCompare(b.user.displayName));
  // Members without points this period aren't ranked (no "everyone is #1 with 0").
  let rank = 0;
  let prev: number | null = null;
  const ranked = rows.map((r, i) => {
    if (r.points !== prev) rank = i + 1;
    prev = r.points;
    return { rank: r.points > 0 ? rank : null, ...r };
  });
  return { period, rows: ranked, hiddenCount: ids.length - visible.length, rules: pointsRulesText(group.points), pointsConfig: group.points };
}
