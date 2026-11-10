ALTER TYPE "public"."file_access" ADD VALUE 'granted';--> statement-breakpoint
CREATE TABLE "ebook_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"title_id" integer NOT NULL,
	"granted_by" integer,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ebook_access" ADD CONSTRAINT "ebook_access_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_access" ADD CONSTRAINT "ebook_access_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_access" ADD CONSTRAINT "ebook_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ebook_access_member_title" ON "ebook_access" USING btree ("member_id","title_id");--> statement-breakpoint
CREATE INDEX "ebook_access_title_idx" ON "ebook_access" USING btree ("title_id");