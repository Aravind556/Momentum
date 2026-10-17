CREATE TABLE "item_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"status" text NOT NULL,
	"done_at" timestamp with time zone,
	"verified_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_follows" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"roadmap_id" text NOT NULL,
	"via_group_id" text,
	"settings" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_items" (
	"id" text PRIMARY KEY NOT NULL,
	"roadmap_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"category" text NOT NULL,
	"platform" text,
	"problem_key" text,
	"difficulty" text,
	"est_minutes" integer NOT NULL,
	"section" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmaps" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text,
	"subject" text NOT NULL,
	"category" text NOT NULL,
	"platform" text,
	"problem_key" text,
	"title" text NOT NULL,
	"url" text,
	"algorithm" text DEFAULT 'sm2' NOT NULL,
	"ef" real DEFAULT 2.5 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"base_interval" integer DEFAULT 1 NOT NULL,
	"state" jsonb,
	"multiplier" real DEFAULT 1 NOT NULL,
	"max_per_day" integer DEFAULT 3 NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"last_reviewed_on" text NOT NULL,
	"due_date" text NOT NULL,
	"last_quality" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_progress" ADD CONSTRAINT "item_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_progress" ADD CONSTRAINT "item_progress_item_id_roadmap_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."roadmap_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_follows" ADD CONSTRAINT "roadmap_follows_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_follows" ADD CONSTRAINT "roadmap_follows_roadmap_id_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_roadmap_id_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_item_id_roadmap_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."roadmap_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_progress_unique" ON "item_progress" USING btree ("user_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roadmap_follow_unique" ON "roadmap_follows" USING btree ("user_id","roadmap_id");--> statement-breakpoint
CREATE INDEX "roadmap_follow_roadmap_idx" ON "roadmap_follows" USING btree ("roadmap_id");--> statement-breakpoint
CREATE INDEX "roadmap_items_roadmap_idx" ON "roadmap_items" USING btree ("roadmap_id","position");--> statement-breakpoint
CREATE INDEX "roadmaps_owner_idx" ON "roadmaps" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_user_subject" ON "reviews" USING btree ("user_id","subject");--> statement-breakpoint
CREATE INDEX "reviews_user_due" ON "reviews" USING btree ("user_id","due_date");