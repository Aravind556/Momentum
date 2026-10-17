import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "../auth.js";
import type { DB } from "../db/index.js";
import { env } from "../env.js";
import { HttpError } from "../lib/http.js";
import { getOrCreateProfile, type Profile } from "../services/profiles.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string };
      profile?: Profile;
    }
  }
}

export function requireAuth(auth: Auth, db: DB): RequestHandler {
  return async (req, _res, next) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) return next(new HttpError(401, "Please sign in", "unauthenticated"));
    req.user = { id: session.user.id, email: session.user.email, name: session.user.name };
    req.profile = await getOrCreateProfile(db, req.user);
    next();
  };
}

export const uid = (req: Request): string => {
  if (!req.user) throw new HttpError(401, "Please sign in", "unauthenticated");
  return req.user.id;
};

/**
 * CSRF defence in depth (cookies are also SameSite=Lax): state-changing API requests must carry a
 * custom header, which browsers cannot add cross-site without a CORS preflight we never approve.
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-requested-with") !== "cadence") return next(new HttpError(403, "Missing request header", "csrf"));
  next();
}

export const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.isTest ? 10_000 : 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { message: "Too many requests — try again in a minute", code: "rate_limited" } },
});
