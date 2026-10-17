ALTER TABLE "profiles" ADD COLUMN "last_planned_day" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_day" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "verify_from" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tasks_owner_plan_day_idx" ON "tasks" USING btree ("owner_id","plan_day");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_generated_unique" ON "tasks" USING btree ("owner_id","source","source_id","plan_day") WHERE source <> 'manual';