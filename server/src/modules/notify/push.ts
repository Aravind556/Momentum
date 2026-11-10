import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import type { Services } from "../../core/context.js";
import { pushSubscriptions } from "../../core/db/schema.js";
import { env } from "../../core/env.js";
import type { Message, Notifier, Recipient } from "./channels.js";

interface Keys {
  publicKey: string;
  privateKey: string;
}

let keys: Keys | null | undefined;

/**
 * VAPID keys identify this server to browsers' push services. Production sets them in the
 * environment (keys must stay the same, or every subscription breaks). In development a pair is
 * generated once and kept next to the local database.
 */
export function vapidKeys(): Keys | null {
  if (keys !== undefined) return keys;
  if (env.vapid.publicKey && env.vapid.privateKey) {
    keys = { publicKey: env.vapid.publicKey, privateKey: env.vapid.privateKey };
  } else if (env.isProd) {
    console.warn("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — browser notifications are disabled.");
    keys = null;
  } else {
    const file = path.resolve(path.dirname(env.pgliteDir), "vapid.json");
    if (existsSync(file)) keys = JSON.parse(readFileSync(file, "utf8")) as Keys;
    else {
      keys = webpush.generateVAPIDKeys();
      if (!env.isTest) {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(keys));
      }
    }
  }
  if (keys) webpush.setVapidDetails(env.vapid.subject, keys.publicKey, keys.privateKey);
  return keys;
}

export interface SentPush {
  userId: string;
  title: string;
  body: string;
}
/** Pushes "sent" in tests. */
export const pushOutbox: SentPush[] = [];

export async function saveSubscription(s: Services, userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
  await s.db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
}

export async function removeSubscription(s: Services, userId: string, endpoint: string) {
  await s.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function hasSubscription(s: Services, userId: string) {
  return !!(await s.db.query.pushSubscriptions.findFirst({ where: eq(pushSubscriptions.userId, userId), columns: { id: true } }));
}

/** Browser notifications on every device the user turned them on. Expired subscriptions are removed. */
export const pushNotifier: Notifier = {
  id: "push",
  async send(s: Services, to: Recipient, msg: Message) {
    const subs = await s.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, to.userId));
    if (!subs.length) return;
    const body = msg.lines.filter((l) => l.startsWith("• ")).map((l) => l.slice(2)).join("\n") || msg.summary;
    if (env.isTest) {
      pushOutbox.push({ userId: to.userId, title: msg.subject, body });
      return;
    }
    if (!vapidKeys()) return;
    const payload = JSON.stringify({ title: msg.subject, body, url: msg.link ?? "/", tag: msg.tag ?? "momentum" });
    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 4 * 3600 });
        await s.db.update(pushSubscriptions).set({ lastSentAt: new Date(s.now()) }).where(eq(pushSubscriptions.id, sub.id));
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the browser unsubscribed or the subscription expired.
        if (status === 404 || status === 410) await s.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        else console.error("[push] send failed:", status ?? (err instanceof Error ? err.message : err));
      }
    }
  },
};
