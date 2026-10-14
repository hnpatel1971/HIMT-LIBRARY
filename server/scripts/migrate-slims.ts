/**
 * Copies the HIMT library data out of the old SLiMS database into this system.
 *
 *   SLIMS_DATABASE_URL=mysql://user:pass@host/himt_lib \
 *   DATABASE_URL=postgres://user:pass@host/library \
 *   pnpm migrate:slims [--reset]
 *
 * The target must be empty (a fresh install), or pass --reset to wipe the
 * target's library data first. Staff keep their SLiMS passwords.
 */
import mysql from "mysql2/promise";
import { eq, sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { migrateAndSeed } from "../src/db/migrate.js";

const source = process.env.SLIMS_DATABASE_URL;
if (!source) throw new Error("Set SLIMS_DATABASE_URL to the old SLiMS database");
const reset = process.argv.includes("--reset");

type Row = Record<string, any>;
const slims = await mysql.createConnection({ uri: source, dateStrings: true });
const q = async (s: string) => (await slims.query(s))[0] as Row[];

const clean = (v: unknown) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s !== "0000-00-00" ? s : null;
};
const day = (v: unknown) => clean(v)?.slice(0, 10) ?? null;
// SLiMS stores local (India) time without a zone.
const ist = (v: unknown) => new Date(`${String(v).trim().replace(" ", "T")}+05:30`);
const report: string[] = [];
const warn = (msg: string) => report.push(`WARNING: ${msg}`);

async function insertChunks<T extends Record<string, unknown>>(table: any, rows: T[]) {
  for (let i = 0; i < rows.length; i += 500) await db.insert(table).values(rows.slice(i, i + 500));
}

await migrateAndSeed();

const tables = ["visits", "payments", "fines", "loans", "copies", "titles", "members", "member_types", "formats", "collection_types", "locations", "holidays"];
const [{ n }] = (await db.execute(sql`SELECT (SELECT count(*) FROM titles) + (SELECT count(*) FROM members) AS n`)).rows as Row[];
if (Number(n) > 0) {
  if (!reset) throw new Error("The target already has titles or members. Run with --reset to replace them");
  await db.execute(sql.raw(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`));
  await db.execute(sql`DELETE FROM audit_log WHERE action NOT LIKE 'auth.%' AND action NOT LIKE 'user.%'`);
}

// Lookup lists keep their SLiMS names; we map old ids to new ids.
async function lookup(table: any, rows: Row[], idCol: string, nameCol: string) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const name = clean(r[nameCol]);
    if (!name) continue;
    const [{ id }] = await db.insert(table).values({ name }).returning({ id: table.id });
    map.set(String(r[idCol]), id);
  }
  return map;
}
const locationIds = await lookup(schema.locations, await q("SELECT location_id, location_name FROM mst_location"), "location_id", "location_name");
const collIds = await lookup(schema.collectionTypes, await q("SELECT coll_type_id, coll_type_name FROM mst_coll_type"), "coll_type_id", "coll_type_name");
const formatIds = await lookup(
  schema.formats,
  await q("SELECT DISTINCT g.gmd_id, g.gmd_name FROM mst_gmd g JOIN biblio b ON b.gmd_id = g.gmd_id"),
  "gmd_id",
  "gmd_name",
);

// Member types, with the loan-rule overrides SLiMS applies on top.
const rules = new Map(
  (await q("SELECT * FROM mst_loan_rules WHERE coll_type_id = 0 AND gmd_id = 0")).map((r) => [String(r.member_type_id), r]),
);
const typeIds = new Map<string, number>();
for (const t of await q("SELECT * FROM mst_member_type")) {
  const r = rules.get(String(t.member_type_id));
  const [{ id }] = await db
    .insert(schema.memberTypes)
    .values({
      name: t.member_type_name.trim(),
      loanLimit: Number(r?.loan_limit ?? t.loan_limit),
      loanDays: Math.max(1, Number(r?.loan_periode ?? t.loan_periode)),
      renewLimit: Number(r?.reborrow_limit ?? t.reborrow_limit ?? 0),
      finePerDay: Number(r?.fine_each_day ?? t.fine_each_day ?? 0).toFixed(2),
      reserveLimit: t.enable_reserve ? Number(t.reserve_limit) : 0,
      membershipDays: Number(t.member_periode) || 365,
    })
    .returning({ id: schema.memberTypes.id });
  typeIds.set(String(t.member_type_id), id);
}

// Members
const memberIds = new Map<string, number>();
for (const m of await q("SELECT * FROM member")) {
  const typeId = typeIds.get(String(m.member_type_id));
  if (!typeId) {
    warn(`member ${m.member_id} has unknown type ${m.member_type_id}; skipped`);
    continue;
  }
  const [{ id }] = await db
    .insert(schema.members)
    .values({
      code: String(m.member_id).trim(),
      name: String(m.member_name).trim(),
      typeId,
      department: clean(m.inst_name),
      // SLiMS staff often typed the email into the mailing-address field.
      email: clean(m.member_email) ?? (clean(m.member_mail_address)?.includes("@") ? clean(m.member_mail_address) : null),
      phone: clean(m.member_phone),
      address: clean(m.member_address) ?? (clean(m.member_mail_address)?.includes("@") ? null : clean(m.member_mail_address)),
      joinedOn: day(m.member_since_date) ?? day(m.register_date),
      expiresOn: day(m.expire_date),
      active: !m.is_pending,
      notes: clean(m.member_notes),
    })
    .returning({ id: schema.members.id });
  memberIds.set(String(m.member_id).trim(), id);
}

// Loans and fines can point at members deleted in SLiMS. Keep that history
// under an inactive placeholder member instead of dropping it.
const fallbackType = typeIds.values().next().value!;
for (const r of await q(`SELECT DISTINCT x.member_id FROM (
    SELECT member_id FROM loan UNION SELECT member_id FROM fines) x
    LEFT JOIN member m ON m.member_id = x.member_id WHERE m.member_id IS NULL`)) {
  const code = String(r.member_id).trim();
  const [{ id }] = await db
    .insert(schema.members)
    .values({ code, name: `Deleted member ${code}`, typeId: fallbackType, active: false, notes: "Deleted in SLiMS before migration" })
    .returning({ id: schema.members.id });
  memberIds.set(code, id);
  warn(`member ${code} was deleted in SLiMS but has loans or fines; kept as an inactive placeholder`);
}

// Titles, with authors and subjects folded in.
const authors = new Map<string, string[]>();
for (const r of await q(
  "SELECT ba.biblio_id, a.author_name FROM biblio_author ba JOIN mst_author a ON a.author_id = ba.author_id ORDER BY ba.biblio_id, ba.level",
)) {
  const k = String(r.biblio_id);
  authors.set(k, [...(authors.get(k) ?? []), r.author_name.trim()]);
}
const subjects = new Map<string, string[]>();
for (const r of await q(
  "SELECT bt.biblio_id, t.topic FROM biblio_topic bt JOIN mst_topic t ON t.topic_id = bt.topic_id ORDER BY bt.biblio_id, bt.level",
)) {
  const k = String(r.biblio_id);
  subjects.set(k, [...(subjects.get(k) ?? []), r.topic.trim()]);
}
const titleIds = new Map<string, number>();
for (const b of await q(`SELECT b.*, p.publisher_name, pl.place_name, l.language_name
    FROM biblio b
    LEFT JOIN mst_publisher p ON p.publisher_id = b.publisher_id
    LEFT JOIN mst_place pl ON pl.place_id = b.publish_place_id
    LEFT JOIN mst_language l ON l.language_id = b.language_id`)) {
  const k = String(b.biblio_id);
  const [{ id }] = await db
    .insert(schema.titles)
    .values({
      title: String(b.title).trim().slice(0, 500),
      authors: authors.get(k) ?? [],
      subjects: subjects.get(k) ?? [],
      publisher: clean(b.publisher_name),
      place: clean(b.place_name),
      year: clean(b.publish_year),
      edition: clean(b.edition),
      isbn: clean(b.isbn_issn),
      callNumber: clean(b.call_number),
      classification: clean(b.classification),
      language: clean(b.language_name),
      formatId: formatIds.get(String(b.gmd_id)) ?? null,
      notes: clean(b.notes),
      createdAt: clean(b.input_date) ? ist(b.input_date) : new Date(),
    })
    .returning({ id: schema.titles.id });
  titleIds.set(k, id);
}

// Copies
const statusOf: Record<string, "repair" | "no_loan" | "missing"> = { R: "repair", NL: "no_loan", MIS: "missing" };
const suppliers = new Map((await q("SELECT supplier_id, supplier_name FROM mst_supplier")).map((r) => [String(r.supplier_id), r.supplier_name]));
const copyIds = new Map<string, number>();
for (const i of await q("SELECT * FROM item")) {
  const titleId = titleIds.get(String(i.biblio_id));
  const code = clean(i.item_code);
  if (!titleId || !code) {
    warn(`copy ${i.item_code ?? i.item_id} has no title or barcode; skipped`);
    continue;
  }
  const price = Number(i.price);
  const [{ id }] = await db
    .insert(schema.copies)
    .values({
      barcode: code,
      titleId,
      locationId: locationIds.get(String(i.location_id)) ?? null,
      collectionTypeId: collIds.get(String(i.coll_type_id)) ?? null,
      status: statusOf[String(i.item_status_id)] ?? "available",
      callNumber: clean(i.call_number),
      price: price > 0 ? price.toFixed(2) : null,
      supplier: suppliers.get(String(i.supplier_id)) ?? null,
      invoice: clean(i.invoice),
      receivedOn: day(i.received_date),
    })
    .returning({ id: schema.copies.id });
  copyIds.set(code, id);
}

// Loans. Oldest first, so if SLiMS shows a copy on two open loans the later one wins.
const loanIds = new Map<string, number>();
const openByCopy = new Map<number, number>();
for (const l of await q("SELECT * FROM loan ORDER BY loan_date, loan_id")) {
  const copyId = copyIds.get(String(l.item_code).trim());
  const memberId = memberIds.get(String(l.member_id).trim());
  if (!copyId || !memberId) {
    warn(`loan ${l.loan_id} (${l.item_code} to ${l.member_id}) refers to a missing copy or member; skipped`);
    continue;
  }
  const returned = Number(l.is_return) === 1;
  const returnedOn = returned ? day(l.return_date) ?? day(l.last_update) ?? day(l.due_date) : null;
  if (!returned && openByCopy.has(copyId)) {
    const earlier = openByCopy.get(copyId)!;
    await db.update(schema.loans).set({ returnedOn: day(l.loan_date) }).where(sql`id = ${earlier}`);
    warn(`copy ${l.item_code} was on two open loans; marked the earlier one returned on ${day(l.loan_date)}`);
  }
  const [{ id }] = await db
    .insert(schema.loans)
    .values({
      copyId,
      memberId,
      issuedOn: day(l.loan_date)!,
      dueOn: day(l.due_date) ?? day(l.loan_date)!,
      returnedOn,
      renewCount: Number(l.renewed) || 0,
    })
    .returning({ id: schema.loans.id });
  loanIds.set(String(l.loan_id), id);
  if (!returned) openByCopy.set(copyId, id);
}

// Fines: SLiMS keeps charges (debet) and payments (credit) in one table.
const fineRows: (typeof schema.fines.$inferInsert)[] = [];
const paymentRows: (typeof schema.payments.$inferInsert)[] = [];
for (const f of await q("SELECT * FROM fines")) {
  const memberId = memberIds.get(String(f.member_id).trim());
  if (!memberId) {
    warn(`fine ${f.fines_id} for unknown member ${f.member_id}; skipped`);
    continue;
  }
  const on = day(f.fines_date) ?? "2026-01-01";
  if (Number(f.debet) > 0) {
    fineRows.push({ memberId, amount: Number(f.debet).toFixed(2), reason: (clean(f.description) ?? "Overdue fine").slice(0, 600), chargedOn: on });
  }
  if (Number(f.credit) > 0) {
    paymentRows.push({ memberId, amount: Number(f.credit).toFixed(2), paidOn: on, note: "Recorded in SLiMS" });
  }
}
await insertChunks(schema.fines, fineRows);
await insertChunks(schema.payments, paymentRows);

// Calendar
const dayNumber: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const weeklyOff = new Set<number>();
for (const h of await q("SELECT * FROM holiday")) {
  const date = day(h.holiday_date);
  if (date) {
    await db.insert(schema.holidays).values({ date, description: clean(h.description) ?? "Holiday" }).onConflictDoUpdate({ target: schema.holidays.date, set: { date } });
  } else if (clean(h.holiday_dayname)) {
    const d = dayNumber[String(h.holiday_dayname).toLowerCase().slice(0, 3)];
    if (d !== undefined) weeklyOff.add(d);
  }
}
if (weeklyOff.size) {
  const value = [...weeklyOff].sort();
  await db.insert(schema.settings).values({ key: "weekly_off", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}
const [libName] = await q("SELECT setting_value FROM setting WHERE setting_name = 'library_name'");
const nameMatch = libName && /s:\d+:"(.*)";/.exec(libName.setting_value);
if (nameMatch?.[1]) {
  await db
    .insert(schema.settings)
    .values({ key: "library_name", value: nameMatch[1] })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: nameMatch[1] } });
}

// Visits
const visitRows = (await q("SELECT * FROM visitor_count")).map((v) => ({
  memberId: memberIds.get(String(v.member_id).trim()) ?? null,
  visitorName: String(v.member_name ?? "Visitor").trim().slice(0, 128) || "Visitor",
  at: ist(v.checkin_date),
}));
await insertChunks(schema.visits, visitRows);

// Staff users keep their passwords (SLiMS also uses bcrypt). Existing users with
// the same username are left alone.
let usersAdded = 0;
for (const u of await q("SELECT * FROM user")) {
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, String(u.username).trim()));
  if (existing) continue;
  const isAdmin = /s:\d+:"1"/.test(String(u.groups ?? ""));
  await db.insert(schema.users).values({
    username: String(u.username).trim(),
    name: String(u.realname ?? u.username).trim(),
    passwordHash: u.passwd,
    role: isAdmin ? "admin" : "librarian",
  });
  usersAdded++;
}

const count = async (t: string) =>
  Number(((await db.execute(sql.raw(`SELECT count(*) AS n FROM ${t}`))).rows as Row[])[0].n);
console.log("Migration finished:");
for (const t of ["member_types", "members", "titles", "copies", "loans", "fines", "payments", "holidays", "visits"]) {
  console.log(`  ${t.padEnd(14)} ${await count(t)}`);
}
console.log(`  open loans     ${openByCopy.size}`);
console.log(`  staff users    ${usersAdded} added`);
for (const line of report) console.log(line);

await slims.end();
await pool.end();
