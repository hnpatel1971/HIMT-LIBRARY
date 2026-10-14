CREATE TYPE "public"."copy_status" AS ENUM('available', 'repair', 'no_loan', 'missing', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'librarian', 'assistant');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"action" varchar(64) NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "collection_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	CONSTRAINT "collection_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "copies" (
	"id" serial PRIMARY KEY NOT NULL,
	"barcode" varchar(32) NOT NULL,
	"title_id" integer NOT NULL,
	"location_id" integer,
	"collection_type_id" integer,
	"status" "copy_status" DEFAULT 'available' NOT NULL,
	"call_number" varchar(64),
	"price" numeric(10, 2),
	"supplier" varchar(128),
	"invoice" varchar(64),
	"received_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copies_barcode_unique" UNIQUE("barcode")
);
--> statement-breakpoint
CREATE TABLE "fines" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"loan_id" integer,
	"amount" numeric(10, 2) NOT NULL,
	"reason" varchar(600) NOT NULL,
	"charged_on" date NOT NULL,
	"waived" boolean DEFAULT false NOT NULL,
	"waived_by" integer
);
--> statement-breakpoint
CREATE TABLE "formats" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	CONSTRAINT "formats_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"description" varchar(128) NOT NULL,
	CONSTRAINT "holidays_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"copy_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"returned_on" date,
	"renew_count" integer DEFAULT 0 NOT NULL,
	"issued_by" integer,
	"returned_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	CONSTRAINT "locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "member_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"loan_limit" integer DEFAULT 2 NOT NULL,
	"loan_days" integer DEFAULT 7 NOT NULL,
	"renew_limit" integer DEFAULT 1 NOT NULL,
	"fine_per_day" numeric(10, 2) DEFAULT '0' NOT NULL,
	"reserve_limit" integer DEFAULT 0 NOT NULL,
	"membership_days" integer DEFAULT 365 NOT NULL,
	CONSTRAINT "member_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(128) NOT NULL,
	"type_id" integer NOT NULL,
	"department" varchar(128),
	"email" varchar(128),
	"phone" varchar(32),
	"address" text,
	"joined_on" date,
	"expires_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"receipt_no" varchar(64),
	"note" varchar(255),
	"received_by" integer
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "titles" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(500) NOT NULL,
	"authors" jsonb NOT NULL,
	"subjects" jsonb NOT NULL,
	"publisher" varchar(255),
	"place" varchar(128),
	"year" varchar(20),
	"edition" varchar(64),
	"isbn" varchar(32),
	"call_number" varchar(64),
	"classification" varchar(64),
	"language" varchar(64),
	"format_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "role" DEFAULT 'assistant' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer,
	"visitor_name" varchar(128) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_collection_type_id_collection_types_id_fk" FOREIGN KEY ("collection_type_id") REFERENCES "public"."collection_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fines" ADD CONSTRAINT "fines_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fines" ADD CONSTRAINT "fines_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fines" ADD CONSTRAINT "fines_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_copy_id_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."copies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_type_id_member_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."member_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "titles" ADD CONSTRAINT "titles_format_id_formats_id_fk" FOREIGN KEY ("format_id") REFERENCES "public"."formats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "copies_title_idx" ON "copies" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX "loans_member_idx" ON "loans" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "loans_due_idx" ON "loans" USING btree ("due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "loans_one_open_per_copy" ON "loans" USING btree ("copy_id") WHERE "loans"."returned_on" is null;--> statement-breakpoint
CREATE INDEX "members_name_idx" ON "members" USING btree ("name");--> statement-breakpoint
CREATE INDEX "titles_isbn_idx" ON "titles" USING btree ("isbn");--> statement-breakpoint
CREATE INDEX "titles_title_idx" ON "titles" USING btree ("title");--> statement-breakpoint
CREATE INDEX "visits_at_idx" ON "visits" USING btree ("at");