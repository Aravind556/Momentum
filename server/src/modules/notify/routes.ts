import type { Router } from "express";
import { z } from "zod";
import type { Services } from "../../core/context.js";
import { parse } from "../../core/http.js";
import { uid } from "../../core/middleware.js";
import { hasSubscription, pushNotifier, removeSubscription, saveSubscription, vapidKeys } from "./push.js";
import * as notifications from "./service.js";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export function notifyRoutes(r: Router, s: Services) {
  /* browser push */
  r.get("/push/key", async (req, res) => {
    const keys = vapidKeys();
    res.json({ enabled: !!keys, publicKey: keys?.publicKey ?? null, subscribed: await hasSubscription(s, uid(req)) });
  });
  r.post("/push/subscriptions", async (req, res) => {
    await saveSubscription(s, uid(req), parse(subscriptionSchema, req.body), req.get("user-agent"));
    res.status(201).json({ ok: true });
  });
  r.delete("/push/subscriptions", async (req, res) => {
    await removeSubscription(s, uid(req), parse(z.object({ endpoint: z.string().url() }), req.body).endpoint);
    res.status(204).end();
  });
  r.post("/push/test", async (req, res) => {
    const to = { userId: uid(req), email: req.user!.email, name: req.profile!.displayName };
    await pushNotifier.send(s, to, { subject: "Notifications are on", summary: "You'll get reminders here while tasks are open.", lines: [] , link: "/" });
    res.json({ ok: true });
  });

  r.get("/notifications", async (req, res) => res.json(await notifications.listNotifications(s, uid(req))));
  r.post("/notifications/read", async (req, res) => {
    const body = parse(z.object({ ids: z.array(z.string()).optional() }), req.body ?? {});
    await notifications.markRead(s, uid(req), body.ids ?? "all");
    res.json({ ok: true });
  });
}
