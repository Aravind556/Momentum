import type { AppModule } from "../../core/module.js";
import { platformRoutes } from "./routes.js";
import { syncAllDue } from "./service.js";

/** Coding platforms (LeetCode, ...): public handles, submission sync and task verification. */
export const platformsModule: AppModule = {
  name: "platforms",
  routes: platformRoutes,
  jobs: [{ key: "integration-sync", everyMs: 15 * 60_000, run: syncAllDue }],
};
