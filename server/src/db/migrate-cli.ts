import { env } from "../env.js";
import { openDatabase, runMigrations } from "./index.js";

const database = await openDatabase({ databaseUrl: env.databaseUrl, pgliteDir: env.pgliteDir });
await runMigrations(database);
console.log(`Migrations applied (${database.driver}).`);
await database.close();
