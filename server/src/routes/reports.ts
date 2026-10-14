import { Router } from "express";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireRole } from "../auth.js";
import { balanceSql, overdueWhere } from "../circulation.js";
import { addDays, today } from "../calendar.js";
import { notFound } from "../errors.js";
import { listTitles, titleDetail } from "./catalogue.js";

const { loans, copies, titles, members, memberTypes, locations, collectionTypes, formats, visits, settings, fines, payments } =
  schema;

const n = (v: unknown) => Number(v ?? 0);

export const reportsRouter = Router();

reportsRouter.get("/dashboard", requireRole("assistant"), async (_req, res) => {
  const on = today();
  const [row] = await db.execute(sql`SELECT
    (SELECT count(*) FROM titles) AS titles,
    (SELECT count(*) FROM copies) AS copies,
    (SELECT count(*) FROM members WHERE active) AS members,
    (SELECT count(*) FROM loans WHERE returned_on IS NULL) AS onLoan,
    (SELECT count(*) FROM loans WHERE returned_on IS NULL AND due_on < ${on}) AS overdue,
    (SELECT count(*) FROM loans WHERE issued_on = ${on}) AS issuedToday,
    (SELECT count(*) FROM loans WHERE returned_on = ${on}) AS returnedToday,
    (SELECT count(*) FROM visits WHERE DATE(at) = ${on}) AS visitsToday,
    (SELECT COALESCE(SUM(amount),0) FROM fines WHERE NOT waived) - (SELECT COALESCE(SUM(amount),0) FROM payments) AS finesOutstanding`);
  const r = (row as unknown as Record<string, unknown>[])[0];
  res.json(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, n(v)])));
});

const loanRow = {
  id: loans.id,
  barcode: copies.barcode,
  title: titles.title,
  titleId: titles.id,
  memberId: members.id,
  memberCode: members.code,
  member: members.name,
  phone: members.phone,
  memberType: memberTypes.name,
  issuedOn: loans.issuedOn,
  dueOn: loans.dueOn,
  returnedOn: loans.returnedOn,
  renewCount: loans.renewCount,
};

function loanQuery() {
  return db
    .select(loanRow)
    .from(loans)
    .innerJoin(copies, eq(loans.copyId, copies.id))
    .innerJoin(titles, eq(copies.titleId, titles.id))
    .innerJoin(members, eq(loans.memberId, members.id))
    .innerJoin(memberTypes, eq(members.typeId, memberTypes.id));
}

reportsRouter.get("/reports/overdue", requireRole("assistant"), async (_req, res) => {
  const on = today();
  const rows = await loanQuery().where(overdueWhere(on)).orderBy(asc(loans.dueOn));
  res.json(
    rows.map((r) => ({
      ...r,
      daysOverdue: Math.round((Date.parse(on) - Date.parse(r.dueOn)) / 86_400_000),
    })),
  );
});

reportsRouter.get("/reports/due-soon", requireRole("assistant"), async (_req, res) => {
  const on = today();
  res.json(
    await loanQuery()
      .where(and(isNull(loans.returnedOn), gte(loans.dueOn, on), lte(loans.dueOn, addDays(on, 3))))
      .orderBy(asc(loans.dueOn)),
  );
});

const period = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

reportsRouter.get("/reports/loans", requireRole("assistant"), async (req, res) => {
  const { from, to } = period.parse({ from: req.query.from ?? addDays(today(), -30), to: req.query.to ?? today() });
  const rows = await loanQuery()
    .where(and(gte(loans.issuedOn, from), lte(loans.issuedOn, to)))
    .orderBy(desc(loans.issuedOn), desc(loans.id));
  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.memberType, (byType.get(r.memberType) ?? 0) + 1);
  res.json({ from, to, total: rows.length, byMemberType: Object.fromEntries(byType), rows });
});

reportsRouter.get("/reports/fines", requireRole("assistant"), async (_req, res) => {
  const rows = await db
    .select({
      id: members.id,
      code: members.code,
      name: members.name,
      phone: members.phone,
      charged: sql<string>`(SELECT COALESCE(SUM(amount),0) FROM fines f WHERE f.member_id = ${members.id} AND NOT f.waived)`,
      paid: sql<string>`(SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.member_id = ${members.id})`,
      balance: balanceSql(members.id),
    })
    .from(members)
    .where(sql`${balanceSql(members.id)} > 0`)
    .orderBy(sql`balance DESC`);
  const out = rows.map((r) => ({ ...r, charged: n(r.charged), paid: n(r.paid), balance: n(r.balance) }));
  const [tot] = await db.select({ charged: sql`COALESCE(SUM(amount),0)` }).from(fines).where(eq(fines.waived, false));
  const [paid] = await db.select({ paid: sql`COALESCE(SUM(amount),0)` }).from(payments);
  res.json({ totalCharged: n(tot.charged), totalPaid: n(paid.paid), rows: out });
});

reportsRouter.get("/reports/collection", requireRole("assistant"), async (_req, res) => {
  const byLocation = await db
    .select({ name: sql<string>`COALESCE(${locations.name}, 'Not set')`, copies: sql<number>`count(*)` })
    .from(copies)
    .leftJoin(locations, eq(copies.locationId, locations.id))
    .groupBy(locations.name)
    .orderBy(asc(locations.name));
  const byCollectionType = await db
    .select({ name: sql<string>`COALESCE(${collectionTypes.name}, 'Not set')`, copies: sql<number>`count(*)` })
    .from(copies)
    .leftJoin(collectionTypes, eq(copies.collectionTypeId, collectionTypes.id))
    .groupBy(collectionTypes.name)
    .orderBy(asc(collectionTypes.name));
  const byFormat = await db
    .select({ name: sql<string>`COALESCE(${formats.name}, 'Not set')`, titles: sql<number>`count(*)` })
    .from(titles)
    .leftJoin(formats, eq(titles.formatId, formats.id))
    .groupBy(formats.name);
  const byStatus = await db
    .select({ name: copies.status, copies: sql<number>`count(*)` })
    .from(copies)
    .groupBy(copies.status);
  res.json({
    byLocation: byLocation.map((r) => ({ name: r.name, copies: n(r.copies) })),
    byCollectionType: byCollectionType.map((r) => ({ name: r.name, copies: n(r.copies) })),
    byFormat: byFormat.map((r) => ({ name: r.name, titles: n(r.titles) })),
    byStatus: byStatus.map((r) => ({ name: r.name, copies: n(r.copies) })),
  });
});

reportsRouter.get("/reports/visits", requireRole("assistant"), async (req, res) => {
  const { from, to } = period.parse({ from: req.query.from ?? addDays(today(), -30), to: req.query.to ?? today() });
  const rows = await db
    .select({ day: sql<string>`DATE(${visits.at})`, visits: sql<number>`count(*)` })
    .from(visits)
    .where(sql`DATE(${visits.at}) BETWEEN ${from} AND ${to}`)
    .groupBy(sql`DATE(${visits.at})`)
    .orderBy(sql`DATE(${visits.at})`);
  res.json({ from, to, rows: rows.map((r) => ({ day: r.day, visits: n(r.visits) })) });
});

/** Library entrance check-in by member ID. */
reportsRouter.post("/visits", requireRole("assistant"), async (req, res) => {
  const { memberCode } = z.object({ memberCode: z.string().trim().min(1) }).parse(req.body);
  const [m] = await db.select().from(members).where(eq(members.code, memberCode));
  if (!m) throw notFound(`Member ${memberCode}`);
  await db.insert(visits).values({ memberId: m.id, visitorName: m.name });
  res.status(201).json({ name: m.name });
});

// Public catalogue (OPAC): no login, no staff-only fields.
export const opacRouter = Router();

opacRouter.get("/opac/info", async (_req, res) => {
  const [name] = await db.select().from(settings).where(eq(settings.key, "library_name"));
  res.json({ libraryName: name?.value ?? "Library" });
});
opacRouter.get("/opac/titles", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  res.json(await listTitles(req.query.q as string | undefined, page, 20));
});
opacRouter.get("/opac/titles/:id", async (req, res) => {
  const t = await titleDetail(Number(req.params.id), false);
  res.json({ ...t, notes: undefined });
});
