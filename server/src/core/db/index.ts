import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema.js";

export type Schema = typeof schema;
export type DB = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** A db handle or an open transaction. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

export interface Database {
  db: DB;
  driver: "pglite" | "postgres";
  close(): Promise<void>;
}

/** Locates the drizzle migrations folder both from src/ (tsx) and dist/ (bundled). */
export function migrationsFolder(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "drizzle");
    if (existsSync(path.join(candidate, "meta", "_journal.json"))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error("Could not find the drizzle migrations folder");
}

/**
 * Hosted Postgres such as Supabase requires TLS. node-postgres does not apply `sslmode` from the URL
 * the way libpq does, so enable TLS explicitly when the URL asks for it or points at Supabase.
 */
function pgConfig(url: string): { connectionString: string; ssl?: { rejectUnauthorized: boolean } } {
  const wantsSsl = /sslmode=(require|verify-ca|verify-full)/.test(url) || /supabase\.(co|com)/.test(url);
  if (!wantsSsl) return { connectionString: url };
  // Drop sslmode from the URL: newer node-postgres maps it to strict verification, which overrides `ssl`.
  const u = new URL(url);
  u.searchParams.delete("sslmode");
  return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
}

/**
 * Opens the database. With DATABASE_URL a real PostgreSQL server is used (node-postgres);
 * otherwise an embedded PGlite instance — the same Postgres engine compiled to WASM — stores data
 * on disk (or in memory for tests with `memory://`).
 */
export async function openDatabase(opts: { databaseUrl?: string; pgliteDir?: string }): Promise<Database> {
  if (opts.databaseUrl) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ ...pgConfig(opts.databaseUrl), max: 10 });
    const db = drizzle(pool, { schema }) as unknown as DB;
    return { db, driver: "postgres", close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = opts.pgliteDir ?? "memory://";
  if (!dir.startsWith("memory://")) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as DB;
  return { db, driver: "pglite", close: () => client.close() };
}

export async function runMigrations(database: Database): Promise<void> {
  const folder = migrationsFolder();
  if (database.driver === "postgres") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(database.db as never, { migrationsFolder: folder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(database.db as never, { migrationsFolder: folder });
  }
}

export { schema };
