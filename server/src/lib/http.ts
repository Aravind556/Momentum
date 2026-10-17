import type { ErrorRequestHandler, Request } from "express";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "bad_request", details?: unknown) =>
  new HttpError(400, message, code, details);
export const forbidden = (message = "You do not have access to this resource") => new HttpError(403, message, "forbidden");
export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`, "not_found");
export const conflict = (message: string, code = "conflict", details?: unknown) => new HttpError(409, message, code, details);

/** Validates a payload with a shared zod schema; failures become 400 responses with field issues. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      r.error.issues[0]?.message ?? "Invalid request",
      "validation_error",
      r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}

export function param(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== "string" || !v) throw badRequest(`Missing parameter ${name}`);
  return v;
}

export function queryString(req: Request, name: string): string | undefined {
  const v = req.query[name];
  return typeof v === "string" && v.length ? v : undefined;
}

function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^\d{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown) => pgCode(err) === "23505";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { message: err.issues[0]?.message ?? "Invalid request", code: "validation_error" } });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { message: "Malformed JSON body", code: "bad_json" } });
    return;
  }
  if (isUniqueViolation(err)) {
    res.status(409).json({ error: { message: "This record already exists", code: "duplicate" } });
    return;
  }
  // Log without request bodies to avoid leaking personal data or secrets.
  console.error("[error]", err instanceof Error ? err.stack : err);
  res.status(500).json({ error: { message: "Something went wrong", code: "internal" } });
};
