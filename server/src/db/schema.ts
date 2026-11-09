import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "librarian", "assistant"]);
export const fileAccessEnum = pgEnum("file_access", ["public", "staff"]);
export const copyStatusEnum = pgEnum("copy_status", ["available", "repair", "no_loan", "missing", "withdrawn"]);

const id = () => serial("id").primaryKey();
const ref = (name: string) => integer(name);
const day = (name: string) => date(name, { mode: "string" });
const money = (name: string) => numeric(name, { precision: 10, scale: 2 });

export const users = pgTable("users", {
  id: id(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: roleEnum("role").notNull().default("assistant"),
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberTypes = pgTable("member_types", {
  id: id(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  loanLimit: integer("loan_limit").notNull().default(2),
  loanDays: integer("loan_days").notNull().default(7),
  renewLimit: integer("renew_limit").notNull().default(1),
  finePerDay: money("fine_per_day").notNull().default("0"),
  reserveLimit: integer("reserve_limit").notNull().default(0),
  membershipDays: integer("membership_days").notNull().default(365),
});

export const members = pgTable(
  "members",
  {
    id: id(),
    code: varchar("code", { length: 32 }).notNull().unique(),
    name: varchar("name", { length: 128 }).notNull(),
    typeId: ref("type_id")
      .notNull()
      .references(() => memberTypes.id),
    department: varchar("department", { length: 128 }),
    email: varchar("email", { length: 128 }),
    phone: varchar("phone", { length: 32 }),
    address: text("address"),
    joinedOn: day("joined_on"),
    expiresOn: day("expires_on"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    // Set for students brought in from the central HIMT server.
    batchId: varchar("batch_id", { length: 16 }).references(() => batches.id),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("members_name_idx").on(t.name), index("members_batch_idx").on(t.batchId)],
);

// Courses whose students come from the central HIMT server. The list is fixed
// (seeded by migration); code is exactly what the central API expects.
export const courses = pgTable("courses", {
  id: id(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 64 }).notNull(),
  active: boolean("active").notNull().default(true),
});

// Batches as the central server reports them; id is its Batch_Id, e.g. B48496.
export const batches = pgTable(
  "batches",
  {
    id: varchar("id", { length: 16 }).primaryKey(),
    courseId: ref("course_id")
      .notNull()
      .references(() => courses.id),
    name: varchar("name", { length: 200 }).notNull(),
    startsOn: day("starts_on"),
    endsOn: day("ends_on"),
    preseaBatchId: varchar("presea_batch_id", { length: 64 }),
    students: integer("students").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
  },
  (t) => [index("batches_course_idx").on(t.courseId)],
);

export const syncKindEnum = pgEnum("sync_kind", ["daily", "full"]);
export const syncStatusEnum = pgEnum("sync_status", ["running", "ok", "partial", "failed"]);

// One row per student sync run, shown in Settings > Student sync.
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    kind: syncKindEnum("kind").notNull(),
    status: syncStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    // Staff user who pressed Sync now; null for the nightly run.
    startedBy: ref("started_by").references(() => users.id),
    batches: integer("batches").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    unchanged: integer("unchanged").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
  },
  (t) => [index("sync_runs_started_idx").on(t.startedAt)],
);

// Simple lookup lists maintained by staff.
export const locations = pgTable("locations", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});
export const collectionTypes = pgTable("collection_types", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});
export const formats = pgTable("formats", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});

export const titles = pgTable(
  "titles",
  {
    id: id(),
    title: varchar("title", { length: 500 }).notNull(),
    authors: jsonb("authors").$type<string[]>().notNull(),
    // An organisation responsible for the work, e.g. IMO or DG Shipping.
    corporateAuthor: varchar("corporate_author", { length: 255 }),
    subjects: jsonb("subjects").$type<string[]>().notNull(),
    publisher: varchar("publisher", { length: 255 }),
    place: varchar("place", { length: 128 }),
    year: varchar("year", { length: 20 }),
    edition: varchar("edition", { length: 64 }),
    isbn: varchar("isbn", { length: 32 }),
    callNumber: varchar("call_number", { length: 64 }),
    classification: varchar("classification", { length: 64 }),
    language: varchar("language", { length: 64 }),
    formatId: ref("format_id").references(() => formats.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("titles_isbn_idx").on(t.isbn), index("titles_title_idx").on(t.title)],
);

export const copies = pgTable(
  "copies",
  {
    id: id(),
    barcode: varchar("barcode", { length: 32 }).notNull().unique(),
    titleId: ref("title_id")
      .notNull()
      .references(() => titles.id),
    locationId: ref("location_id").references(() => locations.id),
    collectionTypeId: ref("collection_type_id").references(() => collectionTypes.id),
    status: copyStatusEnum("status")
      .notNull()
      .default("available"),
    callNumber: varchar("call_number", { length: 64 }),
    price: money("price"),
    supplier: varchar("supplier", { length: 128 }),
    invoice: varchar("invoice", { length: 64 }),
    receivedOn: day("received_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("copies_title_idx").on(t.titleId)],
);

// E-book files (PDF) attached to a title, read online through the catalogue.
export const titleFiles = pgTable(
  "title_files",
  {
    id: id(),
    titleId: ref("title_id")
      .notNull()
      .references(() => titles.id),
    name: varchar("name", { length: 255 }).notNull(),
    // File name on disk, under FILES_DIR.
    storedName: varchar("stored_name", { length: 64 }).notNull().unique(),
    size: integer("size").notNull(),
    // public: anyone using the catalogue; staff: only signed-in staff.
    access: fileAccessEnum("access").notNull().default("public"),
    allowDownload: boolean("allow_download").notNull().default(false),
    opens: integer("opens").notNull().default(0),
    uploadedBy: ref("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("title_files_title_idx").on(t.titleId)],
);

export const loans = pgTable(
  "loans",
  {
    id: id(),
    copyId: ref("copy_id")
      .notNull()
      .references(() => copies.id),
    memberId: ref("member_id")
      .notNull()
      .references(() => members.id),
    issuedOn: day("issued_on").notNull(),
    dueOn: day("due_on").notNull(),
    returnedOn: day("returned_on"),
    renewCount: integer("renew_count").notNull().default(0),
    issuedBy: ref("issued_by").references(() => users.id),
    returnedBy: ref("returned_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("loans_member_idx").on(t.memberId),
    index("loans_due_idx").on(t.dueOn),
    // A copy can be on only one open loan at a time.
    uniqueIndex("loans_one_open_per_copy").on(t.copyId).where(sql`${t.returnedOn} is null`),
  ],
);

export const fines = pgTable("fines", {
  id: id(),
  memberId: ref("member_id")
    .notNull()
    .references(() => members.id),
  loanId: ref("loan_id").references(() => loans.id),
  amount: money("amount").notNull(),
  reason: varchar("reason", { length: 600 }).notNull(),
  chargedOn: day("charged_on").notNull(),
  waived: boolean("waived").notNull().default(false),
  waivedBy: ref("waived_by").references(() => users.id),
});

export const payments = pgTable("payments", {
  id: id(),
  memberId: ref("member_id")
    .notNull()
    .references(() => members.id),
  amount: money("amount").notNull(),
  paidOn: day("paid_on").notNull(),
  receiptNo: varchar("receipt_no", { length: 64 }),
  note: varchar("note", { length: 255 }),
  receivedBy: ref("received_by").references(() => users.id),
});

export const holidays = pgTable("holidays", {
  id: id(),
  date: day("date").notNull().unique(),
  description: varchar("description", { length: 128 }).notNull(),
});

export const visits = pgTable(
  "visits",
  {
    id: id(),
    memberId: ref("member_id").references(() => members.id),
    visitorName: varchar("visitor_name", { length: 128 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("visits_at_idx").on(t.at)],
);

// Key/value settings: library name, weekly off-days, and similar.
export const settings = pgTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: ref("user_id").references(() => users.id),
    action: varchar("action", { length: 64 }).notNull(),
    details: jsonb("details"),
  },
  (t) => [index("audit_log_at_idx").on(t.at)],
);

