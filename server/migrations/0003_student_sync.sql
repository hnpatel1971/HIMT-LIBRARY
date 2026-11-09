CREATE TYPE "public"."sync_kind" AS ENUM('daily', 'full');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'ok', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "batches" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"presea_batch_id" varchar(64),
	"students" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "courses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "sync_kind" NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"started_by" integer,
	"batches" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "batch_id" varchar(16);--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batches_course_idx" ON "batches" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "sync_runs_started_idx" ON "sync_runs" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_batch_idx" ON "members" USING btree ("batch_id");--> statement-breakpoint
-- The fixed course list. "GP  RATING" has two spaces because the central API needs it that way.
INSERT INTO "courses" ("code", "name") VALUES
	('B.Tech(ME)', 'B.Tech(ME)'),
	('BSc(NS)', 'BSc(NS)'),
	('GME', 'GME'),
	('GP  RATING', 'GP RATING'),
	('ETO', 'ETO'),
	('OCCP', 'OCCP'),
	('B.Tech(Lateral)', 'B.Tech(Lateral)'),
	('DNS', 'DNS');
