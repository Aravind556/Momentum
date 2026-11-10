import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router } from "express";
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";
import type { Auth } from "./auth.js";
import type { Services } from "./context.js";
import { errorHandler, HttpError } from "./http.js";
import { requireAuth, requireCsrfHeader } from "./middleware.js";
import type { AppModule } from "./module.js";
import { requestNotes } from "./request-context.js";

export function createApp(services: Services, auth: Auth, modules: AppModule[]) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
        },
      },
    }),
  );

  // better-auth handles its own body parsing; mount before express.json().
  // Better Auth rate-limits per client IP, read from X-Forwarded-For. Hand it the address Express
  // resolved (honouring "trust proxy"), as a single value, so users never share one bucket.
  app.all(
    "/api/auth/*splat",
    (req, _res, next) => {
      if (req.ip) req.headers["x-forwarded-for"] = req.ip;
      next();
    },
    toNodeHandler(auth),
  );

  app.use(express.json({ limit: "200kb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  const api = Router();
  for (const m of modules) m.routes?.(api, services);
  app.use("/api", requireCsrfHeader, requireAuth(auth, services.db), requestNotes, api);
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found", "not_found")));

  // In production the built web app is served from the same origin (cookies stay first-party).
  const webDist = findWebDist();
  if (webDist) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get("/{*splat}", (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}

/**
 * The built web app (web/dist), found by walking up from this file: from src/core/ in development
 * and from server/dist/ in the bundled build, which sit at different depths.
 */
function findWebDist(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "web", "dist");
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}
