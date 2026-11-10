import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  CATEGORY_META,
  defaultMinutes,
  followSettingsSchema,
  instantToLocalDate,
  parseProblemUrl,
  parseRoadmapLine,
  projectedFinish,
  revisionConfig,
  type Category,
  type FollowPatch,
  type FollowSettings,
} from "@momentum/shared";
import type { Services } from "../../core/context.js";
import type { Tx } from "../../core/db/index.js";
import { externalEvents, integrationConnections, itemProgress, roadmapFollows, roadmapItems, roadmaps } from "../../core/db/schema.js";
import { badRequest, conflict, forbidden, notFound } from "../../core/http.js";
import { tzOf } from "../planning/schedules.js";
import { manualSync } from "../platforms/service.js";
import { ACCEPTED } from "../platforms/types.js";
import { applyRevisionSetting, startCard } from "../repetition/service.js";
import { fetchPlaylist, parsePlaylistId } from "./youtube.js";

export type Roadmap = typeof roadmaps.$inferSelect;
export type RoadmapItem = typeof roadmapItems.$inferSelect;
type Follow = typeof roadmapFollows.$inferSelect;

const MAX_ITEMS = 500;

/* ---------------------------------------------------------------- access */

/**
 * Who may see a roadmap: its owner and its followers. Other modules (groups) can widen this —
 * e.g. members of a group the roadmap is shared in — by registering an access rule.
 */
type AccessRule = (db: Tx, userId: string, roadmapId: string) => Promise<boolean>;
const accessRules: AccessRule[] = [];
export function registerRoadmapAccessRule(rule: AccessRule) {
  accessRules.push(rule);
}

async function canView(db: Tx, userId: string, r: Roadmap): Promise<boolean> {
  if (r.ownerId === userId) return true;
  const f = await db.query.roadmapFollows.findFirst({ where: and(eq(roadmapFollows.roadmapId, r.id), eq(roadmapFollows.userId, userId)) });
  if (f) return true;
  for (const rule of accessRules) if (await rule(db, userId, r.id)) return true;
  return false;
}

export async function requireViewable(db: Tx, userId: string, roadmapId: string): Promise<Roadmap> {
  const r = await db.query.roadmaps.findFirst({ where: eq(roadmaps.id, roadmapId) });
  if (!r || !(await canView(db, userId, r))) throw notFound("Roadmap"); // no existence leak
  return r;
}

async function requireOwner(db: Tx, userId: string, roadmapId: string): Promise<Roadmap> {
  const r = await requireViewable(db, userId, roadmapId);
  if (r.ownerId !== userId) throw forbidden("Only the roadmap's owner can change it");
  if (r.archivedAt) throw badRequest("This roadmap was archived by its owner", "archived");
  return r;
}

/* ---------------------------------------------------------------- roadmaps */

export async function createRoadmap(s: Services, userId: string, input: { title: string; description?: string | null; follow?: FollowPatch }) {
  const r = await s.db.transaction(async (tx) => {
    const [row] = await tx.insert(roadmaps).values({ ownerId: userId, title: input.title, description: input.description ?? null }).returning();
    await tx.insert(roadmapFollows).values({ userId, roadmapId: row!.id, settings: followSettingsSchema.parse(input.follow ?? {}), startedAt: new Date(s.now()) });
    return row!;
  });
  await s.events.emit("follow.changed", { userId, roadmapId: r.id });
  return r;
}

export async function updateRoadmap(s: Services, userId: string, roadmapId: string, patch: { title?: string; description?: string | null }) {
  await requireOwner(s.db, userId, roadmapId);
  const [row] = await s.db
    .update(roadmaps)
    .set({ ...(patch.title ? { title: patch.title } : {}), ...(patch.description !== undefined ? { description: patch.description } : {}) })
    .where(eq(roadmaps.id, roadmapId))
    .returning();
  return row!;
}

/** Deleting a roadmap others follow archives it instead, so their progress isn't lost. */
export async function deleteRoadmap(s: Services, userId: string, roadmapId: string) {
  const r = await requireViewable(s.db, userId, roadmapId);
  if (r.ownerId !== userId) throw forbidden("Only the roadmap's owner can delete it");
  const others = await s.db
    .select({ id: roadmapFollows.id })
    .from(roadmapFollows)
    .where(and(eq(roadmapFollows.roadmapId, roadmapId), sql`${roadmapFollows.userId} <> ${userId}`))
    .limit(1);
  if (others.length) {
    await s.db.update(roadmaps).set({ archivedAt: new Date(s.now()) }).where(eq(roadmaps.id, roadmapId));
    await s.db.delete(roadmapFollows).where(and(eq(roadmapFollows.roadmapId, roadmapId), eq(roadmapFollows.userId, userId)));
    await s.events.emit("follow.changed", { userId, roadmapId });
    return { archived: true };
  }
  await s.db.delete(roadmaps).where(eq(roadmaps.id, roadmapId));
  await s.events.emit("follow.changed", { userId, roadmapId });
  return { archived: false };
}

/** Per-user counts for a set of roadmaps: total items and this user's done/skipped. */
async function progressCounts(db: Tx, userId: string, roadmapIds: string[]) {
  if (!roadmapIds.length) return new Map<string, { total: number; done: number; skipped: number }>();
  const rows = await db
    .select({
      roadmapId: roadmapItems.roadmapId,
      total: sql<number>`count(*)`,
      done: sql<number>`count(*) filter (where ${itemProgress.status} = 'done')`,
      skipped: sql<number>`count(*) filter (where ${itemProgress.status} = 'skipped')`,
    })
    .from(roadmapItems)
    .leftJoin(itemProgress, and(eq(itemProgress.itemId, roadmapItems.id), eq(itemProgress.userId, userId)))
    .where(inArray(roadmapItems.roadmapId, roadmapIds))
    .groupBy(roadmapItems.roadmapId);
  return new Map(rows.map((r) => [r.roadmapId, { total: Number(r.total), done: Number(r.done), skipped: Number(r.skipped) }]));
}

async function followerCounts(db: Tx, roadmapIds: string[]) {
  if (!roadmapIds.length) return new Map<string, number>();
  const rows = await db
    .select({ roadmapId: roadmapFollows.roadmapId, n: sql<number>`count(*)` })
    .from(roadmapFollows)
    .where(inArray(roadmapFollows.roadmapId, roadmapIds))
    .groupBy(roadmapFollows.roadmapId);
  return new Map(rows.map((r) => [r.roadmapId, Number(r.n)]));
}

function summarize(r: Roadmap, userId: string, follow: Follow | undefined, counts: { total: number; done: number; skipped: number } | undefined, followers: number, today: string) {
  const c = counts ?? { total: 0, done: 0, skipped: 0 };
  const remaining = c.total - c.done - c.skipped;
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    ownerId: r.ownerId,
    isOwner: r.ownerId === userId,
    archived: !!r.archivedAt,
    total: c.total,
    done: c.done,
    skipped: c.skipped,
    remaining,
    followers,
    follow: follow ? { settings: follow.settings, active: follow.active, startedAt: follow.startedAt, viaGroupId: follow.viaGroupId } : null,
    projectedFinish: follow?.active ? projectedFinish(remaining, follow.settings, today) : null,
  };
}

/** Roadmaps the user follows or owns, with their own progress. */
export async function listRoadmaps(s: Services, userId: string) {
  const follows = await s.db.select().from(roadmapFollows).where(eq(roadmapFollows.userId, userId));
  const owned = await s.db.select({ id: roadmaps.id }).from(roadmaps).where(and(eq(roadmaps.ownerId, userId), isNull(roadmaps.archivedAt)));
  const ids = [...new Set([...follows.map((f) => f.roadmapId), ...owned.map((o) => o.id)])];
  if (!ids.length) return [];
  const rows = await s.db.select().from(roadmaps).where(inArray(roadmaps.id, ids)).orderBy(asc(roadmaps.title));
  const counts = await progressCounts(s.db, userId, ids);
  const followers = await followerCounts(s.db, ids);
  const today = instantToLocalDate(s.now(), await tzOf(s.db, userId));
  return rows.map((r) => summarize(r, userId, follows.find((f) => f.roadmapId === r.id), counts.get(r.id), followers.get(r.id) ?? 0, today));
}

export async function getRoadmap(s: Services, userId: string, roadmapId: string) {
  const r = await requireViewable(s.db, userId, roadmapId);
  const follow = await s.db.query.roadmapFollows.findFirst({ where: and(eq(roadmapFollows.roadmapId, roadmapId), eq(roadmapFollows.userId, userId)) });
  const items = await s.db.select().from(roadmapItems).where(eq(roadmapItems.roadmapId, roadmapId)).orderBy(asc(roadmapItems.position));
  const progress = items.length
    ? await s.db.select().from(itemProgress).where(and(eq(itemProgress.userId, userId), inArray(itemProgress.itemId, items.map((i) => i.id))))
    : [];
  const byItem = new Map(progress.map((p) => [p.itemId, p]));
  const counts = await progressCounts(s.db, userId, [roadmapId]);
  const followers = await followerCounts(s.db, [roadmapId]);
  const today = instantToLocalDate(s.now(), await tzOf(s.db, userId));
  return {
    ...summarize(r, userId, follow, counts.get(roadmapId), followers.get(roadmapId) ?? 0, today),
    items: items.map((i) => {
      const p = byItem.get(i.id);
      return { ...i, status: p?.status ?? "queued", doneAt: p?.doneAt ?? null, verifiedBy: p?.verifiedBy ?? null };
    }),
  };
}

/* ---------------------------------------------------------------- items */

interface NewItem {
  title: string;
  url: string | null;
  category: Category;
  platform: string | null;
  problemKey: string | null;
  difficulty: string | null;
  estMinutes: number;
  section: string | null;
}

/**
 * Adds items from pasted text, one per line (see `parseRoadmapLine` for the format): problem links,
 * other links and topics, each with an optional title and "(45m)" time; "# Heading" starts a section.
 * Bullets and numbering are ignored. A YouTube playlist link adds every video.
 * Titles of LeetCode/Codeforces problems are filled in in the background (provider rate limits),
 * except where the line gave its own title or time.
 */
export async function addItems(s: Services, userId: string, roadmapId: string, text: string) {
  await requireOwner(s.db, userId, roadmapId);
  const lines = text.split(/\r?\n/).map(parseRoadmapLine).filter((l) => l !== null);
  if (!lines.some((l) => l.kind === "item")) throw badRequest("Paste at least one link or line");
  const items: NewItem[] = [];
  /** Per item (same index as `items`): what the line set itself, so enrichment won't overwrite it. */
  const own: Array<{ title: boolean; minutes: boolean }> = [];
  const push = (it: NewItem, title: boolean, minutes: boolean) => {
    items.push(it);
    own.push({ title, minutes });
  };
  let section: string | null = null;
  for (const line of lines) {
    if (line.kind === "heading") {
      section = line.title.slice(0, 80);
      continue;
    }
    const playlistId = line.url ? parsePlaylistId(line.url) : null;
    if (playlistId) {
      const pl = await fetchPlaylist(playlistId, s.platforms.fetch).catch((err: Error) => {
        throw badRequest(err.message, "youtube_unavailable");
      });
      for (const v of pl.items) {
        push({ title: v.title, url: v.url, category: "other", platform: null, problemKey: null, difficulty: null, estMinutes: Math.max(5, Math.round(v.durationSeconds / 60)), section: section ?? pl.title.slice(0, 80) }, true, true);
      }
      continue;
    }
    const p = line.url ? parseProblemUrl(line.url) : null;
    if (p) {
      const verifiable = CATEGORY_META[p.category].verifiable && !!s.platforms.get(p.category);
      push(
        {
          title: (line.title ?? p.titleGuess).slice(0, 200),
          url: p.url,
          category: p.category,
          platform: verifiable ? p.category : null,
          problemKey: p.key,
          difficulty: null,
          estMinutes: line.minutes ?? defaultMinutes(null),
          section,
        },
        line.title !== null,
        line.minutes !== null,
      );
    } else {
      const title = line.title ?? line.url ?? "";
      push({ title: title.slice(0, 200), url: null, category: "other", platform: null, problemKey: null, difficulty: null, estMinutes: line.minutes ?? 30, section }, true, true);
    }
  }
  const [{ n } = { n: 0 }] = await s.db.select({ n: sql<number>`count(*)` }).from(roadmapItems).where(eq(roadmapItems.roadmapId, roadmapId));
  if (Number(n) + items.length > MAX_ITEMS) throw badRequest(`A roadmap can hold up to ${MAX_ITEMS} items`);
  const [{ maxPos } = { maxPos: -1 }] = await s.db
    .select({ maxPos: sql<number>`coalesce(max(${roadmapItems.position}), -1)` })
    .from(roadmapItems)
    .where(eq(roadmapItems.roadmapId, roadmapId));
  const start = Number(maxPos) + 1;
  const inserted = items.length
    ? await s.db
        .insert(roadmapItems)
        .values(items.map((it, i) => ({ ...it, roadmapId, position: start + i })))
        .returning()
    : [];
  // Match rows back to their lines by position (RETURNING order isn't guaranteed).
  const toEnrich = inserted.filter((i) => i.platform && i.problemKey).map((item) => ({ item, own: own[item.position - start]! }));
  const enrich = enrichItems(s, toEnrich);
  // Small additions are resolved before responding; large pastes finish in the background.
  if (inserted.length <= 5) await enrich;
  else enrich.catch((err) => console.error("[roadmaps] enrich failed:", err instanceof Error ? err.message : err));
  await s.events.emit("roadmap.items_changed", { roadmapId });
  return { added: inserted.length };
}

/** Fills in real titles, difficulty and estimates from the platform, keeping what the line set itself. */
async function enrichItems(s: Services, items: Array<{ item: RoadmapItem; own: { title: boolean; minutes: boolean } }>) {
  for (const { item: it, own } of items) {
    const info = await s.platforms.get(it.platform!)?.problemInfo?.(it.problemKey!);
    if (!info) continue;
    await s.db
      .update(roadmapItems)
      .set({
        difficulty: info.difficulty,
        url: info.url,
        ...(own.title ? {} : { title: info.title }),
        ...(own.minutes ? {} : { estMinutes: defaultMinutes(info.difficulty) }),
      })
      .where(eq(roadmapItems.id, it.id));
  }
}

export async function updateItem(s: Services, userId: string, itemId: string, patch: { title?: string; estMinutes?: number; section?: string | null }) {
  const item = await s.db.query.roadmapItems.findFirst({ where: eq(roadmapItems.id, itemId) });
  if (!item) throw notFound("Item");
  await requireOwner(s.db, userId, item.roadmapId);
  const row = await s.db.transaction(async (tx) => {
    const [updated] = await tx.update(roadmapItems).set(patch).where(eq(roadmapItems.id, itemId)).returning();
    // Moved to another section that already exists: place it at the end of that section, so the
    // section stays in one piece instead of appearing twice in the list.
    if (patch.section !== undefined && patch.section !== item.section && patch.section !== null) {
      const ordered = await tx.select({ id: roadmapItems.id, section: roadmapItems.section }).from(roadmapItems).where(eq(roadmapItems.roadmapId, item.roadmapId)).orderBy(asc(roadmapItems.position));
      const rest = ordered.filter((i) => i.id !== itemId);
      const lastInSection = rest.map((i) => i.section).lastIndexOf(patch.section);
      if (lastInSection >= 0) {
        rest.splice(lastInSection + 1, 0, { id: itemId, section: patch.section });
        for (const [i, it] of rest.entries()) await tx.update(roadmapItems).set({ position: i }).where(eq(roadmapItems.id, it.id));
        updated!.position = rest.findIndex((i) => i.id === itemId);
      }
    }
    return updated!;
  });
  await s.events.emit("roadmap.items_changed", { roadmapId: item.roadmapId });
  return row;
}

export async function deleteItem(s: Services, userId: string, itemId: string) {
  const item = await s.db.query.roadmapItems.findFirst({ where: eq(roadmapItems.id, itemId) });
  if (!item) throw notFound("Item");
  await requireOwner(s.db, userId, item.roadmapId);
  await s.db.delete(roadmapItems).where(eq(roadmapItems.id, itemId));
  await s.events.emit("roadmap.items_changed", { roadmapId: item.roadmapId });
}

export async function reorderItems(s: Services, userId: string, roadmapId: string, itemIds: string[]) {
  await requireOwner(s.db, userId, roadmapId);
  const current = await s.db.select({ id: roadmapItems.id }).from(roadmapItems).where(eq(roadmapItems.roadmapId, roadmapId));
  if (current.length !== itemIds.length || !current.every((c) => itemIds.includes(c.id))) {
    throw badRequest("Send every item of the roadmap exactly once");
  }
  await s.db.transaction(async (tx) => {
    for (const [i, id] of itemIds.entries()) await tx.update(roadmapItems).set({ position: i }).where(eq(roadmapItems.id, id));
  });
  await s.events.emit("roadmap.items_changed", { roadmapId });
}

/* ---------------------------------------------------------------- following */

export async function follow(s: Services, userId: string, roadmapId: string, settings: FollowPatch, viaGroupId: string | null = null) {
  const r = await requireViewable(s.db, userId, roadmapId);
  if (r.archivedAt) throw badRequest("This roadmap was archived by its owner", "archived");
  const parsed = followSettingsSchema.parse(settings);
  const [row] = await s.db
    .insert(roadmapFollows)
    .values({ userId, roadmapId, settings: parsed, active: parsed.active, viaGroupId, startedAt: new Date(s.now()) })
    .onConflictDoUpdate({ target: [roadmapFollows.userId, roadmapFollows.roadmapId], set: { settings: parsed, active: parsed.active } })
    .returning();
  await syncCards(s, userId, roadmapId, parsed);
  await s.events.emit("follow.changed", { userId, roadmapId });
  return row!;
}

/** Changes pace, revision or preferred time at any time; revision changes reschedule cards now. */
export async function updateFollow(s: Services, userId: string, roadmapId: string, patch: FollowPatch) {
  const current = await s.db.query.roadmapFollows.findFirst({ where: and(eq(roadmapFollows.roadmapId, roadmapId), eq(roadmapFollows.userId, userId)) });
  if (!current) throw notFound("Follow");
  const merged = followSettingsSchema.parse({ ...current.settings, ...patch, custom: { ...current.settings.custom, ...(patch.custom ?? {}) } });
  const [row] = await s.db
    .update(roadmapFollows)
    .set({ settings: merged, active: merged.active })
    .where(eq(roadmapFollows.id, current.id))
    .returning();
  if (merged.revision !== current.settings.revision || JSON.stringify(merged.custom) !== JSON.stringify(current.settings.custom)) {
    await syncCards(s, userId, roadmapId, merged);
  }
  await s.events.emit("follow.changed", { userId, roadmapId });
  return row!;
}

async function syncCards(s: Services, userId: string, roadmapId: string, settings: FollowSettings) {
  const items = await s.db.select({ id: roadmapItems.id }).from(roadmapItems).where(eq(roadmapItems.roadmapId, roadmapId));
  await applyRevisionSetting(s.db, userId, items.map((i) => i.id), revisionConfig(settings));
}

/** Unfollowing keeps progress and revisions (suspended) in case the user follows again. */
export async function unfollow(s: Services, userId: string, roadmapId: string) {
  const [row] = await s.db
    .delete(roadmapFollows)
    .where(and(eq(roadmapFollows.roadmapId, roadmapId), eq(roadmapFollows.userId, userId)))
    .returning({ id: roadmapFollows.id });
  if (!row) throw notFound("Follow");
  const items = await s.db.select({ id: roadmapItems.id }).from(roadmapItems).where(eq(roadmapItems.roadmapId, roadmapId));
  await applyRevisionSetting(s.db, userId, items.map((i) => i.id), null);
  await s.events.emit("follow.changed", { userId, roadmapId });
}

/* ---------------------------------------------------------------- item progress */

/**
 * Marks an item learned and starts its spaced repetition. Called when a plan task for the item
 * is completed, or from the roadmap page. Idempotent.
 */
export async function completeItem(s: Services, userId: string, itemId: string, verifiedBy: "submission" | "self", at?: Date) {
  const item = await s.db.query.roadmapItems.findFirst({ where: eq(roadmapItems.id, itemId) });
  if (!item) throw notFound("Item");
  const follow = await s.db.query.roadmapFollows.findFirst({ where: and(eq(roadmapFollows.roadmapId, item.roadmapId), eq(roadmapFollows.userId, userId)) });
  const now = s.now();
  const doneAt = at && at.getTime() <= now ? at : new Date(now);
  const today = instantToLocalDate(now, await tzOf(s.db, userId));
  const existing = await s.db.query.itemProgress.findFirst({ where: and(eq(itemProgress.userId, userId), eq(itemProgress.itemId, itemId)) });
  if (existing?.status === "done") return { alreadyDone: true };
  await s.db
    .insert(itemProgress)
    .values({ userId, itemId, status: "done", doneAt, verifiedBy })
    .onConflictDoUpdate({ target: [itemProgress.userId, itemProgress.itemId], set: { status: "done", doneAt, verifiedBy } });
  const revision = follow ? revisionConfig(follow.settings) : null;
  if (revision) {
    await startCard(s.db, userId, { itemId, category: item.category, platform: item.platform, problemKey: item.problemKey, title: item.title, url: item.url }, revision, today);
  }
  await s.events.emit("roadmap.item_done", { userId, roadmapId: item.roadmapId, itemId, verifiedBy, at: doneAt });
  return { alreadyDone: false };
}

/**
 * "Mark done" from the roadmap page. LeetCode/Codeforces items need an accepted submission of
 * that problem (a sync is attempted first); other items are self-reported.
 */
export async function markItemDone(s: Services, userId: string, itemId: string) {
  const item = await s.db.query.roadmapItems.findFirst({ where: eq(roadmapItems.id, itemId) });
  if (!item) throw notFound("Item");
  await requireViewable(s.db, userId, item.roadmapId);
  if (!item.platform || !item.problemKey) return completeItem(s, userId, itemId, "self");
  const conn = await s.db.query.integrationConnections.findFirst({
    where: and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, item.platform)),
  });
  if (!conn || conn.status === "disconnected") {
    throw badRequest(`Connect your ${CATEGORY_META[item.category as Category]?.label ?? item.platform} handle in Settings to verify this problem`, "not_connected");
  }
  let solvedAt = await lastAccepted(s, userId, item.platform, item.problemKey);
  if (!solvedAt) {
    await manualSync(s, userId, item.platform).catch(() => undefined);
    solvedAt = await lastAccepted(s, userId, item.platform, item.problemKey);
    if (!solvedAt) throw conflict("No accepted submission for this problem yet. Solve it, then check again.", "not_verified");
  }
  return completeItem(s, userId, itemId, "submission", solvedAt);
}

/** Time of the latest accepted submission of a problem, if any. */
async function lastAccepted(s: Services, userId: string, provider: string, problemKey: string): Promise<Date | null> {
  const [row] = await s.db
    .select({ at: externalEvents.occurredAt })
    .from(externalEvents)
    .where(
      and(
        eq(externalEvents.userId, userId),
        eq(externalEvents.provider, provider),
        eq(externalEvents.type, ACCEPTED),
        sql`${externalEvents.data}->>'problemKey' = ${problemKey}`,
      ),
    )
    .orderBy(desc(externalEvents.occurredAt))
    .limit(1);
  return row?.at ?? null;
}

/** Skip an item (or put a skipped/done item back in the queue). */
export async function setItemQueued(s: Services, userId: string, itemId: string, status: "skipped" | "queued") {
  const item = await s.db.query.roadmapItems.findFirst({ where: eq(roadmapItems.id, itemId) });
  if (!item) throw notFound("Item");
  await requireViewable(s.db, userId, item.roadmapId);
  if (status === "queued") {
    await s.db.delete(itemProgress).where(and(eq(itemProgress.userId, userId), eq(itemProgress.itemId, itemId)));
  } else {
    await s.db
      .insert(itemProgress)
      .values({ userId, itemId, status: "skipped" })
      .onConflictDoUpdate({ target: [itemProgress.userId, itemProgress.itemId], set: { status: "skipped", doneAt: null, verifiedBy: null } });
  }
  await s.events.emit("follow.changed", { userId, roadmapId: item.roadmapId });
  return { ok: true };
}
