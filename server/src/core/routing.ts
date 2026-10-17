import type { Request } from "express";
import { z } from "zod";
import { instantToLocalDate } from "@cadence/shared";
import type { Services } from "./context.js";

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The signed-in user's local date. */
export const todayFor = (s: Services, req: Request) => instantToLocalDate(s.now(), req.profile!.timezone);
