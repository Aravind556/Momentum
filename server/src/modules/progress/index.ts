import type { AppModule } from "../../core/module.js";
import { progressRoutes } from "./routes.js";

/** Personal progress: streaks, completions, focus minutes. */
export const progressModule: AppModule = { name: "progress", routes: progressRoutes };
