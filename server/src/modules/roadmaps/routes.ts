import type { Router } from "express";
import { z } from "zod";
import { followPatchSchema as followPatch } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import { param, parse } from "../../core/http.js";
import { uid } from "../../core/middleware.js";
import * as roadmaps from "./service.js";

const roadmapInput = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().nullable(),
});

export function roadmapRoutes(r: Router, s: Services) {
  r.get("/roadmaps", async (req, res) => res.json(await roadmaps.listRoadmaps(s, uid(req))));
  r.post("/roadmaps", async (req, res) => {
    const body = parse(roadmapInput.extend({ items: z.string().max(100_000).optional(), follow: followPatch.optional() }), req.body);
    const created = await roadmaps.createRoadmap(s, uid(req), { title: body.title, description: body.description, follow: body.follow });
    if (body.items?.trim()) await roadmaps.addItems(s, uid(req), created.id, body.items);
    res.status(201).json(await roadmaps.getRoadmap(s, uid(req), created.id));
  });
  r.get("/roadmaps/:id", async (req, res) => res.json(await roadmaps.getRoadmap(s, uid(req), param(req, "id"))));
  r.patch("/roadmaps/:id", async (req, res) => {
    res.json(await roadmaps.updateRoadmap(s, uid(req), param(req, "id"), parse(roadmapInput.partial(), req.body)));
  });
  r.delete("/roadmaps/:id", async (req, res) => res.json(await roadmaps.deleteRoadmap(s, uid(req), param(req, "id"))));

  r.post("/roadmaps/:id/items", async (req, res) => {
    const body = parse(z.object({ text: z.string().max(100_000) }), req.body);
    res.status(201).json(await roadmaps.addItems(s, uid(req), param(req, "id"), body.text));
  });
  r.post("/roadmaps/:id/reorder", async (req, res) => {
    const body = parse(z.object({ itemIds: z.array(z.string()).max(500) }), req.body);
    await roadmaps.reorderItems(s, uid(req), param(req, "id"), body.itemIds);
    res.json({ ok: true });
  });
  r.patch("/roadmap-items/:id", async (req, res) => {
    const body = parse(
      z.object({ title: z.string().trim().min(1).max(200).optional(), estMinutes: z.number().int().min(5).max(600).optional(), section: z.string().trim().max(80).nullable().optional() }),
      req.body,
    );
    res.json(await roadmaps.updateItem(s, uid(req), param(req, "id"), body));
  });
  r.delete("/roadmap-items/:id", async (req, res) => {
    await roadmaps.deleteItem(s, uid(req), param(req, "id"));
    res.status(204).end();
  });
  r.post("/roadmap-items/:id/done", async (req, res) => res.json(await roadmaps.markItemDone(s, uid(req), param(req, "id"))));
  r.post("/roadmap-items/:id/skip", async (req, res) => res.json(await roadmaps.setItemQueued(s, uid(req), param(req, "id"), "skipped")));
  r.post("/roadmap-items/:id/requeue", async (req, res) => res.json(await roadmaps.setItemQueued(s, uid(req), param(req, "id"), "queued")));

  r.put("/roadmaps/:id/follow", async (req, res) => {
    res.json(await roadmaps.follow(s, uid(req), param(req, "id"), parse(followPatch, req.body ?? {})));
  });
  r.patch("/roadmaps/:id/follow", async (req, res) => {
    res.json(await roadmaps.updateFollow(s, uid(req), param(req, "id"), parse(followPatch, req.body)));
  });
  r.delete("/roadmaps/:id/follow", async (req, res) => {
    await roadmaps.unfollow(s, uid(req), param(req, "id"));
    res.status(204).end();
  });
}
