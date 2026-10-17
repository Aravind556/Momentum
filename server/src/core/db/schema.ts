/**
 * The full database schema: core tables plus every module's tables. Drizzle (queries and
 * drizzle-kit migrations) reads this file; a new module only needs one line here.
 */
export * from "./core-schema.js";
export * from "../../modules/profile/schema.js";
export * from "../../modules/tasks/schema.js";
export * from "../../modules/planning/schema.js";
export * from "../../modules/focus/schema.js";
export * from "../../modules/platforms/schema.js";
export * from "../../modules/groups/schema.js";
export * from "../../modules/notify/schema.js";
export * from "../../modules/roadmaps/schema.js";
export * from "../../modules/repetition/schema.js";
