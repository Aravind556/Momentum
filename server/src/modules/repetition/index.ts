import type { AppModule } from "../../core/module.js";
import { registerDailySource } from "../planning/sources.js";
import { reviewDailySource } from "./daily-source.js";
import { repetitionRoutes } from "./routes.js";

/** Spaced repetition: review cards scheduled by a pluggable algorithm (SM-2 today); due ones join the day plan. */
export const repetitionModule: AppModule = {
  name: "repetition",
  routes: repetitionRoutes,
  register: () => registerDailySource(reviewDailySource),
};
