import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import type { Services } from "./context.js";
import type { DB } from "./db/index.js";
import { EventBus } from "./events.js";
import type { AppModule } from "./module.js";
import { createRegistry } from "../modules/platforms/registry.js";
import type { FetchFn } from "../modules/platforms/types.js";
import { MODULES } from "../modules/index.js";

/** Builds services, lets every module register its event handlers, and assembles the HTTP app. */
export function bootstrap(db: DB, opts: { now?: () => number; fetch?: FetchFn; platformSpacingMs?: number; modules?: AppModule[] } = {}) {
  const modules = opts.modules ?? MODULES;
  const services: Services = {
    db,
    now: opts.now ?? (() => Date.now()),
    events: new EventBus(),
    platforms: createRegistry(opts.fetch, opts.platformSpacingMs === undefined ? {} : { spacingMs: opts.platformSpacingMs }),
  };
  for (const m of modules) m.register?.(services);
  const app = createApp(services, createAuth(db), modules);
  return { app, services, jobs: modules.flatMap((m) => m.jobs ?? []) };
}
