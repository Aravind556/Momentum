import type { DB } from "../db/index.js";
import type { IntegrationRegistry } from "../integrations/registry.js";

/** Dependencies shared by all services; the clock is injectable for deterministic tests. */
export interface Services {
  db: DB;
  now: () => number;
  integrations: IntegrationRegistry;
}
