import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { dueDate, overdueDays, today, type Closures } from "./calendar.js";
import { AppError, badRequest, notFound } from "./errors.js";
import { audit } from "./audit.js";

const { copies, fines, holidays, loans, members, memberTypes, settings, titles } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function loadClosures(tx: Tx | typeof db = db): Promise<Closures> {
  const [off] = await tx.select().from(settings).where(eq(settings.key, "weekly_off"));
  const rows = await tx.select({ date: holidays.date }).from(holidays);
  return {
    weeklyOff: Array.isArray(off?.value) ? (off.value as number[]) : [0],
    holidays: new Set(rows.map((r) => r.date)),
  };
}

export interface IssueInput {
  memberCode: string;
  barcode: string;
  userId: number;
  override?: boolean;
  on?: string;
}

export async function issue({ memberCode, barcode, userId, override = false, on = today() }: IssueInput) {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ member: members, type: memberTypes })
      .from(members)
      .innerJoin(memberTypes, eq(members.typeId, memberTypes.id))
      .where(eq(members.code, memberCode.trim()))
      .for("update");
    if (!m) throw notFound(`Member ${memberCode}`);
    if (!m.member.active) throw badRequest(`${m.member.name} is not an active member`);
    if (m.member.expiresOn && m.member.expiresOn < on && !override) {
      throw new AppError(409, `${m.member.name}'s membership expired on ${m.member.expiresOn}`, true);
    }

    const [copy] = await tx
      .select({ copy: copies, title: titles.title })
      .from(copies)
      .innerJoin(titles, eq(copies.titleId, titles.id))
      .where(eq(copies.barcode, barcode.trim()));
    if (!copy) throw notFound(`Copy ${barcode}`);
    if (copy.copy.status !== "available") {
      throw badRequest(`${barcode} cannot be lent (status: ${copy.copy.status.replace("_", " ")})`);
    }
    const [open] = await tx
      .select({ id: loans.id, memberId: loans.memberId })
      .from(loans)
      .where(and(eq(loans.copyId, copy.copy.id), isNull(loans.returnedOn)));
    if (open) {
      throw badRequest(
        open.memberId === m.member.id
          ? `${barcode} is already on loan to this member`
          : `${barcode} is already on loan to another member; return it first`,
      );
    }

    const current = await tx
      .select({ id: loans.id, dueOn: loans.dueOn })
      .from(loans)
      .where(and(eq(loans.memberId, m.member.id), isNull(loans.returnedOn)));
    if (!override) {
      if (current.length >= m.type.loanLimit) {
        throw new AppError(409, `${m.member.name} already has ${current.length} of ${m.type.loanLimit} items allowed`, true);
      }
      const overdue = current.filter((l) => l.dueOn < on).length;
      if (overdue) throw new AppError(409, `${m.member.name} has ${overdue} overdue item(s)`, true);
    }

    const due = dueDate(on, m.type.loanDays, await loadClosures(tx));
    const [{ id }] = await tx
      .insert(loans)
      .values({ copyId: copy.copy.id, memberId: m.member.id, issuedOn: on, dueOn: due, issuedBy: userId })
      .$returningId();
    await audit(tx, userId, "loan.issue", { loanId: id, barcode, member: memberCode, override });
    return { loanId: id, barcode: copy.copy.barcode, title: copy.title, member: m.member.name, dueOn: due };
  });
}

export async function returnCopy({ barcode, userId, on = today() }: { barcode: string; userId: number; on?: string }) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ loan: loans, member: members, type: memberTypes, title: titles.title })
      .from(loans)
      .innerJoin(copies, eq(loans.copyId, copies.id))
      .innerJoin(titles, eq(copies.titleId, titles.id))
      .innerJoin(members, eq(loans.memberId, members.id))
      .innerJoin(memberTypes, eq(members.typeId, memberTypes.id))
      .where(and(eq(copies.barcode, barcode.trim()), isNull(loans.returnedOn)))
      .for("update");
    if (!row) throw badRequest(`${barcode} is not on loan`);

    await tx.update(loans).set({ returnedOn: on, returnedBy: userId }).where(eq(loans.id, row.loan.id));

    const days = overdueDays(row.loan.dueOn, on, await loadClosures(tx));
    const fine = days * Number(row.type.finePerDay);
    if (fine > 0) {
      await tx.insert(fines).values({
        memberId: row.member.id,
        loanId: row.loan.id,
        amount: fine.toFixed(2),
        reason: `${days} day(s) late: ${row.title}`.slice(0, 600),
        chargedOn: on,
      });
    }
    await audit(tx, userId, "loan.return", { loanId: row.loan.id, barcode, daysLate: days, fine });
    return { barcode, title: row.title, member: row.member.name, memberCode: row.member.code, daysLate: days, fine };
  });
}

export async function renew({ loanId, userId, on = today() }: { loanId: number; userId: number; on?: string }) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ loan: loans, type: memberTypes })
      .from(loans)
      .innerJoin(members, eq(loans.memberId, members.id))
      .innerJoin(memberTypes, eq(members.typeId, memberTypes.id))
      .where(eq(loans.id, loanId))
      .for("update");
    if (!row || row.loan.returnedOn) throw badRequest("This loan is not open");
    if (row.loan.dueOn < on) throw badRequest("This item is overdue. Return it to settle the fine, then issue it again");
    if (row.loan.renewCount >= row.type.renewLimit) {
      throw badRequest(`Renewal limit reached (${row.type.renewLimit})`);
    }
    const due = dueDate(on, row.type.loanDays, await loadClosures(tx));
    await tx
      .update(loans)
      .set({ dueOn: due, renewCount: sql`${loans.renewCount} + 1` })
      .where(eq(loans.id, loanId));
    await audit(tx, userId, "loan.renew", { loanId, dueOn: due });
    return { loanId, dueOn: due, renewCount: row.loan.renewCount + 1 };
  });
}

/** Outstanding fines minus payments, per member. */
export const balanceSql = (memberId: unknown) => sql<string>`(
  COALESCE((SELECT SUM(f.amount) FROM fines f WHERE f.member_id = ${memberId} AND NOT f.waived), 0)
  - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.member_id = ${memberId}), 0))`;

export const overdueWhere = (on = today()) => and(isNull(loans.returnedOn), lt(loans.dueOn, on));
