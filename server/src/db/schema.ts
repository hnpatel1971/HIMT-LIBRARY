import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

// Works on MySQL 8 and MariaDB 10.4+ (MilesWeb, XAMPP or any VPS).

const id = () => int("id").autoincrement().primaryKey();
const ref = (name: string) => int(name);
const day = (name: string) => date(name, { mode: "string" });
const money = (name: string) => decimal(name, { precision: 10, scale: 2 });

export const users = mysqlTable("users", {
  id: id(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["admin", "librarian", "assistant"]).notNull().default("assistant"),
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const memberTypes = mysqlTable("member_types", {
  id: id(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  loanLimit: int("loan_limit").notNull().default(2),
  loanDays: int("loan_days").notNull().default(7),
  renewLimit: int("renew_limit").notNull().default(1),
  finePerDay: money("fine_per_day").notNull().default("0"),
  reserveLimit: int("reserve_limit").notNull().default(0),
  membershipDays: int("membership_days").notNull().default(365),
});

export const members = mysqlTable(
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("members_name_idx").on(t.name)],
);

// Simple lookup lists maintained by staff.
export const locations = mysqlTable("locations", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});
export const collectionTypes = mysqlTable("collection_types", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});
export const formats = mysqlTable("formats", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});

export const titles = mysqlTable(
  "titles",
  {
    id: id(),
    title: varchar("title", { length: 500 }).notNull(),
    authors: json("authors").$type<string[]>().notNull(),
    subjects: json("subjects").$type<string[]>().notNull(),
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("titles_isbn_idx").on(t.isbn), index("titles_title_idx").on(t.title)],
);

export const copies = mysqlTable(
  "copies",
  {
    id: id(),
    barcode: varchar("barcode", { length: 32 }).notNull().unique(),
    titleId: ref("title_id")
      .notNull()
      .references(() => titles.id),
    locationId: ref("location_id").references(() => locations.id),
    collectionTypeId: ref("collection_type_id").references(() => collectionTypes.id),
    status: mysqlEnum("status", ["available", "repair", "no_loan", "missing", "withdrawn"])
      .notNull()
      .default("available"),
    callNumber: varchar("call_number", { length: 64 }),
    price: money("price"),
    supplier: varchar("supplier", { length: 128 }),
    invoice: varchar("invoice", { length: 64 }),
    receivedOn: day("received_on"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("copies_title_idx").on(t.titleId)],
);

export const loans = mysqlTable(
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
    renewCount: int("renew_count").notNull().default(0),
    issuedBy: ref("issued_by").references(() => users.id),
    returnedBy: ref("returned_by").references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // Equals copy_id while the loan is open, NULL once returned. Its unique
    // index means a copy can be on only one open loan at a time.
    openCopyId: int("open_copy_id").generatedAlwaysAs(sql`(case when returned_on is null then copy_id end)`, {
      mode: "stored",
    }),
  },
  (t) => [
    index("loans_member_idx").on(t.memberId),
    index("loans_due_idx").on(t.dueOn),
    uniqueIndex("loans_one_open_per_copy").on(t.openCopyId),
  ],
);

export const fines = mysqlTable("fines", {
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

export const payments = mysqlTable("payments", {
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

export const holidays = mysqlTable("holidays", {
  id: id(),
  date: day("date").notNull().unique(),
  description: varchar("description", { length: 128 }).notNull(),
});

export const visits = mysqlTable(
  "visits",
  {
    id: id(),
    memberId: ref("member_id").references(() => members.id),
    visitorName: varchar("visitor_name", { length: 128 }).notNull(),
    at: timestamp("at").notNull().defaultNow(),
  },
  (t) => [index("visits_at_idx").on(t.at)],
);

// Key/value settings: library name, weekly off-days, and similar.
export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: json("value").notNull(),
});

export const auditLog = mysqlTable(
  "audit_log",
  {
    id: id(),
    at: timestamp("at").notNull().defaultNow(),
    userId: ref("user_id").references(() => users.id),
    action: varchar("action", { length: 64 }).notNull(),
    details: json("details"),
  },
  (t) => [index("audit_log_at_idx").on(t.at)],
);

