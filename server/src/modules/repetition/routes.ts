import type { Router } from "express";
import { z } from "zod";
import { REVIEW_RATINGS, type ReviewRating } from "@momentum/shared";
import type { Services } from "../../core/context.js";
import { param, parse } from "../../core/http.js";
import { uid } from "../../core/middleware.js";
import * as cards from "./service.js";

export function repetitionRoutes(r: Router, s: Services) {
  r.get("/reviews", async (req, res) => res.json(await cards.listCards(s, uid(req))));
  r.post("/reviews", async (req, res) => {
    const body = parse(z.object({ submissionId: z.string().min(1) }), req.body);
    res.status(201).json(await cards.addFromSubmission(s, uid(req), body.submissionId));
  });
  r.post("/reviews/:id/rate", async (req, res) => {
    const body = parse(z.object({ rating: z.enum(Object.keys(REVIEW_RATINGS) as [ReviewRating, ...ReviewRating[]]) }), req.body);
    res.json(await cards.rateCard(s, uid(req), param(req, "id"), body.rating));
  });
  r.delete("/reviews/:id", async (req, res) => {
    await cards.deleteCard(s, uid(req), param(req, "id"));
    res.status(204).end();
  });
}
