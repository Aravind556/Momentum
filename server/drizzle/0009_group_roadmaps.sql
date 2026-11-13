CREATE TABLE "group_roadmap_days" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"day" text NOT NULL,
	"item_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_roadmaps" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"roadmap_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"items_per_day" integer NOT NULL,
	"weekdays" jsonb NOT NULL,
	"start_date" text NOT NULL,
	"due_time" text DEFAULT '23:59' NOT NULL,
	"revision" text DEFAULT 'decent' NOT NULL,
	"timezone" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_roadmap_days" ADD CONSTRAINT "group_roadmap_days_assignment_id_group_roadmaps_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."group_roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_roadmaps" ADD CONSTRAINT "group_roadmaps_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_roadmaps" ADD CONSTRAINT "group_roadmaps_roadmap_id_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_roadmaps" ADD CONSTRAINT "group_roadmaps_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_roadmap_day_unique" ON "group_roadmap_days" USING btree ("assignment_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "group_roadmap_unique" ON "group_roadmaps" USING btree ("group_id","roadmap_id");--> statement-breakpoint
CREATE INDEX "group_roadmaps_roadmap_idx" ON "group_roadmaps" USING btree ("roadmap_id");