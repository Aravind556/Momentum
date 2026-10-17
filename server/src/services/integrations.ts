import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { addDays, dateRange, instantToLocalDate, localDayBounds } from "@cadence/shared";
import { env } from "../env.js";
import { externalEvents, integrationConnections, profiles, taskCompletions, tasks } from "../db/schema.js";
import { decryptJson, encryptJson, signState, verifyState } from "../lib/crypto.js";
import { badRequest, HttpError, notFound } from "../lib/http.js";
import { exchangeGitHubCode } from "../integrations/github.js";
import { IntegrationError, type ConnectionInfo, type NormalizedEvent } from "../integrations/types.js";
import type { Services } from "./context.js";
import { completeTask } from "./completions.js";
import { isRecurring, occursOn } from "./recurrence.js";
import { notify } from "./social.js";

type Connection = typeof integrationConnections.$inferSelect;

function connInfo(c: Connection): ConnectionInfo {
  return {
    externalAccountId: c.externalAccountId,
    credentials: c.encryptedCredentials ? decryptJson<Record<string, string>>(c.encryptedCredentials) : null,
  };
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
  return s.integrations.all().map((a) => {
    const c = conns.find((x) => x.provider === a.provider);
    const cfg = a.configured();
    return {
      provider: a.provider,
      label: a.label,
      description: a.description,
      authType: a.authType,
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

async function upsertConnection(s: Services, userId: string, provider: "leetcode" | "github", accountId: string, credentials: Record<string, string> | null) {
  const values = {
    userId,
    provider,
    externalAccountId: accountId,
    encryptedCredentials: credentials ? encryptJson(credentials) : null,
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

export async function connectLeetCode(s: Services, userId: string, username: string) {
  const adapter = s.integrations.get("leetcode")!;
  const cfg = adapter.configured();
  if (!cfg.ok) throw badRequest(cfg.reason, "integration_unavailable");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(username)) throw badRequest("Enter a valid LeetCode username");
  const canonical = await adapter.verifyAccount({ externalAccountId: username, credentials: null }).catch(toHttp);
  await upsertConnection(s, userId, "leetcode", canonical, null);
  return syncConnection(s, userId, "leetcode").catch(() => ({ ok: false }));
}

export function githubAuthorizeUrl(userId: string): string {
  if (!env.github.clientId) throw badRequest("GitHub is not configured on this server", "integration_unavailable");
  const params = new URLSearchParams({
    client_id: env.github.clientId,
    redirect_uri: `${env.appUrl}/api/integrations/github/callback`,
    scope: "",
    state: signState(userId),
    allow_signup: "false",
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function githubCallback(s: Services, sessionUserId: string, code: string, state: string) {
  const stateUser = verifyState(state);
  if (!stateUser || stateUser !== sessionUserId) throw badRequest("Invalid or expired authorization state", "bad_state");
  const token = await exchangeGitHubCode(s.integrations.fetch, code, `${env.appUrl}/api/integrations/github/callback`).catch(toHttp);
  const login = await s.integrations.get("github")!.verifyAccount({ externalAccountId: "", credentials: { token } }).catch(toHttp);
  await upsertConnection(s, sessionUserId, "github", login, { token });
  await syncConnection(s, sessionUserId, "github").catch(() => undefined);
}

/** Disconnects and revokes; stored credentials are deleted. Existing completion records are kept as-is. */
export async function disconnect(s: Services, userId: string, provider: string) {
  const c = await s.db.query.integrationConnections.findFirst({
    where: and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, provider as "leetcode" | "github")),
  });
  if (!c) throw notFound("Integration");
  const adapter = s.integrations.get(provider);
  try {
    await adapter?.revoke?.(connInfo(c));
  } catch {
    // Revocation is best effort; local credentials are deleted regardless.
  }
  await s.db
    .update(integrationConnections)
    .set({ status: "disconnected", encryptedCredentials: null, nextSyncAfter: null })
    .where(eq(integrationConnections.id, c.id));
}

/**
 * Fetches provider events (idempotent upsert), then verifies matching tasks. Provider failures update
 * only the connection's status/backoff — never the verification status of any task.
 */
export async function syncConnection(s: Services, userId: string, provider: "leetcode" | "github", opts: { force?: boolean } = {}) {
  const now = s.now();
  const conn = await s.db.query.integrationConnections.findFirst({
    where: and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, provider)),
  });
  if (!conn || conn.status === "disconnected") throw notFound("Integration");
  if (!opts.force && conn.nextSyncAfter && conn.nextSyncAfter.getTime() > now) {
    return { ok: false, skipped: true, retryAt: conn.nextSyncAfter };
  }
  const adapter = s.integrations.get(provider)!;
  const since = new Date(Math.min(conn.lastSyncAt?.getTime() ?? Infinity, now) - 2 * 86_400_000);
  const sinceSafe = conn.lastSyncAt ? since : new Date(now - 14 * 86_400_000);

  let events: NormalizedEvent[];
  try {
    events = await adapter.fetchEvents(connInfo(conn), sinceSafe);
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
      await notify(s.db, userId, "circle", { message: `${adapter.label} access expired. Reconnect to keep verifying tasks.` }, `integration-auth:${provider}:${instantToLocalDate(now, "UTC")}`);
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
  return { ok: true, fetched: events.length, newEvents: inserted, verified };
}

/** Evaluates tasks configured for this provider against stored (deduplicated) events. */
export async function verifyTasks(s: Services, userId: string, provider: "leetcode" | "github") {
  const now = s.now();
  const adapter = s.integrations.get(provider)!;
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
    } else {
      const from = (t.earliestStartAt ?? t.createdAt).getTime();
      const to = t.dueAt?.getTime() ?? now;
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

/** Background sync for all connections that are due (respects per-connection backoff). */
export async function syncAllDue(s: Services) {
  const now = new Date(s.now());
  const due = await s.db
    .select()
    .from(integrationConnections)
    .where(
      and(
        sql`${integrationConnections.status} <> 'disconnected'`,
        sql`(${integrationConnections.nextSyncAfter} is null or ${integrationConnections.nextSyncAfter} <= ${now.toISOString()})`,
        sql`(${integrationConnections.lastSyncAt} is null or ${integrationConnections.lastSyncAt} <= ${new Date(now.getTime() - 25 * 60_000).toISOString()})`,
      ),
    )
    .limit(50);
  for (const c of due) {
    if (!s.integrations.get(c.provider)?.configured().ok) continue;
    await syncConnection(s, c.userId, c.provider).catch((err) => console.error("[sync]", c.provider, err instanceof Error ? err.message : err));
  }
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
