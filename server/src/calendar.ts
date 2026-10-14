// Date helpers for due dates and fines. Dates are "YYYY-MM-DD" strings in the
// library's timezone, so day arithmetic never crosses a clock change.

export const LIBRARY_TZ = "Asia/Kolkata";

export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LIBRARY_TZ }).format(now);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export interface Closures {
  weeklyOff: number[];
  holidays: Set<string>;
}

export function isClosed(day: string, c: Closures): boolean {
  return c.weeklyOff.includes(weekday(day)) || c.holidays.has(day);
}

/** Due date is loanDays after issue, pushed forward past any closed day. */
export function dueDate(issuedOn: string, loanDays: number, c: Closures): string {
  let due = addDays(issuedOn, loanDays);
  for (let i = 0; i < 366 && isClosed(due, c); i++) due = addDays(due, 1);
  return due;
}

/** Days late between due date and return, not counting days the library was closed. */
export function overdueDays(dueOn: string, returnedOn: string, c: Closures): number {
  let days = 0;
  for (let d = addDays(dueOn, 1); d <= returnedOn; d = addDays(d, 1)) {
    if (!isClosed(d, c)) days++;
  }
  return days;
}
