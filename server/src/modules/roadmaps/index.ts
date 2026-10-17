import type { AppModule } from "../../core/module.js";
import { registerDailySource } from "../planning/sources.js";
import { roadmapDailySource } from "./daily-source.js";
import { roadmapRoutes } from "./routes.js";

/** Roadmaps ("learning"): ordered items, per-user follows with pace & revision settings, progress. */
export const roadmapsModule: AppModule = {
  name: "roadmaps",
  routes: roadmapRoutes,
  register: () => registerDailySource(roadmapDailySource),
};
