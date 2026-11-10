import type { Router } from "express";
import { z } from "zod";
import { blockUpdateSchema, commitmentInputSchema, generateScheduleSchema } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import { badRequest, param, parse, queryString } from "../../core/http.js";
import { uid } from "../../core/middleware.js";
import { isoDate, todayFor } from "../../core/routing.js";
import * as commitments from "./commitments.js";
import * as schedules from "./schedules.js";

export function planningRoutes(r: Router, s: Services) {
  /* commitments: classes, meetings and flexible items the schedule works around */
  r.get("/commitments", async (req, res) => res.json(await commitments.listCommitments(s.db, uid(req))));
  r.post("/commitments", async (req, res) => {
    const row = await commitments.createCommitment(s.db, uid(req), parse(commitmentInputSchema, req.body));
    await s.events.emit("availability.changed", { userId: uid(req) });
    res.status(201).json(row);
  });
  r.put("/commitments/:id", async (req, res) => {
    const row = await commitments.updateCommitment(s.db, uid(req), param(req, "id"), parse(commitmentInputSchema, req.body));
    await s.events.emit("availability.changed", { userId: uid(req) });
    res.json(row);
  });
  r.delete("/commitments/:id", async (req, res) => {
    await commitments.deleteCommitment(s.db, uid(req), param(req, "id"));
    await s.events.emit("availability.changed", { userId: uid(req) });
    res.status(204).end();
  });

  /* schedules */
  r.get("/schedules", async (req, res) => {
    const start = queryString(req, "start") ?? todayFor(s, req);
    const end = queryString(req, "end") ?? start;
    parse(isoDate, start);
    parse(isoDate, end);
    if (end < start) throw badRequest("end must be on or after start");
    res.json(await schedules.getScheduleView(s, uid(req), start, end));
  });
  r.post("/schedules/generate", async (req, res) => {
    const body = parse(generateScheduleSchema, req.body);
    res.json(await schedules.generateUserSchedule(s, uid(req), body.date, body.endDate ?? body.date));
  });
  r.post("/schedules/blocks", async (req, res) => {
    const body = parse(
      z.object({
        taskId: z.string().optional().nullable(),
        title: z.string().max(200).optional(),
        startAt: z.string().datetime({ offset: true }),
        endAt: z.string().datetime({ offset: true }),
        kind: z.enum(["focus", "break"]).default("focus"),
      }),
      req.body,
    );
    res.status(201).json(
      await schedules.createManualBlock(s, uid(req), { ...body, startAt: new Date(body.startAt), endAt: new Date(body.endAt) }),
    );
  });
  r.patch("/schedules/blocks/:id", async (req, res) => {
    const body = parse(blockUpdateSchema, req.body);
    const id = param(req, "id");
    let result: unknown = null;
    if (body.startAt || body.endAt) {
      if (!body.startAt || !body.endAt) throw badRequest("Provide both startAt and endAt");
      result = await schedules.moveBlock(s, uid(req), id, new Date(body.startAt), new Date(body.endAt));
    }
    if (body.locked !== undefined || body.status) {
      result = { block: await schedules.updateBlockState(s, uid(req), id, { locked: body.locked, status: body.status }), warnings: [] };
    }
    res.json(result);
  });
  r.delete("/schedules/blocks/:id", async (req, res) => {
    await schedules.deleteBlock(s, uid(req), param(req, "id"));
    res.status(204).end();
  });
  r.post("/schedules/blocks/:id/break", async (req, res) => {
    const body = parse(z.object({ action: z.enum(["skip", "extend"]), minutes: z.number().int().min(1).max(60).optional() }), req.body);
    res.json(await schedules.adjustBreak(s, uid(req), param(req, "id"), body.action, body.minutes));
  });
}
