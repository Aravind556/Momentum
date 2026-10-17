import type { Router } from "express";
import { z } from "zod";
import type { Services } from "../../core/context.js";
import { param, parse } from "../../core/http.js";
import { uid } from "../../core/middleware.js";
import { replanToday } from "./daily.js";
import { forecast } from "./forecast.js";
import * as today from "./today.js";

export function todayRoutes(r: Router, s: Services) {
  r.get("/today", async (req, res) => res.json(await today.getToday(s, uid(req))));
  r.get("/forecast", async (req, res) => res.json(await forecast(s, uid(req), Number(req.query.days ?? 14) || 14)));
  r.post("/today/replan", async (req, res) => res.json(await replanToday(s, uid(req))));
  r.post("/today/tasks/:id/check", async (req, res) => res.json(await today.checkItem(s, uid(req), param(req, "id"))));
  r.post("/today/tasks/:id/uncheck", async (req, res) => res.json(await today.uncheckItem(s, uid(req), param(req, "id"))));
  r.put("/today/tasks/:id/time", async (req, res) => {
    const body = parse(z.object({ start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), minutes: z.number().int().min(5).max(600) }), req.body);
    res.json(await today.setItemTime(s, uid(req), param(req, "id"), body));
  });
  r.delete("/today/tasks/:id/time", async (req, res) => res.json(await today.clearItemTime(s, uid(req), param(req, "id"))));
  r.post("/today/tasks/:id/skip", async (req, res) => res.json(await today.skipItem(s, uid(req), param(req, "id"))));
  r.get("/today/tasks/:id/swap-options", async (req, res) => res.json(await today.swapOptions(s, uid(req), param(req, "id"))));
  r.post("/today/tasks/:id/swap", async (req, res) => {
    const body = parse(z.object({ source: z.string().min(1), sourceId: z.string().min(1) }), req.body);
    res.json(await today.swapItem(s, uid(req), param(req, "id"), body));
  });
}
