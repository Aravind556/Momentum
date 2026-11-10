import { env } from "../env.js";
import { migrate, openDatabase } from "./index.js";

const database = await openDatabase({ databaseUrl: env.databaseUrl, pgliteDir: env.pgliteDir });
await migrate(database, env);
console.log(`Migrations applied (${database.driver}).`);
await database.close();
