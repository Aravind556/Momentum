import { bootstrap } from "./core/bootstrap.js";
import { migrate, openDatabase } from "./core/db/index.js";
import { env } from "./core/env.js";
import { startJobs } from "./core/jobs.js";

const database = await openDatabase({ databaseUrl: env.databaseUrl, pgliteDir: env.pgliteDir });
await migrate(database, env);

const { app, services, jobs } = bootstrap(database.db);
const stopJobs = env.jobsEnabled ? startJobs(services, jobs) : () => undefined;

const server = app.listen(env.port, () => {
  console.log(`[momentum] API listening on http://localhost:${env.port} (database: ${database.driver})`);
});

// On stop (docker stop, blue-green switch): take no new connections, let in-flight requests finish
// (at most 10 s), then close the database.
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopJobs();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 10_000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections();
  });
  await database.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
