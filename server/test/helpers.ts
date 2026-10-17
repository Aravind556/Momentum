import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { env } from "../src/env.js";
import { openDatabase, runMigrations, type Database } from "../src/db/index.js";
import { createRegistry } from "../src/integrations/registry.js";
import type { FetchFn } from "../src/integrations/types.js";
import type { Services } from "../src/services/context.js";

export interface TestEnv {
  app: Express;
  database: Database;
  services: Services;
  clock: { now: number };
  close(): Promise<void>;
}

/** Fresh in-memory Postgres (PGlite) with migrations, real auth, and a controllable clock. */
export async function setupTestEnv(opts: { fetch?: FetchFn; now?: string } = {}): Promise<TestEnv> {
  const database = await openDatabase({ pgliteDir: "memory://" });
  await runMigrations(database);
  const clock = { now: Date.parse(opts.now ?? "2026-10-20T03:30:00Z") }; // 09:00 in Asia/Kolkata
  const services: Services = {
    db: database.db,
    now: () => clock.now,
    integrations: createRegistry(opts.fetch ?? (async () => new Response("{}", { status: 503 }))),
  };
  const app = createApp(services, createAuth(database.db));
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
}

let counter = 0;

export async function signUp(app: Express, name = "User", timezone = "Asia/Kolkata"): Promise<Client> {
  counter += 1;
  const agent = request.agent(app);
  const email = `${name.toLowerCase().replace(/\W/g, "")}${counter}@example.com`;
  const res = await agent
    .post("/api/auth/sign-up/email")
    .set("origin", env.appUrl)
    .send({ email, password: "correct-horse-battery", name });
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
