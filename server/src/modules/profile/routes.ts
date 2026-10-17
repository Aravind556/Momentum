import type { Router } from "express";
import { availabilitySchema, profileUpdateSchema } from "@cadence/shared";
import type { Services } from "../../core/context.js";
import { parse } from "../../core/http.js";
import { uid } from "../../core/middleware.js";
import { computeStreak } from "../progress/service.js";
import * as profiles from "./service.js";

export function profileRoutes(r: Router, s: Services) {
  r.get("/me", async (req, res) => {
    const summary = await profiles.profileSummary(s.db, uid(req));
    const streak = await computeStreak(s.db, uid(req), req.profile!.timezone, s.now());
    res.json({ user: req.user, profile: req.profile, ...summary, streak: { current: streak.current, longest: streak.longest } });
  });
  r.patch("/me", async (req, res) => {
    const body = parse(profileUpdateSchema, req.body);
    const profile = await profiles.updateProfile(s.db, uid(req), body, s.now());
    await s.events.emit("settings.changed", { userId: uid(req) });
    res.json({ profile });
  });

  r.get("/availability", async (req, res) => res.json(await profiles.loadAvailability(s.db, uid(req))));
  r.put("/availability", async (req, res) => {
    await profiles.saveAvailability(s.db, uid(req), parse(availabilitySchema, req.body));
    await s.events.emit("availability.changed", { userId: uid(req) });
    res.json(await profiles.loadAvailability(s.db, uid(req)));
  });
}
