import type { AppModule } from "../../core/module.js";
import { profileRoutes } from "./routes.js";

/** Profile, settings and weekly availability (working hours, blocked time, days off). */
export const profileModule: AppModule = { name: "profile", routes: profileRoutes };
