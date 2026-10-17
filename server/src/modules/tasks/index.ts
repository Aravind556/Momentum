import type { AppModule } from "../../core/module.js";
import { taskRoutes } from "./routes.js";

/** The user's own tasks ("doing"): deadlines, durations, optional repeats, goals and completions. */
export const tasksModule: AppModule = { name: "tasks", routes: taskRoutes };
