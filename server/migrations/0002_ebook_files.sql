CREATE TYPE "public"."file_access" AS ENUM('public', 'staff');--> statement-breakpoint
CREATE TABLE "title_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"title_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"stored_name" varchar(64) NOT NULL,
	"size" integer NOT NULL,
	"access" "file_access" DEFAULT 'public' NOT NULL,
	"allow_download" boolean DEFAULT false NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "title_files_stored_name_unique" UNIQUE("stored_name")
);
--> statement-breakpoint
ALTER TABLE "title_files" ADD CONSTRAINT "title_files_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_files" ADD CONSTRAINT "title_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "title_files_title_idx" ON "title_files" USING btree ("title_id");