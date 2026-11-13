import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { addDays, dateRange, defaultMinutes, instantToLocalDate, localDayBounds, parseProblemUrl, type VerificationConfig } from "@momentum/shared";
import { externalEvents, integrationConnections, profiles, taskCompletions, tasks } from "../../core/db/schema.js";
import { badRequest, HttpError, notFound } from "../../core/http.js";
import { asBackground } from "./limiter.js";
import { IntegrationError, type ConnectionInfo, type NormalizedEvent } from "./types.js";
import type { Services } from "../../core/context.js";
import { completeTask } from "../tasks/completions.js";
import { isRecurring, occursOn } from "../tasks/recurrence.js";
import { notify } from "../notify/notify.js";

type Connection = typeof integrationConnections.$inferSelect;

function connInfo(c: Connection): ConnectionInfo {
  return { externalAccountId: c.externalAccountId };
}

function toHttp(err: unknown): never {
  if (err instanceof IntegrationError) {
    const status = err.kind === "not_found" ? 404 : err.kind === "rate_limited" ? 429 : err.kind === "auth" ? 401 : 502;
    throw new HttpError(status === 401 ? 400 : status, err.message, `integration_${err.kind}`);
  }
  throw err;
}

export async function listIntegrations(s: Services, userId: string) {
  const conns = await s.db.select().from(integrationConnections).where(eq(integrationConnections.userId, userId));
  return s.platforms.all().map((a) => {
    const c = conns.find((x) => x.provider === a.provider);
    const cfg = a.configured();
    return {
      provider: a.provider,
      label: a.label,
      description: a.description,
      handlePattern: a.handlePattern.source,
      limitations: a.limitations,
      available: cfg.ok,
      unavailableReason: cfg.ok ? null : cfg.reason,
      connection: c
        ? {
            status: c.status,
            externalAccountId: c.externalAccountId,
            lastSyncAt: c.lastSyncAt,
            lastError: c.lastError,
            nextSyncAfter: c.nextSyncAfter,
          }
        : null,
    };
  });
}

async function upsertConnection(s: Services, userId: string, provider: string, accountId: string) {
  const values = {
    userId,
    provider,
    externalAccountId: accountId,
    status: "connected" as const,
    lastError: null,
    failureCount: 0,
    nextSyncAfter: null,
  };
  const [row] = await s.db
    .insert(integrationConnections)
    .values(values)
    .onConflictDoUpdate({ target: [integrationConnections.userId, integrationConnections.provider], set: values })
    .returning();
  return row!;
}

/** Connects a public handle on any registered platform. No password or token is ever requested. */
export async function connectPlatform(s: Services, userId: string, provider: string, handle: string) {
  const adapter = s.platforms.get(provider);
  if (!adapter) throw notFound("Platform");
  const cfg = adapter.configured();
  if (!cfg.ok) throw badRequest(cfg.reason, "integration_unavailable");
  if (!adapter.handlePattern.test(handle)) throw badRequest(`Enter a valid ${adapter.label} handle`);
  const canonical = await adapter.verifyAccount({ externalAccountId: handle }).catch(toHttp);
  await upsertConnection(s, userId, provider, canonical);
  return syncConnection(s, userId, provider).catch(() => ({ ok: false }));
}

/** Disconnects a platform. Existing completion records and submission history are kept as-is. */
export async function disconnect(s: Services, userId: string, provider: string) {
  const c = await s.db.query.integrationConnections.findFirst({
    where: and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, provider)),
  });
  if (!c) throw notFound("Integration");
  await s.db
    .update(integrationConnections)
    .set({ status: "disconnected", nextSyncAfter: null })
    .where(eq(integrationConnections.id, c.id));
}

/**
 * Fetches provider events (idempotent upsert), then verifies matching tasks. Provider failures update
 * only the connection's status/backoff — never the verification status of any task.
 */
export async function syncConnection(s: Services, userId: string, provider: string, opts: { force?: boolean } = {}) {
  const now = s.now();
  const conn = await s.db.query.integrationConnections.findFirst({
    where: and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, provider)),
  });
  if (!conn || conn.status === "disconnected") throw notFound("Integration");
  if (!opts.force && conn.nextSyncAfter && conn.nextSyncAfter.getTime() > now) {
    return { ok: false, skipped: true, retryAt: conn.nextSyncAfter };
  }
  const adapter = s.platforms.get(provider)!;
  const firstSync = !conn.lastSyncAt;
  // Overlap the previous sync by two days (late-arriving data); a first sync imports a year of history.
  const since = firstSync ? new Date(now - 365 * 86_400_000) : new Date(Math.min(conn.lastSyncAt!.getTime(), now) - 2 * 86_400_000);
  const referenceData = !!adapter.referenceEventTypes?.length && (await needsReferenceData(s, userId, provider));

  let events: NormalizedEvent[];
  try {
    events = await adapter.fetchEvents(connInfo(conn), since, { referenceData, firstSync });
  } catch (err) {
    const failureCount = conn.failureCount + 1;
    const ie = err instanceof IntegrationError ? err : new IntegrationError("Unexpected provider error", "unavailable");
    const backoff = ie.retryAfterMs ?? Math.min(6 * 3600_000, 5 * 60_000 * 2 ** (failureCount - 1));
    await s.db
      .update(integrationConnections)
      .set({
        status: "error",
        lastError: ie.kind === "auth" ? "Access expired or was revoked — reconnect to resume verification." : ie.message,
        failureCount,
        nextSyncAfter: new Date(now + backoff),
      })
      .where(eq(integrationConnections.id, conn.id));
    if (ie.kind === "auth") {
      await notify(s.db, userId, "integration", { message: `${adapter.label} access expired. Reconnect to keep verifying tasks.` }, `integration-auth:${provider}:${instantToLocalDate(now, "UTC")}`);
    }
    return { ok: false, error: ie.message, kind: ie.kind };
  }

  let inserted = 0;
  if (events.length) {
    const rows = await s.db
      .insert(externalEvents)
      .values(events.map((e) => ({ userId, provider, externalId: e.externalId, type: e.type, occurredAt: e.occurredAt, data: e.data })))
      .onConflictDoNothing()
      .returning({ id: externalEvents.id });
    inserted = rows.length;
  }
  await s.db
    .update(integrationConnections)
    .set({ status: "connected", lastError: null, failureCount: 0, nextSyncAfter: null, lastSyncAt: new Date(now) })
    .where(eq(integrationConnections.id, conn.id));

  const verified = await verifyTasks(s, userId, provider);
  if (inserted > 0) await s.events.emit("submissions.synced", { userId, provider, newEvents: inserted });
  return { ok: true, fetched: events.length, newEvents: inserted, verified };
}

/** Only users with a POTD-style task need the provider's reference data (saves requests). */
async function needsReferenceData(s: Services, userId: string, provider: string) {
  const [row] = await s.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, userId),
        sql`${tasks.verification}->>'provider' = ${provider}`,
        sql`${tasks.verification}->>'mode' = 'potd'`,
        sql`${tasks.status} not in ('completed', 'cancelled')`,
      ),
    )
    .limit(1);
  return !!row;
}

export const MANUAL_SYNC_COOLDOWN_MS = 60_000;

/**
 * "Sync now" from a person. Within the cooldown it returns the last result without calling the
 * provider, so repeated clicks can't trip rate limits.
 */
export async function manualSync(s: Services, userId: string, provider: string) {
  const now = s.now();
  const conn = await s.db.query.integrationConnections.findFirst({
    where: and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, provider)),
  });
  if (!conn || conn.status === "disconnected") throw notFound("Integration");
  const nextAllowedAt = conn.lastManualSyncAt ? conn.lastManualSyncAt.getTime() + MANUAL_SYNC_COOLDOWN_MS : 0;
  if (nextAllowedAt > now) {
    return { ok: conn.status === "connected", cooldown: true, lastSyncAt: conn.lastSyncAt, nextAllowedAt: new Date(nextAllowedAt) };
  }
  await s.db.update(integrationConnections).set({ lastManualSyncAt: new Date(now) }).where(eq(integrationConnections.id, conn.id));
  const result = await syncConnection(s, userId, provider, { force: true });
  return { ...result, cooldown: false, nextAllowedAt: new Date(now + MANUAL_SYNC_COOLDOWN_MS) };
}

/** Evaluates tasks configured for this provider against stored (deduplicated) events. */
export async function verifyTasks(s: Services, userId: string, provider: string) {
  const now = s.now();
  const adapter = s.platforms.get(provider)!;
  const profile = (await s.db.query.profiles.findFirst({ where: eq(profiles.userId, userId) }))!;
  const tz = profile.timezone;
  const today = instantToLocalDate(now, tz);
  const candidates = (
    await s.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.ownerId, userId), sql`${tasks.verification}->>'provider' = ${provider}`, sql`${tasks.status} <> 'cancelled'`))
  ).filter((t) => t.verification.provider === provider);
  if (!candidates.length) return 0;

  const stored = await s.db
    .select()
    .from(externalEvents)
    .where(and(eq(externalEvents.userId, userId), eq(externalEvents.provider, provider), gte(externalEvents.occurredAt, new Date(now - 45 * 86_400_000))));
  const events: NormalizedEvent[] = stored.map((e) => ({ externalId: e.externalId, type: e.type, occurredAt: e.occurredAt, data: e.data }));
  const completions = await s.db
    .select()
    .from(taskCompletions)
    .where(and(inArray(taskCompletions.taskId, candidates.map((t) => t.id)), isNull(taskCompletions.voidedAt)));

  let verified = 0;
  for (const t of candidates) {
    const windows: Array<{ key: string; date?: string; from: number; to: number; closed: boolean }> = [];
    if (isRecurring(t.recurrence)) {
      for (const d of dateRange(addDays(today, -6), today)) {
        if (!occursOn(t.recurrence, d)) continue;
        if (d < instantToLocalDate(t.createdAt.getTime(), tz)) continue;
        // Providers may define their own day (LeetCode's Problem of the Day follows UTC).
        const custom = adapter.occurrenceWindow?.(t.verification, d);
        const local = localDayBounds(d, tz);
        const from = custom?.from ?? local.start;
        const to = custom?.to ?? local.end;
        windows.push({ key: d, date: d, from, to, closed: custom ? to <= now : d < today });
      }
    } else if (t.planDay && adapter.occurrenceWindow?.(t.verification, t.planDay)) {
      // Day-plan work with a provider-defined day (LeetCode's Problem of the Day for date D is
      // live 00:00–24:00 UTC on D): the problem dated D, solved during LeetCode's day D.
      const custom = adapter.occurrenceWindow(t.verification, t.planDay)!;
      windows.push({ key: "once", from: custom.from, to: Math.min(custom.to, now), closed: custom.to <= now });
    } else {
      const from = (t.verifyFrom ?? t.earliestStartAt ?? t.createdAt).getTime();
      // Day-plan work still counts if finished after its due time (it simply ranks after earlier finishers).
      const to = t.planDay ? now : (t.dueAt?.getTime() ?? now);
      windows.push({ key: "once", from, to: Math.min(to, now), closed: !!t.dueAt && t.dueAt.getTime() < now });
    }
    for (const w of windows) {
      const existing = completions.find((c) => c.taskId === t.id && c.occurrenceKey === w.key);
      if (existing?.verificationStatus === "verified") continue;
      const reference = new Set(adapter.referenceEventTypes ?? []);
      const inWindow = events.filter(
        (e) => reference.has(e.type) || (e.occurredAt.getTime() >= w.from && e.occurredAt.getTime() < w.to),
      );
      const result = adapter.evaluate(t.verification, inWindow);
      if (result.satisfied) {
        await completeTask(s, userId, t.id, {
          outcome: "completed",
          ...(w.date ? { occurrenceDate: w.date } : {}),
          integrationEvidence: {
            provider,
            matched: result.matched.slice(0, 20).map((e) => ({ id: e.externalId, at: e.occurredAt.toISOString(), ...e.data })),
            progress: result.progress,
            target: result.target,
          },
        });
        verified += 1;
      } else if (existing && existing.verificationStatus === "pending" && w.closed && !result.indeterminate) {
        // Data was retrieved successfully and the window is over: the criteria were not met.
        await s.db
          .update(taskCompletions)
          .set({ verificationStatus: "failed", evidence: { provider, progress: result.progress, target: result.target } })
          .where(eq(taskCompletions.id, existing.id));
      }
    }
  }
  return verified;
}

/**
 * When a day-plan task's provider-defined day ends (e.g. LeetCode's Problem of the Day dated D:
 * 24:00 UTC on D), or null if it simply follows the learner's own day.
 */
export function providerDayEnd(s: Services, t: { verification: VerificationConfig; planDay: string | null }): number | null {
  if (!t.planDay || t.verification.provider === "none") return null;
  return s.platforms.get(t.verification.provider)?.occurrenceWindow?.(t.verification, t.planDay)?.to ?? null;
}

/**
 * Light background sync, so history stays complete without hammering providers:
 * - users with pending tasks verified by this platform: at most every 2 hours;
 * - everyone else: about twice a day (LeetCode only exposes the last ~20 submissions).
 * Requests are queued behind anything a person is waiting on (see limiter.ts).
 */
export async function syncAllDue(s: Services) {
  const now = s.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const due = await s.db
    .select()
    .from(integrationConnections)
    .where(
      and(
        sql`${integrationConnections.status} <> 'disconnected'`,
        sql`(${integrationConnections.nextSyncAfter} is null or ${integrationConnections.nextSyncAfter} <= ${iso(now)})`,
        sql`(
          ${integrationConnections.lastSyncAt} is null
          or ${integrationConnections.lastSyncAt} <= ${iso(now - 12 * 3600_000)}
          or (${integrationConnections.lastSyncAt} <= ${iso(now - 2 * 3600_000)} and exists (
            select 1 from ${tasks} t
            where t.owner_id = ${integrationConnections.userId}
              and t.verification->>'provider' = ${integrationConnections.provider}
              and t.status not in ('completed', 'cancelled', 'skipped')
          ))
        )`,
      ),
    )
    .orderBy(sql`${integrationConnections.lastSyncAt} asc nulls first`)
    .limit(50);
  await asBackground(async () => {
    for (const c of due) {
      if (!s.platforms.get(c.provider)?.configured().ok) continue;
      await syncConnection(s, c.userId, c.provider).catch((err) => console.error("[sync]", c.provider, err instanceof Error ? err.message : err));
    }
  });
  return due.length;
}

export async function recentEvents(s: Services, userId: string, provider: string) {
  return s.db
    .select({ id: externalEvents.id, type: externalEvents.type, occurredAt: externalEvents.occurredAt, data: externalEvents.data })
    .from(externalEvents)
    .where(and(eq(externalEvents.userId, userId), eq(externalEvents.provider, provider), lte(externalEvents.occurredAt, new Date(s.now()))))
    .orderBy(sql`${externalEvents.occurredAt} desc`)
    .limit(30);
}

/**
 * Recognises a pasted problem link and, for verifiable platforms, looks up its real title,
 * difficulty and tags. Unknown links come back as "other" items with a guessed title.
 */
export async function resolveProblem(s: Services, url: string) {
  const parsed = parseProblemUrl(url);
  if (!parsed) throw badRequest("That doesn't look like a link");
  const adapter = parsed.key ? s.platforms.get(parsed.category) : undefined;
  const info = adapter?.problemInfo && adapter.configured().ok ? await adapter.problemInfo(parsed.key!) : null;
  return {
    category: parsed.category,
    platform: adapter ? parsed.category : null,
    problemKey: parsed.key,
    url: info?.url ?? parsed.url,
    title: info?.title ?? parsed.titleGuess,
    difficulty: info?.difficulty ?? null,
    tags: info?.tags ?? [],
    estMinutes: defaultMinutes(info?.difficulty),
    verified: !!info,
  };
}
