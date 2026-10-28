ALTER TABLE "generations" ADD COLUMN "storage_path" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "mirror_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "mirror_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "mirror_error" text;