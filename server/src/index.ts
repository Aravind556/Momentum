import { bootstrap } from "./core/bootstrap.js";
import { openDatabase, runMigrations } from "./core/db/index.js";
import { env } from "./core/env.js";
import { startJobs } from "./core/jobs.js";

const database = await openDatabase({ databaseUrl: env.databaseUrl, pgliteDir: env.pgliteDir });
await runMigrations(database);

const { app, services, jobs } = bootstrap(database.db);
const stopJobs = env.jobsEnabled ? startJobs(services, jobs) : () => undefined;

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
