import type { AppModule } from "../../core/module.js";
import { sendReminders } from "./reminders.js";
import { notifyRoutes } from "./routes.js";
import { runReminderSweep } from "./service.js";
import { sendTaskReminders } from "./task-reminders.js";

/** In-app notifications and email reminders (pluggable channels, see channels.ts). */
export const notifyModule: AppModule = {
  name: "notify",
  routes: notifyRoutes,
  jobs: [
    { key: "reminders", everyMs: 60_000, run: runReminderSweep },
    { key: "pending-reminders", everyMs: 15 * 60_000, run: sendReminders },
    { key: "task-reminders", everyMs: 60_000, run: sendTaskReminders },
  ],
};
