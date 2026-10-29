CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_not_blank" CHECK (btrim("teams"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "team_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_lower_key" ON "teams" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;