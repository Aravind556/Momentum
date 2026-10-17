import type { Router } from "express";
import type { Services } from "./context.js";

export interface Job {
  key: string;
  everyMs: number;
  run: (s: Services) => Promise<unknown>;
}

/**
 * A feature module. Everything a module contributes is declared here, so adding a feature means
 * adding a folder and one line in `modules/index.ts`.
 */
export interface AppModule {
  name: string;
  /** Authenticated API routes, mounted under /api. */
  routes?: (r: Router, s: Services) => void;
  /** Periodic background jobs (run under a Postgres lease, so never twice at once). */
  jobs?: Job[];
  /** Subscribe to domain events and do other one-time setup. */
  register?: (s: Services) => void;
}
