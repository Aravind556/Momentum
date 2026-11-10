import type { Router } from "express";
import { z } from "zod";
import { completeTaskSchema, goalInputSchema, quickTaskSchema, taskInputSchema } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import { param, parse, queryString } from "../../core/http.js";
import { uid } from "../../core/middleware.js";
import { isoDate } from "../../core/routing.js";
import * as completions from "./completions.js";
import * as goals from "./goals.js";
import * as tasks from "./tasks.js";

export function taskRoutes(r: Router, s: Services) {
  r.get("/goals", async (req, res) => res.json(await goals.listGoalsWithProgress(s.db, uid(req), req.query.archived === "1")));
  r.post("/goals", async (req, res) => res.status(201).json(await goals.createGoal(s.db, uid(req), parse(goalInputSchema, req.body))));
  r.put("/goals/:id", async (req, res) => {
    const body = parse(goalInputSchema.and(z.object({ status: z.enum(["active", "completed", "archived"]).optional() })), req.body);
    res.json(await goals.updateGoal(s.db, uid(req), param(req, "id"), body));
  });
  r.delete("/goals/:id", async (req, res) => res.json(await goals.archiveGoal(s.db, uid(req), param(req, "id"))));

  r.get("/tasks", async (req, res) => {
    res.json(
      await tasks.listTasks(s.db, uid(req), {
        status: queryString(req, "status"),
        goalId: queryString(req, "goalId"),
        includeArchived: req.query.archived === "1",
        includeGenerated: req.query.generated === "1",
      }),
    );
  });
  r.post("/tasks", async (req, res) => {
    const task = await tasks.createTask(s.db, uid(req), parse(taskInputSchema, req.body), { createdAt: new Date(s.now()) });
    await s.events.emit("task.changed", { userId: uid(req), taskId: task.id });
    res.status(201).json(task);
  });
  r.post("/tasks/quick", async (req, res) => {
    const q = parse(quickTaskSchema, req.body);
    const body = parse(taskInputSchema, { title: q.title, estimatedMinutes: q.estimatedMinutes, splittable: q.estimatedMinutes > 60 });
    const task = await tasks.createTask(s.db, uid(req), body, { createdAt: new Date(s.now()) });
    await s.events.emit("task.changed", { userId: uid(req), taskId: task.id });
    res.status(201).json(task);
  });
  r.put("/tasks/:id", async (req, res) => {
    const body = parse(taskInputSchema, req.body);
    const version = typeof req.body?.version === "number" ? req.body.version : undefined;
    const task = await tasks.updateTask(s.db, uid(req), param(req, "id"), body, version);
    await s.events.emit("task.changed", { userId: uid(req), taskId: param(req, "id") });
    res.json(task);
  });
  r.delete("/tasks/:id", async (req, res) => {
    const result = await tasks.deleteTask(s.db, uid(req), param(req, "id"), s.now());
    await s.events.emit("task.changed", { userId: uid(req), taskId: null });
    res.json(result);
  });
  r.post("/tasks/:id/complete", async (req, res) => {
    res.json(await completions.completeTask(s, uid(req), param(req, "id"), parse(completeTaskSchema, req.body ?? {})));
  });
  r.post("/tasks/:id/reopen", async (req, res) => {
    const body = parse(z.object({ occurrenceDate: isoDate.optional() }), req.body ?? {});
    res.json(await completions.reopenTask(s, uid(req), param(req, "id"), body.occurrenceDate));
  });
  r.post("/tasks/:id/skip", async (req, res) => {
    const body = parse(z.object({ occurrenceDate: isoDate.optional() }), req.body ?? {});
    res.json(await completions.skipTask(s, uid(req), param(req, "id"), body.occurrenceDate));
  });
  r.post("/tasks/:id/unskip", async (req, res) => res.json(await completions.unskipTask(s, uid(req), param(req, "id"))));
}
