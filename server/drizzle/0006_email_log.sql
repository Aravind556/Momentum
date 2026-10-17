CREATE TABLE "email_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_log_unique" ON "email_log" USING btree ("user_id","key","channel");