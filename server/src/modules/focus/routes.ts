import type { Router } from "express";
import { z } from "zod";
import { focusFinishSchema, focusStartSchema } from "@cadence/shared";
import type { Services } from "../../core/context.js";
import { param, parse } from "../../core/http.js";
import { uid } from "../../core/middleware.js";
import * as focus from "./service.js";

export function focusRoutes(r: Router, s: Services) {
  r.get("/focus-sessions/active", async (req, res) => res.json({ session: await focus.getActiveSession(s, uid(req)) }));
  r.get("/focus-sessions", async (req, res) => res.json(await focus.listSessions(s, uid(req), Number(req.query.limit ?? 30))));
  r.post("/focus-sessions", async (req, res) => res.status(201).json(await focus.startSession(s, uid(req), parse(focusStartSchema, req.body))));
  r.post("/focus-sessions/:id/pause", async (req, res) => res.json(await focus.pauseSession(s, uid(req), param(req, "id"))));
  r.post("/focus-sessions/:id/resume", async (req, res) => res.json(await focus.resumeSession(s, uid(req), param(req, "id"))));
  r.post("/focus-sessions/:id/extend", async (req, res) => {
    const body = parse(z.object({ minutes: z.number().int().min(1).max(120) }), req.body);
    res.json(await focus.extendSession(s, uid(req), param(req, "id"), body.minutes));
  });
  r.post("/focus-sessions/:id/finish", async (req, res) => {
    res.json(await focus.finishSession(s, uid(req), param(req, "id"), parse(focusFinishSchema, req.body ?? {})));
  });
}
