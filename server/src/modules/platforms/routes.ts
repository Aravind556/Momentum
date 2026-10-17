import type { Router } from "express";
import { z } from "zod";
import type { Services } from "../../core/context.js";
import { badRequest, param, parse } from "../../core/http.js";
import { sensitiveLimiter, uid } from "../../core/middleware.js";
import * as platforms from "./service.js";

export function platformRoutes(r: Router, s: Services) {
  const known = (provider: string) => {
    if (!s.platforms.get(provider)) throw badRequest("Unknown platform");
    return provider;
  };
  r.post("/problems/resolve", async (req, res) => {
    const body = parse(z.object({ url: z.string().trim().min(1).max(2000) }), req.body);
    res.json(await platforms.resolveProblem(s, body.url));
  });
  r.get("/integrations", async (req, res) => res.json(await platforms.listIntegrations(s, uid(req))));
  r.put("/integrations/:provider", sensitiveLimiter, async (req, res) => {
    const body = parse(z.object({ handle: z.string().trim().min(1).max(60) }), req.body);
    res.json(await platforms.connectPlatform(s, uid(req), known(param(req, "provider")), body.handle));
  });
  r.post("/integrations/:provider/sync", sensitiveLimiter, async (req, res) => {
    res.json(await platforms.manualSync(s, uid(req), known(param(req, "provider"))));
  });
  r.get("/integrations/:provider/events", async (req, res) => res.json(await platforms.recentEvents(s, uid(req), param(req, "provider"))));
  r.delete("/integrations/:provider", async (req, res) => {
    await platforms.disconnect(s, uid(req), param(req, "provider"));
    res.status(204).end();
  });
}
