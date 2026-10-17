import { api } from "./api";

/** Browser push for reminders: register the service worker, ask permission, subscribe. */

export type PushState = "unsupported" | "server-disabled" | "denied" | "off" | "on";

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Keeps the worker registered so notifications arrive even when the app isn't open. */
export function registerServiceWorker() {
  if (pushSupported()) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function current() {
  const reg = await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const { enabled } = await api.get<{ enabled: boolean }>("/push/key");
  if (!enabled) return "server-disabled";
  if (Notification.permission === "denied") return "denied";
  const { sub } = await current();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Turns on notifications for this browser (asks for permission first). */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const { publicKey } = await api.get<{ publicKey: string | null }>("/push/key");
  if (!publicKey) return "server-disabled";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const { reg, sub } = await current();
  const subscription = sub ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
  await api.post("/push/subscriptions", subscription.toJSON());
  return "on";
}

export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const { sub } = await current();
  if (sub) {
    await api.del("/push/subscriptions", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return "off";
}
