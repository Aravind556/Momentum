import { text, timestamp } from "drizzle-orm/pg-core";

/** Column helpers shared by every module's schema. */
export const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const ts = (name: string) => timestamp(name, { withTimezone: true });
