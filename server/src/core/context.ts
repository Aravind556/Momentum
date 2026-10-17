import type { DB } from "./db/index.js";
import type { EventBus } from "./events.js";
import type { PlatformRegistry } from "../modules/platforms/registry.js";

/** Dependencies shared by all services; the clock and fetch are injectable for deterministic tests. */
export interface Services {
  db: DB;
  now: () => number;
  events: EventBus;
  platforms: PlatformRegistry;
}
