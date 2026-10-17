import { env } from "./env.js";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { openDatabase, runMigrations } from "./db/index.js";
import { createRegistry } from "./integrations/registry.js";
import { startJobs } from "./jobs/runner.js";
import type { Services } from "./services/context.js";

const database = await openDatabase({ databaseUrl: env.databaseUrl, pgliteDir: env.pgliteDir });
await runMigrations(database);

const services: Services = { db: database.db, now: () => Date.now(), integrations: createRegistry() };
const auth = createAuth(database.db);
const app = createApp(services, auth);
const stopJobs = env.jobsEnabled ? startJobs(services) : () => undefined;

const server = app.listen(env.port, () => {
  console.log(`[cadence] API listening on http://localhost:${env.port} (database: ${database.driver})`);
});

async function shutdown() {
  stopJobs();
  server.close();
  await database.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
