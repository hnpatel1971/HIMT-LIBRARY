import { Router } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireRole } from "../auth.js";
import { audit } from "../audit.js";
import { balanceSql } from "../circulation.js";
import { today } from "../calendar.js";
import { badRequest, notFound } from "../errors.js";
import { sameCode } from "../codes.js";

const { members, memberTypes, loans, copies, titles, fines, payments } = schema;

const opt = z.string().trim().nullish().transform((v) => (v ? v : null));

export const memberInput = z.object({
  code: z.string().trim().min(1, "Member ID is required"),
  name: z.string().trim().min(1, "Name is required"),
  typeId: z.number().int(),
  department: opt,
  email: opt,
  phone: opt,
  address: opt,
  joinedOn: opt,
  expiresOn: opt,
  active: z.boolean().default(true),
  notes: opt,
});

export const membersRouter = Router();

membersRouter.get("/members", requireRole("assistant"), async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 25;
  const where = q ? or(ilike(members.name, `%${q}%`), sameCode(members.code, q), ilike(members.department, `%${q}%`)) : undefined;
  const rows = await db
    .select({
      id: members.id,
      code: members.code,
      name: members.name,
      type: memberTypes.name,
      department: members.department,
      expiresOn: members.expiresOn,
      active: members.active,
      onLoan: sql<number>`(SELECT count(*) FROM loans l WHERE l.member_id = "members"."id" AND l.returned_on IS NULL)`,
      balance: balanceSql,
    })
    .from(members)
    .innerJoin(memberTypes, eq(members.typeId, memberTypes.id))
    .where(where)
    .orderBy(asc(members.name))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(members).where(where);
  res.json({
    rows: rows.map((r) => ({ ...r, onLoan: Number(r.onLoan), balance: Number(r.balance) })),
    total: Number(total),
    page,
    pageSize,
  });
});

export async function memberDetail(where: ReturnType<typeof eq>) {
  const [m] = await db
    .select({ member: members, type: memberTypes })
    .from(members)
    .innerJoin(memberTypes, eq(members.typeId, memberTypes.id))
    .where(where);
  if (!m) return null;
  const loanRows = await db
    .select({
      id: loans.id,
      barcode: copies.barcode,
      title: titles.title,
      titleId: titles.id,
      issuedOn: loans.issuedOn,
      dueOn: loans.dueOn,
      returnedOn: loans.returnedOn,
      renewCount: loans.renewCount,
    })
    .from(loans)
    .innerJoin(copies, eq(loans.copyId, copies.id))
    .innerJoin(titles, eq(copies.titleId, titles.id))
    .where(eq(loans.memberId, m.member.id))
    .orderBy(desc(loans.issuedOn), desc(loans.id))
    .limit(200);
  const fineRows = await db.select().from(fines).where(eq(fines.memberId, m.member.id)).orderBy(desc(fines.chargedOn));
  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.memberId, m.member.id))
    .orderBy(desc(payments.paidOn));
  const charged = fineRows.filter((f) => !f.waived).reduce((s, f) => s + Number(f.amount), 0);
  const paid = paymentRows.reduce((s, p) => s + Number(p.amount), 0);
  const on = today();
  return {
    ...m.member,
    type: m.type,
    current: loanRows.filter((l) => !l.returnedOn).map((l) => ({ ...l, overdue: l.dueOn < on })),
    history: loanRows.filter((l) => l.returnedOn),
    fines: fineRows,
    payments: paymentRows,
    balance: charged - paid,
  };
}

membersRouter.get("/members/:id", requireRole("assistant"), async (req, res) => {
  const m = await memberDetail(eq(members.id, Number(req.params.id)));
  if (!m) throw notFound("Member");
  res.json(m);
});

membersRouter.get("/members/by-code/:code", requireRole("assistant"), async (req, res) => {
  const m = await memberDetail(sameCode(members.code, String(req.params.code).trim()));
  if (!m) throw notFound(`Member ${req.params.code}`);
  res.json(m);
});

async function withDefaultExpiry(data: z.infer<typeof memberInput>) {
  if (data.expiresOn || !data.joinedOn) return data;
  const [t] = await db.select().from(memberTypes).where(eq(memberTypes.id, data.typeId));
  if (!t) throw badRequest("Unknown member type");
  const d = new Date(`${data.joinedOn}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + t.membershipDays);
  return { ...data, expiresOn: d.toISOString().slice(0, 10) };
}

membersRouter.post("/members", requireRole("assistant"), async (req, res) => {
  const data = await withDefaultExpiry(memberInput.parse({ joinedOn: today(), ...req.body }));
  const [clash] = await db.select({ id: members.id }).from(members).where(eq(members.code, data.code));
  if (clash) throw badRequest(`Member ID ${data.code} is already used`);
  const [{ id }] = await db.insert(members).values(data).returning({ id: members.id });
  await audit(db, req.user!.id, "member.create", { id, code: data.code });
  res.status(201).json({ id });
});

membersRouter.put("/members/:id", requireRole("librarian"), async (req, res) => {
  const id = Number(req.params.id);
  const data = await withDefaultExpiry(memberInput.parse(req.body));
  const [clash] = await db.select({ id: members.id }).from(members).where(eq(members.code, data.code));
  if (clash && clash.id !== id) throw badRequest(`Member ID ${data.code} is already used`);
  const result = await db.update(members).set(data).where(eq(members.id, id));
  if (!result.rowCount) throw notFound("Member");
  await audit(db, req.user!.id, "member.update", { id });
  res.json({ id });
});

membersRouter.delete("/members/:id", requireRole("librarian"), async (req, res) => {
  const id = Number(req.params.id);
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(loans).where(eq(loans.memberId, id));
  if (Number(n)) throw badRequest("This member has loan history. Mark them inactive instead of deleting");
  await db.delete(members).where(eq(members.id, id));
  await audit(db, req.user!.id, "member.delete", { id });
  res.status(204).end();
});

const paymentInput = z.object({
  amount: z.coerce.number().positive("Amount must be more than zero"),
  receiptNo: opt,
  note: opt,
  paidOn: opt,
});

membersRouter.post("/members/:id/payments", requireRole("assistant"), async (req, res) => {
  const memberId = Number(req.params.id);
  const data = paymentInput.parse(req.body);
  const [{ id }] = await db
    .insert(payments)
    .values({
      memberId,
      amount: data.amount.toFixed(2),
      paidOn: data.paidOn ?? today(),
      receiptNo: data.receiptNo,
      note: data.note,
      receivedBy: req.user!.id,
    })
    .returning({ id: payments.id });
  await audit(db, req.user!.id, "payment.create", { id, memberId, amount: data.amount });
  res.status(201).json({ id });
});

membersRouter.post("/fines/:id/waive", requireRole("librarian"), async (req, res) => {
  const id = Number(req.params.id);
  const result = await db
    .update(fines)
    .set({ waived: true, waivedBy: req.user!.id })
    .where(and(eq(fines.id, id), eq(fines.waived, false)));
  if (!result.rowCount) throw notFound("Unwaived fine");
  await audit(db, req.user!.id, "fine.waive", { id });
  res.json({ id });
});

