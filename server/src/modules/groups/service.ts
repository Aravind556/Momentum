import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { DEFAULT_POINTS, pointsConfigSchema, type PointsConfig } from "@cadence/shared";
import type { Tx } from "../../core/db/index.js";
import { groupInvites, groupMembers, groups, profiles } from "../../core/db/schema.js";
import { inviteCode } from "../../core/ids.js";
import { badRequest, forbidden, notFound } from "../../core/http.js";
import type { Services } from "../../core/context.js";
import { notifyMany } from "../notify/notify.js";
import { publicProfile, profilesByIds } from "../profile/service.js";
import { computeStreak } from "../progress/service.js";

export type Membership = typeof groupMembers.$inferSelect;

export async function isActiveMember(db: Tx, groupId: string, userId: string): Promise<boolean> {
  const m = await db.query.groupMembers.findFirst({
    where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId), eq(groupMembers.status, "active")),
  });
  return !!m;
}

/** Server-side authorization for everything inside a group. Non-members get 404 (no existence leak). */
export async function requireMember(db: Tx, groupId: string, userId: string): Promise<Membership> {
  const m = await db.query.groupMembers.findFirst({
    where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId), eq(groupMembers.status, "active")),
  });
  if (!m) throw notFound("Group");
  return m;
}

async function requireAdmin(db: Tx, groupId: string, userId: string) {
  const m = await requireMember(db, groupId, userId);
  if (m.role === "member") throw forbidden("Only the group owner or admins can do this");
  return m;
}

/** Active member ids of a group. */
export async function activeMemberIds(db: Tx, groupId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, "active")));
  return rows.map((r) => r.userId);
}

export async function createGroup(s: Services, userId: string, input: { name: string; description?: string | null }) {
  return s.db.transaction(async (tx) => {
    const [g] = await tx
      .insert(groups)
      .values({ name: input.name, description: input.description ?? null, ownerId: userId, points: DEFAULT_POINTS })
      .returning();
    await tx.insert(groupMembers).values({ groupId: g!.id, userId, role: "owner" });
    return g!;
  });
}

export async function listMyGroups(s: Services, userId: string) {
  const rows = await s.db
    .select({ group: groups, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.status, "active")))
    .orderBy(asc(groups.name));
  if (!rows.length) return [];
  const counts = await s.db
    .select({ groupId: groupMembers.groupId, n: sql<number>`count(*)` })
    .from(groupMembers)
    .where(and(inArray(groupMembers.groupId, rows.map((r) => r.group.id)), eq(groupMembers.status, "active")))
    .groupBy(groupMembers.groupId);
  const countMap = new Map(counts.map((c) => [c.groupId, Number(c.n)]));
  return rows.map((r) => ({ ...r.group, role: r.role, memberCount: countMap.get(r.group.id) ?? 0 }));
}

export async function updateGroup(
  s: Services,
  userId: string,
  groupId: string,
  patch: { name?: string; description?: string | null; points?: Partial<PointsConfig> },
) {
  await requireAdmin(s.db, groupId, userId);
  const current = (await s.db.query.groups.findFirst({ where: eq(groups.id, groupId) }))!;
  const [row] = await s.db
    .update(groups)
    .set({
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      points: patch.points ? pointsConfigSchema.parse({ ...current.points, ...patch.points }) : current.points,
    })
    .where(eq(groups.id, groupId))
    .returning();
  return row!;
}

export async function deleteGroup(s: Services, userId: string, groupId: string) {
  const m = await requireMember(s.db, groupId, userId);
  if (m.role !== "owner") throw forbidden("Only the owner can delete a group");
  await s.db.delete(groups).where(eq(groups.id, groupId));
}

/* ---------------------------------------------------------------- invitations */

export async function createInvitation(s: Services, userId: string, groupId: string, opts: { days?: number }) {
  await requireMember(s.db, groupId, userId);
  const days = Math.min(Math.max(opts.days ?? 7, 1), 30);
  const [inv] = await s.db
    .insert(groupInvites)
    .values({ groupId, inviterId: userId, code: inviteCode(), expiresAt: new Date(s.now() + days * 86_400_000) })
    .returning();
  return inv!;
}

export async function listInvitations(s: Services, userId: string, groupId: string) {
  await requireMember(s.db, groupId, userId);
  return s.db
    .select()
    .from(groupInvites)
    .where(and(eq(groupInvites.groupId, groupId), sql`${groupInvites.revokedAt} is null`, gte(groupInvites.expiresAt, new Date(s.now()))))
    .orderBy(desc(groupInvites.createdAt));
}

export async function revokeInvitation(s: Services, userId: string, invitationId: string) {
  const inv = await s.db.query.groupInvites.findFirst({ where: eq(groupInvites.id, invitationId) });
  if (!inv) throw notFound("Invitation");
  const m = await requireMember(s.db, inv.groupId, userId);
  if (inv.inviterId !== userId && m.role === "member") throw forbidden("Only the inviter or an admin can revoke this");
  await s.db.update(groupInvites).set({ revokedAt: new Date(s.now()) }).where(eq(groupInvites.id, invitationId));
}

/** Public preview of an invitation code: only the group name and member count. */
export async function previewInvitation(s: Services, code: string) {
  const inv = await s.db.query.groupInvites.findFirst({ where: eq(groupInvites.code, code.trim().toUpperCase()) });
  if (!inv || inv.revokedAt || inv.expiresAt.getTime() < s.now() || inv.uses >= inv.maxUses) throw notFound("Invitation");
  const g = (await s.db.query.groups.findFirst({ where: eq(groups.id, inv.groupId) }))!;
  const members = await activeMemberIds(s.db, g.id);
  return { groupId: g.id, name: g.name, description: g.description, memberCount: members.length };
}

/** Validates and redeems an invitation atomically (row lock prevents over-use under concurrency). */
export async function acceptInvitation(s: Services, userId: string, code: string) {
  const now = s.now();
  const result = await s.db.transaction(async (tx) => {
    const [inv] = await tx.select().from(groupInvites).where(eq(groupInvites.code, code.trim().toUpperCase())).for("update");
    if (!inv || inv.revokedAt) throw notFound("Invitation");
    if (inv.expiresAt.getTime() < now) throw badRequest("This invitation has expired", "invite_expired");
    if (inv.uses >= inv.maxUses) throw badRequest("This invitation has been used up", "invite_exhausted");

    const existing = await tx.query.groupMembers.findFirst({
      where: and(eq(groupMembers.groupId, inv.groupId), eq(groupMembers.userId, userId)),
    });
    if (existing?.status === "active") return { groupId: inv.groupId, alreadyMember: true };
    if (existing?.status === "removed") throw forbidden("You were removed from this group. Ask an admin to re-add you.");
    if (existing) {
      await tx.update(groupMembers).set({ status: "active", role: "member", joinedAt: new Date(now) }).where(eq(groupMembers.id, existing.id));
    } else {
      await tx.insert(groupMembers).values({ groupId: inv.groupId, userId, role: "member" });
    }
    await tx.update(groupInvites).set({ uses: inv.uses + 1 }).where(eq(groupInvites.id, inv.id));

    const profile = await tx.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
    const admins = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, inv.groupId), eq(groupMembers.status, "active"), or(eq(groupMembers.role, "owner"), eq(groupMembers.role, "admin"))));
    await notifyMany(
      tx,
      admins.map((a) => a.userId).filter((id) => id !== userId),
      "group",
      { message: `${profile?.displayName ?? "Someone"} joined your group`, link: `/groups/${inv.groupId}` },
      `joined:${inv.groupId}:${userId}:${now}`,
    );
    return { groupId: inv.groupId, alreadyMember: false };
  });
  if (!result.alreadyMember) await s.events.emit("group.member_joined", { groupId: result.groupId, userId });
  return result;
}

/** Leaving keeps history. An owner hands ownership to the longest-standing admin or member; a last member deletes the group. */
export async function leaveGroup(s: Services, userId: string, groupId: string) {
  const result = await s.db.transaction(async (tx) => {
    const m = await requireMember(tx, groupId, userId);
    if (m.role === "owner") {
      const [successor] = await tx
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, "active"), sql`${groupMembers.userId} <> ${userId}`))
        .orderBy(sql`case ${groupMembers.role} when 'admin' then 0 else 1 end`, asc(groupMembers.joinedAt))
        .limit(1);
      if (!successor) {
        await tx.delete(groups).where(eq(groups.id, groupId));
        return { deleted: true };
      }
      await tx.update(groupMembers).set({ role: "owner" }).where(eq(groupMembers.id, successor.id));
      await tx.update(groups).set({ ownerId: successor.userId }).where(eq(groups.id, groupId));
    }
    await tx.update(groupMembers).set({ status: "left", role: "member" }).where(eq(groupMembers.id, m.id));
    return { deleted: false };
  });
  if (!result.deleted) await s.events.emit("group.member_left", { groupId, userId });
  return result;
}

export async function removeMember(s: Services, actorId: string, groupId: string, targetUserId: string) {
  await s.db.transaction(async (tx) => {
    const actor = await requireAdmin(tx, groupId, actorId);
    if (actorId === targetUserId) throw badRequest("Use 'leave' to leave a group");
    const target = await requireMember(tx, groupId, targetUserId).catch(() => {
      throw notFound("Member");
    });
    if (target.role === "owner") throw forbidden("The owner cannot be removed");
    if (target.role === "admin" && actor.role !== "owner") throw forbidden("Only the owner can remove an admin");
    await tx.update(groupMembers).set({ status: "removed" }).where(eq(groupMembers.id, target.id));
  });
  await s.events.emit("group.member_left", { groupId, userId: targetUserId });
  return { ok: true };
}

export async function setMemberRole(s: Services, actorId: string, groupId: string, targetUserId: string, role: "admin" | "member") {
  const actor = await requireMember(s.db, groupId, actorId);
  if (actor.role !== "owner") throw forbidden("Only the owner can change roles");
  const target = await requireMember(s.db, groupId, targetUserId);
  if (target.role === "owner") throw badRequest("The owner's role cannot be changed");
  await s.db.update(groupMembers).set({ role }).where(eq(groupMembers.id, target.id));
  return { ok: true };
}

export async function listMembers(s: Services, userId: string, groupId: string) {
  await requireMember(s.db, groupId, userId);
  const rows = await s.db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, "active")));
  const profs = await profilesByIds(s.db, rows.map((r) => r.userId));
  return rows.map((r) => ({ ...publicProfile(profs.get(r.userId)!), role: r.role, joinedAt: r.joinedAt }));
}

/* ---------------------------------------------------------------- overview */

/** Group header data: the group, your role, and members with their streaks. */
export async function groupOverview(s: Services, userId: string, groupId: string) {
  const me = await requireMember(s.db, groupId, userId);
  const group = (await s.db.query.groups.findFirst({ where: eq(groups.id, groupId) }))!;
  const rows = await s.db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, "active")))
    .orderBy(asc(groupMembers.joinedAt));
  const profs = await profilesByIds(s.db, rows.map((r) => r.userId));
  const members = [];
  for (const m of rows) {
    const p = profs.get(m.userId)!;
    const streak = p.preferences.privacy.shareStreaks ? (await computeStreak(s.db, m.userId, p.timezone, s.now())).current : null;
    members.push({ ...publicProfile(p), role: m.role, joinedAt: m.joinedAt, streak });
  }
  return { group: { ...group, myRole: me.role }, members };
}
