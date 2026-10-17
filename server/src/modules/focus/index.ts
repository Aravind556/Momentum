import type { AppModule } from "../../core/module.js";
import { focusRoutes } from "./routes.js";

/** Focus timer sessions (with pauses) linked to tasks and schedule blocks. */
export const focusModule: AppModule = { name: "focus", routes: focusRoutes };
