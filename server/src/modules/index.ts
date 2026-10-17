import type { AppModule } from "../core/module.js";
import { focusModule } from "./focus/index.js";
import { groupsModule } from "./groups/index.js";
import { notifyModule } from "./notify/index.js";
import { planningModule } from "./planning/index.js";
import { platformsModule } from "./platforms/index.js";
import { profileModule } from "./profile/index.js";
import { progressModule } from "./progress/index.js";
import { repetitionModule } from "./repetition/index.js";
import { roadmapsModule } from "./roadmaps/index.js";
import { tasksModule } from "./tasks/index.js";

/** Every feature module in the app. Adding a feature = a new folder + one line here. */
export const MODULES: AppModule[] = [
  profileModule,
  tasksModule,
  planningModule,
  focusModule,
  platformsModule,
  roadmapsModule,
  repetitionModule,
  groupsModule,
  notifyModule,
  progressModule,
];
