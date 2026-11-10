import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { addDays, instantToLocalDate, localDayBounds, type FollowPatch } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import type { Tx } from "../../core/db/index.js";
import { groupMembers, groups, itemProgress, roadmapFollows, roadmapItems, roadmaps, roadmapShares } from "../../core/db/schema.js";
import { badRequest, forbidden, notFound } from "../../core/http.js";
import { tzOf } from "../planning/schedules.js";
import { profilesByIds, publicProfile } from "../profile/service.js";
import { follow, requireViewable } from "../roadmaps/service.js";
import { activeMemberIds, requireMember } from "./service.js";

/** Members of a group a roadmap is shared in may view (and subscribe to) it. */
export async function canViewViaGroups(db: Tx, userId: string, roadmapId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: roadmapShares.id })
    .from(roadmapShares)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, roadmapShares.groupId), eq(groupMembers.userId, userId), eq(groupMembers.status, "active")))
    .where(eq(roadmapShares.roadmapId, roadmapId))
    .limit(1);
  return !!row;
}

/** Offers a roadmap to a group. Nobody is subscribed automatically — each member decides. */
export async function shareRoadmap(s: Services, userId: string, roadmapId: string, groupId: string) {
  const r = await requireViewable(s.db, userId, roadmapId);
  if (r.ownerId !== userId) throw forbidden("Only the roadmap's owner can share it");
  if (r.archivedAt) throw badRequest("Archived roadmaps can't be shared", "archived");
  await requireMember(s.db, groupId, userId);
  await s.db.insert(roadmapShares).values({ roadmapId, groupId, sharedBy: userId }).onConflictDoNothing();
  return { ok: true };
}

/** Stops offering it. People who already subscribed keep following. */
export async function unshareRoadmap(s: Services, userId: string, roadmapId: string, groupId: string) {
  const m = await requireMember(s.db, groupId, userId);
  const r = await s.db.query.roadmaps.findFirst({ where: eq(roadmaps.id, roadmapId) });
  if (!r) throw notFound("Roadmap");
  if (r.ownerId !== userId && m.role === "member") throw forbidden("Only the owner or a group admin can unshare this");
  await s.db.delete(roadmapShares).where(and(eq(roadmapShares.roadmapId, roadmapId), eq(roadmapShares.groupId, groupId)));
  return { ok: true };
}

/** Groups (that you're in) a roadmap is shared with. */
export async function sharesOfRoadmap(s: Services, userId: string, roadmapId: string) {
  await requireViewable(s.db, userId, roadmapId);
  return s.db
    .select({ groupId: groups.id, name: groups.name })
    .from(roadmapShares)
    .innerJoin(groups, eq(groups.id, roadmapShares.groupId))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId), eq(groupMembers.status, "active")))
    .where(eq(roadmapShares.roadmapId, roadmapId))
    .orderBy(asc(groups.name));
}

/** Subscribe to a roadmap shared in a group, with your own pace and revision settings. */
export async function subscribe(s: Services, userId: string, groupId: string, roadmapId: string, settings: FollowPatch) {
  await requireMember(s.db, groupId, userId);
  const share = await s.db.query.roadmapShares.findFirst({ where: and(eq(roadmapShares.groupId, groupId), eq(roadmapShares.roadmapId, roadmapId)) });
  if (!share) throw notFound("Shared roadmap");
  return follow(s, userId, roadmapId, settings, groupId);
}

/**
 * Roadmaps shared in a group with everyone's progress. When every member follows one, it's a
 * "group roadmap" — computed live, so a new member joining (or someone leaving it) changes that.
 */
export async function groupRoadmaps(s: Services, userId: string, groupId: string) {
  await requireMember(s.db, groupId, userId);
  const shares = await s.db
    .select({ roadmap: roadmaps, sharedBy: roadmapShares.sharedBy, sharedAt: roadmapShares.sharedAt })
    .from(roadmapShares)
    .innerJoin(roadmaps, eq(roadmaps.id, roadmapShares.roadmapId))
    .where(eq(roadmapShares.groupId, groupId));
  if (!shares.length) return [];
  const members = await activeMemberIds(s.db, groupId);
  const roadmapIds = shares.map((x) => x.roadmap.id);
  const follows = await s.db
    .select()
    .from(roadmapFollows)
    .where(and(inArray(roadmapFollows.roadmapId, roadmapIds), inArray(roadmapFollows.userId, members)));
  const totals = await s.db
    .select({ roadmapId: roadmapItems.roadmapId, n: sql<number>`count(*)` })
    .from(roadmapItems)
    .where(inArray(roadmapItems.roadmapId, roadmapIds))
    .groupBy(roadmapItems.roadmapId);
  const tz = await tzOf(s.db, userId);
  const weekStart = new Date(localDayBounds(addDays(instantToLocalDate(s.now(), tz), -6), tz).start);
  const done = await s.db
    .select({
      roadmapId: roadmapItems.roadmapId,
      userId: itemProgress.userId,
      done: sql<number>`count(*)`,
      thisWeek: sql<number>`count(*) filter (where ${itemProgress.doneAt} >= ${weekStart.toISOString()})`,
    })
    .from(itemProgress)
    .innerJoin(roadmapItems, eq(roadmapItems.id, itemProgress.itemId))
    .where(and(inArray(roadmapItems.roadmapId, roadmapIds), inArray(itemProgress.userId, members), eq(itemProgress.status, "done")))
    .groupBy(roadmapItems.roadmapId, itemProgress.userId);
  const people = await profilesByIds(s.db, [...new Set([...members, ...shares.map((x) => x.roadmap.ownerId)])]);

  return shares
    .map(({ roadmap: r, sharedAt }) => {
      const total = Number(totals.find((t) => t.roadmapId === r.id)?.n ?? 0);
      const followers = follows
        .filter((f) => f.roadmapId === r.id)
        .map((f) => {
          const d = done.find((x) => x.roadmapId === r.id && x.userId === f.userId);
          const p = people.get(f.userId);
          return { user: p ? publicProfile(p) : null, active: f.active, done: Number(d?.done ?? 0), doneThisWeek: Number(d?.thisWeek ?? 0) };
        })
        .sort((a, b) => b.done - a.done);
      const owner = people.get(r.ownerId);
      const isGroupRoadmap = members.length > 1 && followers.length === members.length;
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        archived: !!r.archivedAt,
        owner: owner ? publicProfile(owner) : null,
        isOwner: r.ownerId === userId,
        sharedAt,
        total,
        memberCount: members.length,
        followers,
        iFollow: follows.some((f) => f.roadmapId === r.id && f.userId === userId),
        isGroupRoadmap,
        /** Everyone but a few follow it — show a gentle "join the group roadmap" prompt. */
        almostGroup: !isGroupRoadmap && members.length > 1 && followers.length >= Math.ceil(members.length / 2),
      };
    })
    .sort((a, b) => Number(b.isGroupRoadmap) - Number(a.isGroupRoadmap) || b.followers.length - a.followers.length || a.title.localeCompare(b.title));
}

/** Groups (that the user is in) where a roadmap is shared — used to award points. */
export async function groupsSharingRoadmap(db: Tx, userId: string, roadmapId: string) {
  return db
    .select({ groupId: roadmapShares.groupId })
    .from(roadmapShares)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, roadmapShares.groupId), eq(groupMembers.userId, userId), eq(groupMembers.status, "active")))
    .where(eq(roadmapShares.roadmapId, roadmapId));
}

