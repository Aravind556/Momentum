import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { env } from "./env.js";
import type { DB } from "./db/index.js";
import { account, session, user, verification } from "./db/schema.js";

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

/**
 * Authentication is delegated to better-auth: username + password sign-in (scrypt hashing),
 * DB-backed sessions, HTTP-only cookies, built-in rate limiting and CSRF origin checks.
 * The email address is collected at sign-up only so reminders can be sent.
 */
export function createAuth(db: DB) {
  return betterAuth({
    appName: "Momentum",
    secret: env.authSecret,
    baseURL: env.appUrl,
    basePath: "/api/auth",
    trustedOrigins: [env.appUrl],
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 24,
        usernameValidator: (name) => USERNAME_PATTERN.test(name),
      }),
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: { enabled: !env.isTest, window: 60, max: 30 },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
