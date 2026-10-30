CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "threads_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "threads_kind_check" CHECK ("threads"."kind" in ('chat', 'earlier')),
	CONSTRAINT "threads_title_check" CHECK (("threads"."kind" = 'chat') = ("threads"."title" is not null))
);
--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "threads_earlier_key" ON "threads" USING btree ("user_id") WHERE "threads"."kind" = 'earlier';--> statement-breakpoint
CREATE INDEX "threads_user_idx" ON "threads" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_thread_owner_fk" FOREIGN KEY ("thread_id","user_id") REFERENCES "public"."threads"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generations_user_thread_created_idx" ON "generations" USING btree ("user_id","thread_id","created_at");