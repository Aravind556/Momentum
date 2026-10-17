import request from "supertest";
import type { Express } from "express";
import { bootstrap } from "../src/core/bootstrap.js";
import type { Services } from "../src/core/context.js";
import { openDatabase, runMigrations, type Database } from "../src/core/db/index.js";
import { env } from "../src/core/env.js";
import type { FetchFn } from "../src/modules/platforms/types.js";

export interface TestEnv {
  app: Express;
  database: Database;
  services: Services;
  clock: { now: number };
  close(): Promise<void>;
}

/** Fresh in-memory Postgres (PGlite) with migrations, real auth, all modules, and a controllable clock. */
export async function setupTestEnv(opts: { fetch?: FetchFn; now?: string } = {}): Promise<TestEnv> {
  const database = await openDatabase({ pgliteDir: "memory://" });
  await runMigrations(database);
  const clock = { now: Date.parse(opts.now ?? "2026-10-20T03:30:00Z") }; // 09:00 in Asia/Kolkata
  const { app, services } = bootstrap(database.db, {
    now: () => clock.now,
    fetch: opts.fetch ?? (async () => new Response("{}", { status: 503 })),
    platformSpacingMs: 0,
  });
  return { app, database, services, clock, close: () => database.close() };
}

export interface Client {
  agent: ReturnType<typeof request.agent>;
  get(url: string): request.Test;
  post(url: string, body?: object): request.Test;
  put(url: string, body?: object): request.Test;
  patch(url: string, body?: object): request.Test;
  del(url: string): request.Test;
  userId: string;
  username: string;
}

let counter = 0;

export async function signUp(app: Express, name = "User", timezone = "Asia/Kolkata"): Promise<Client> {
  counter += 1;
  const agent = request.agent(app);
  const username = `${name.toLowerCase().replace(/\W/g, "")}${counter}`.slice(0, 24);
  const res = await agent
    .post("/api/auth/sign-up/email")
    .set("origin", env.appUrl)
    .send({ email: `${username}@example.com`, password: "correct-horse-battery", name, username });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${res.text}`);
  const h = (t: request.Test) => t.set("x-requested-with", "cadence").set("origin", env.appUrl);
  const client: Client = {
    agent,
    get: (url) => agent.get(url).set("origin", env.appUrl),
    post: (url, body) => h(agent.post(url)).send(body ?? {}),
    put: (url, body) => h(agent.put(url)).send(body ?? {}),
    patch: (url, body) => h(agent.patch(url)).send(body ?? {}),
    del: (url) => h(agent.delete(url)),
    userId: "",
    username,
  };
  const me = await client.get("/api/me");
  client.userId = me.body.user.id;
  await client.patch("/api/me", { timezone, preferences: { focusMinutes: 25, breakMinutes: 10 } });
  return client;
}

/** Availability with a single working window every day and no blocked ranges. */
export async function setHours(c: Client, start: string, end: string) {
  const weekly = Object.fromEntries(["1", "2", "3", "4", "5", "6", "7"].map((d) => [d, [{ start, end }]]));
  const r = await c.put("/api/availability", { weekly, blocked: [], overrides: [] });
  if (r.status !== 200) throw new Error(r.text);
}

export const IST = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();
