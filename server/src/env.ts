import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

for (const p of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")]) {
  if (existsSync(p)) loadDotenv({ path: p, quiet: true });
}

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test" || !!process.env.VITEST;

function devSecret(name: string): string {
  if (isProd) throw new Error(`${name} must be set in production`);
  if (!isTest) console.warn(`[env] ${name} not set — using an ephemeral development value. Sessions reset on restart.`);
  return randomBytes(32).toString("base64");
}

const authSecret = process.env.BETTER_AUTH_SECRET || devSecret("BETTER_AUTH_SECRET");

export const env = {
  isProd,
  isTest,
  port: Number(process.env.PORT || 3001),
  /** Public origin of the web app (used for auth callbacks, CORS-free same-origin cookies). */
  appUrl: process.env.APP_URL || "http://localhost:5173",
  /** If unset, an embedded PGlite (Postgres in WASM) database is used. */
  databaseUrl: process.env.DATABASE_URL || "",
  pgliteDir: process.env.PGLITE_DIR || path.resolve(process.cwd(), ".data", "pglite"),
  authSecret,
  /** 32-byte key for encrypting integration credentials at rest. */
  encryptionKey: process.env.ENCRYPTION_KEY
    ? Buffer.from(process.env.ENCRYPTION_KEY, "base64")
    : createHash("sha256").update(`cadence-enc:${authSecret}`).digest(),
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
  },
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  /** LeetCode has no official API; the unofficial adapter can be disabled. */
  leetcodeEnabled: process.env.LEETCODE_ENABLED !== "false",
  /** Disable background jobs (tests, one-off scripts). */
  jobsEnabled: process.env.JOBS_ENABLED !== "false" && !isTest,
};

if (env.encryptionKey.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
