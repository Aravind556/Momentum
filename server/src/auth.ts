import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "./env.js";
import type { DB } from "./db/index.js";
import { account, session, user, verification } from "./db/schema.js";

/**
 * Authentication is delegated to better-auth (scrypt password hashing, DB-backed sessions,
 * HTTP-only cookies, built-in rate limiting and CSRF origin checks).
 */
export function createAuth(db: DB) {
  return betterAuth({
    appName: "Cadence",
    secret: env.authSecret,
    baseURL: env.appUrl,
    basePath: "/api/auth",
    trustedOrigins: [env.appUrl],
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 3600,
      async sendResetPassword({ user: u, url }) {
        // No email provider is configured by default. In development the link is printed so
        // the flow can be completed locally; configure SMTP/transactional email for production.
        if (!env.isTest) console.log(`[auth] Password reset requested for ${u.email}: ${url}`);
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: { enabled: !env.isTest, window: 60, max: 30 },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
