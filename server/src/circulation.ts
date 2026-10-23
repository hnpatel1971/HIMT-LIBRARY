import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { dueDate, overdueDays, today, type Closures } from "./calendar.js";
import { AppError, badRequest, notFound } from "./errors.js";
import { audit } from "./audit.js";
import { sameCode } from "./codes.js";

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
      .where(sameCode(members.code, memberCode.trim()))
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
      .where(sameCode(copies.barcode, barcode.trim()));
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
      .returning({ id: loans.id });
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
      .where(and(sameCode(copies.barcode, barcode.trim()), isNull(loans.returnedOn)))
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

/**
 * Re-issue a book to the member who has it: the due date starts again from
 * today. An overdue book is charged its late fine first, the same as a return.
 * Re-issues count against the member type's renewal limit, which a librarian
 * can override, as they can an expired membership.
 */
export async function reissue({
  loanId,
  barcode,
  userId,
  override = false,
  on = today(),
}: {
  loanId?: number;
  barcode?: string;
  userId: number;
  override?: boolean;
  on?: string;
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ loan: loans, member: members, type: memberTypes, title: titles.title, barcode: copies.barcode })
      .from(loans)
      .innerJoin(copies, eq(loans.copyId, copies.id))
      .innerJoin(titles, eq(copies.titleId, titles.id))
      .innerJoin(members, eq(loans.memberId, members.id))
      .innerJoin(memberTypes, eq(members.typeId, memberTypes.id))
      .where(and(loanId ? eq(loans.id, loanId) : sameCode(copies.barcode, (barcode ?? "").trim()), isNull(loans.returnedOn)))
      .for("update");
    if (!row) throw badRequest(barcode ? `${barcode} is not on loan` : "This loan is not open");
    const { loan, member, type } = row;
    if (!member.active) throw badRequest(`${member.name} is not an active member`);
    if (member.expiresOn && member.expiresOn < on && !override) {
      throw new AppError(409, `${member.name}'s membership expired on ${member.expiresOn}`, true);
    }
    if (loan.renewCount >= type.renewLimit && !override) {
      throw new AppError(
        409,
        type.renewLimit === 0
          ? `${type.name} members cannot re-issue books`
          : `Already re-issued ${loan.renewCount} time(s); the limit is ${type.renewLimit}`,
        true,
      );
    }

    const closures = await loadClosures(tx);
    const days = overdueDays(loan.dueOn, on, closures);
    const fine = days * Number(type.finePerDay);
    if (fine > 0) {
      await tx.insert(fines).values({
        memberId: member.id,
        loanId: loan.id,
        amount: fine.toFixed(2),
        reason: `${days} day(s) late: ${row.title}`.slice(0, 600),
        chargedOn: on,
      });
    }
    const due = dueDate(on, type.loanDays, closures);
    await tx
      .update(loans)
      .set({ dueOn: due, renewCount: sql`${loans.renewCount} + 1` })
      .where(eq(loans.id, loan.id));
    await audit(tx, userId, "loan.reissue", { loanId: loan.id, dueOn: due, daysLate: days, fine, override });
    return {
      loanId: loan.id,
      barcode: row.barcode,
      title: row.title,
      member: member.name,
      memberCode: member.code,
      dueOn: due,
      renewCount: loan.renewCount + 1,
      daysLate: days,
      fine,
    };
  });
}

/**
 * Outstanding fines minus payments for the "members" row in the outer query.
 * The id is written out in full: Drizzle leaves the table name off columns in
 * a single-table select, and a bare "id" would match the subquery's own table.
 */
export const balanceSql = sql<string>`(
  COALESCE((SELECT SUM(f.amount) FROM fines f WHERE f.member_id = "members"."id" AND NOT f.waived), 0)
  - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.member_id = "members"."id"), 0))`;

export const overdueWhere = (on = today()) => and(isNull(loans.returnedOn), lt(loans.dueOn, on));
