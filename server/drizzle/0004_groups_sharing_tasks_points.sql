CREATE TABLE "group_points" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"occurrence" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"verified_by" text NOT NULL,
	"base_points" integer NOT NULL,
	"rank" integer,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"platform" text,
	"problem_key" text,
	"url" text,
	"difficulty" text,
	"repeat" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"due_time" text DEFAULT '23:59' NOT NULL,
	"points" integer NOT NULL,
	"est_minutes" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"roadmap_id" text NOT NULL,
	"group_id" text NOT NULL,
	"shared_by" text NOT NULL,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_points" ADD CONSTRAINT "group_points_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_points" ADD CONSTRAINT "group_points_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_tasks" ADD CONSTRAINT "group_tasks_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_tasks" ADD CONSTRAINT "group_tasks_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_shares" ADD CONSTRAINT "roadmap_shares_roadmap_id_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_shares" ADD CONSTRAINT "roadmap_shares_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_shares" ADD CONSTRAINT "roadmap_shares_shared_by_user_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_points_unique" ON "group_points" USING btree ("group_id","user_id","source_type","source_id","occurrence");--> statement-breakpoint
CREATE INDEX "group_points_group_time" ON "group_points" USING btree ("group_id","completed_at");--> statement-breakpoint
CREATE INDEX "group_tasks_group_idx" ON "group_tasks" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roadmap_share_unique" ON "roadmap_shares" USING btree ("roadmap_id","group_id");--> statement-breakpoint
CREATE INDEX "roadmap_share_group_idx" ON "roadmap_shares" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "groups" DROP COLUMN "settings";