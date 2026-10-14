import { Router } from "express";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireRole } from "../auth.js";
import { audit } from "../audit.js";
import { badRequest, notFound } from "../errors.js";

const { titles, copies, loans, locations, collectionTypes, formats, members } = schema;

const opt = z.string().trim().nullish().transform((v) => (v ? v : null));
const list = z
  .array(z.string().trim())
  .default([])
  .transform((a) => a.filter(Boolean));

export const titleInput = z.object({
  title: z.string().trim().min(1, "Title is required"),
  authors: list,
  subjects: list,
  publisher: opt,
  place: opt,
  year: opt,
  edition: opt,
  isbn: opt,
  callNumber: opt,
  classification: opt,
  language: opt,
  formatId: z.number().int().nullish(),
  notes: opt,
});

export const copyInput = z.object({
  barcode: z.string().trim().min(1, "Barcode is required"),
  locationId: z.number().int().nullish(),
  collectionTypeId: z.number().int().nullish(),
  status: z.enum(["available", "repair", "no_loan", "missing", "withdrawn"]).default("available"),
  callNumber: opt,
  price: z.coerce.number().nonnegative().nullish().transform((v) => (v == null ? null : v.toFixed(2))),
  supplier: opt,
  invoice: opt,
  receivedOn: opt,
});

/** Search used by both staff and the public catalogue. */
export function titleSearch(q: string | undefined) {
  const term = q?.trim();
  if (!term) return undefined;
  const like = `%${term}%`;
  return sql`(${titles.title} LIKE ${like}
    OR CAST(${titles.authors} AS CHAR) LIKE ${like}
    OR CAST(${titles.subjects} AS CHAR) LIKE ${like}
    OR ${titles.isbn} = ${term}
    OR ${titles.callNumber} LIKE ${like}
    OR EXISTS (SELECT 1 FROM copies c WHERE c.title_id = ${titles.id} AND c.barcode = ${term}))`;
}

export async function listTitles(q: string | undefined, page: number, pageSize = 25) {
  const where = titleSearch(q);
  const rows = await db
    .select({
      id: titles.id,
      title: titles.title,
      authors: titles.authors,
      publisher: titles.publisher,
      year: titles.year,
      callNumber: titles.callNumber,
      isbn: titles.isbn,
      copies: sql<number>`(SELECT count(*) FROM copies c WHERE c.title_id = ${titles.id})`,
      available: sql<number>`(SELECT count(*) FROM copies c WHERE c.title_id = ${titles.id} AND c.status = 'available'
        AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.returned_on IS NULL))`,
    })
    .from(titles)
    .where(where)
    .orderBy(asc(titles.title))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(titles).where(where);
  return {
    rows: rows.map((r) => ({ ...r, copies: Number(r.copies), available: Number(r.available) })),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function titleDetail(id: number, includeStaffFields: boolean) {
  const [t] = await db
    .select({ title: titles, format: formats.name })
    .from(titles)
    .leftJoin(formats, eq(titles.formatId, formats.id))
    .where(eq(titles.id, id));
  if (!t) throw notFound("Title");
  const copyRows = await db
    .select({
      copy: copies,
      location: locations.name,
      collectionType: collectionTypes.name,
      dueOn: loans.dueOn,
      loanId: loans.id,
      borrower: members.name,
      borrowerCode: members.code,
    })
    .from(copies)
    .leftJoin(locations, eq(copies.locationId, locations.id))
    .leftJoin(collectionTypes, eq(copies.collectionTypeId, collectionTypes.id))
    .leftJoin(loans, and(eq(loans.copyId, copies.id), isNull(loans.returnedOn)))
    .leftJoin(members, eq(loans.memberId, members.id))
    .where(eq(copies.titleId, id))
    .orderBy(asc(copies.barcode));
  return {
    ...t.title,
    format: t.format,
    copies: copyRows.map((r) => ({
      id: r.copy.id,
      barcode: r.copy.barcode,
      status: r.copy.status,
      location: r.location,
      collectionType: r.collectionType,
      callNumber: r.copy.callNumber ?? t.title.callNumber,
      dueOn: r.dueOn,
      onLoan: !!r.loanId,
      ...(includeStaffFields
        ? {
            locationId: r.copy.locationId,
            collectionTypeId: r.copy.collectionTypeId,
            price: r.copy.price,
            supplier: r.copy.supplier,
            invoice: r.copy.invoice,
            receivedOn: r.copy.receivedOn,
            borrower: r.borrower,
            borrowerCode: r.borrowerCode,
          }
        : {}),
    })),
  };
}

export const catalogueRouter = Router();

catalogueRouter.get("/titles", requireRole("assistant"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  res.json(await listTitles(req.query.q as string | undefined, page));
});

catalogueRouter.get("/titles/:id", requireRole("assistant"), async (req, res) => {
  res.json(await titleDetail(Number(req.params.id), true));
});

catalogueRouter.post("/titles", requireRole("librarian"), async (req, res) => {
  const data = titleInput.parse(req.body);
  const [{ id }] = await db.insert(titles).values(data).$returningId();
  await audit(db, req.user!.id, "title.create", { id, title: data.title });
  res.status(201).json({ id });
});

catalogueRouter.put("/titles/:id", requireRole("librarian"), async (req, res) => {
  const data = titleInput.parse(req.body);
  const id = Number(req.params.id);
  const [result] = await db.update(titles).set({ ...data, updatedAt: new Date() }).where(eq(titles.id, id));
  if (!result.affectedRows) throw notFound("Title");
  await audit(db, req.user!.id, "title.update", { id });
  res.json({ id });
});

catalogueRouter.delete("/titles/:id", requireRole("librarian"), async (req, res) => {
  const id = Number(req.params.id);
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(copies).where(eq(copies.titleId, id));
  if (Number(n)) throw badRequest("Delete or move this title's copies first");
  await db.delete(titles).where(eq(titles.id, id));
  await audit(db, req.user!.id, "title.delete", { id });
  res.status(204).end();
});

catalogueRouter.post("/titles/:id/copies", requireRole("librarian"), async (req, res) => {
  const titleId = Number(req.params.id);
  const data = copyInput.parse(req.body);
  const [exists] = await db.select({ id: copies.id }).from(copies).where(eq(copies.barcode, data.barcode));
  if (exists) throw badRequest(`Barcode ${data.barcode} is already used`);
  const [{ id }] = await db.insert(copies).values({ ...data, titleId }).$returningId();
  await audit(db, req.user!.id, "copy.create", { id, barcode: data.barcode });
  res.status(201).json({ id });
});

catalogueRouter.put("/copies/:id", requireRole("librarian"), async (req, res) => {
  const data = copyInput.parse(req.body);
  const id = Number(req.params.id);
  const [clash] = await db.select({ id: copies.id }).from(copies).where(eq(copies.barcode, data.barcode));
  if (clash && clash.id !== id) throw badRequest(`Barcode ${data.barcode} is already used`);
  const [result] = await db.update(copies).set(data).where(eq(copies.id, id));
  if (!result.affectedRows) throw notFound("Copy");
  await audit(db, req.user!.id, "copy.update", { id });
  res.json({ id });
});

catalogueRouter.delete("/copies/:id", requireRole("librarian"), async (req, res) => {
  const id = Number(req.params.id);
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(loans).where(eq(loans.copyId, id));
  if (Number(n)) throw badRequest("This copy has loan history. Mark it Withdrawn instead of deleting it");
  await db.delete(copies).where(eq(copies.id, id));
  await audit(db, req.user!.id, "copy.delete", { id });
  res.status(204).end();
});

/** Next free barcode for a pattern like HI00000MT (the zeros are the counter). */
catalogueRouter.get("/next-barcode", requireRole("librarian"), async (req, res) => {
  const pattern = String(req.query.pattern || "HI00000MT");
  const m = pattern.match(/^(\D*)(0+)(\D*)$/);
  if (!m) throw badRequest("Pattern must look like HI00000MT");
  const [, prefix, zeros, suffix] = m;
  const re = `^${prefix}[0-9]{${zeros.length}}${suffix}$`;
  const [row] = await db
    .select({ barcode: copies.barcode })
    .from(copies)
    .where(sql`${copies.barcode} REGEXP ${re}`)
    .orderBy(desc(copies.barcode))
    .limit(1);
  const n = row ? Number(row.barcode.slice(prefix.length, prefix.length + zeros.length)) + 1 : 1;
  res.json({ barcode: `${prefix}${String(n).padStart(zeros.length, "0")}${suffix}` });
});
