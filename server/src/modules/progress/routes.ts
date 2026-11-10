import type { Router } from "express";
import type { Services } from "../../core/context.js";
import { queryString } from "../../core/http.js";
import { uid } from "../../core/middleware.js";
import { activity } from "./activity.js";
import { codingStats, listSubmissions } from "./coding.js";
import { personalAnalytics } from "./service.js";

export function progressRoutes(r: Router, s: Services) {
  r.get("/analytics/summary", async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 7) || 7, 7), 90);
    res.json(await personalAnalytics(s, uid(req), days));
  });
  r.get("/progress/activity", async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 7), 90);
    res.json(await activity(s, uid(req), req.profile!.timezone, days));
  });
  r.get("/progress/coding", async (req, res) => res.json(await codingStats(s, uid(req), req.profile!.timezone)));
  r.get("/submissions", async (req, res) => {
    res.json(
      await listSubmissions(s, uid(req), {
        cursor: queryString(req, "cursor"),
        provider: queryString(req, "provider"),
        limit: Number(req.query.limit ?? 30) || 30,
      }),
    );
  });
}
