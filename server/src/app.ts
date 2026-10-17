import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";
import type { Auth } from "./auth.js";
import { errorHandler, HttpError } from "./lib/http.js";
import { apiRouter } from "./routes/api.js";
import { requireAuth, requireCsrfHeader } from "./routes/middleware.js";
import type { Services } from "./services/context.js";

export function createApp(services: Services, auth: Auth) {
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
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json({ limit: "200kb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", requireCsrfHeader, requireAuth(auth, services.db), apiRouter(services));
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found", "not_found")));

  // In production the built web app is served from the same origin (cookies stay first-party).
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get("/{*splat}", (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
