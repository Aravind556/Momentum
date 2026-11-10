import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

// Earlier files win (dotenv never overrides): .env.local (written by `neon deploy`) beats .env,
// and the working directory beats the repo root.
for (const dir of [process.cwd(), path.resolve(process.cwd(), "..")]) {
  for (const name of [".env.local", ".env"]) {
    const p = path.resolve(dir, name);
    if (existsSync(p)) loadDotenv({ path: p, quiet: true });
  }
}

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test" || !!process.env.VITEST;

function devSecret(name: string): string {
  if (isProd) throw new Error(`${name} must be set in production`);
  if (!isTest) console.warn(`[env] ${name} not set — using an ephemeral development value. Sessions reset on restart.`);
  return randomBytes(32).toString("base64");
}

export const env = {
  isProd,
  isTest,
  port: Number(process.env.PORT || 3001),
  /** Public origin of the web app (used for auth callbacks and links in emails). */
  appUrl: process.env.APP_URL || "http://localhost:5173",
  /** PostgreSQL (e.g. Supabase). If unset, an embedded PGlite (Postgres in WASM) database is used. */
  databaseUrl: process.env.DATABASE_URL || "",
  /**
   * Direct (non-pooled) connection for migrations. Neon's pooled URL goes through PgBouncer in
   * transaction mode, which drops session state, so schema changes use this one. Falls back to DATABASE_URL.
   */
  migrationDatabaseUrl: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "",
  pgliteDir: process.env.PGLITE_DIR || path.resolve(process.cwd(), ".data", "pglite"),
  authSecret: process.env.BETTER_AUTH_SECRET || devSecret("BETTER_AUTH_SECRET"),
  /** Optional: enables importing a YouTube playlist into a roadmap. */
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  /** LeetCode has no official API; the unofficial adapter can be disabled. */
  leetcodeEnabled: process.env.LEETCODE_ENABLED !== "false",
  /** Outgoing email. Without SMTP_HOST, emails are printed to the console instead. */
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || "Momentum <no-reply@localhost>",
  },
  /**
   * Web Push (VAPID) keys. Generate once with \`npx web-push generate-vapid-keys\`. Without them a
   * key pair is created in development and saved under the data folder.
   */
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com",
  },
  /** Disable background jobs (tests, one-off scripts). */
  jobsEnabled: process.env.JOBS_ENABLED !== "false" && !isTest,
};
