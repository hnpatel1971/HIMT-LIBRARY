import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api, type ReportLoan } from "../api";
import { formatDate, Loading, rupees } from "../ui";

interface Stats {
  titles: number;
  copies: number;
  members: number;
  onLoan: number;
  overdue: number;
  issuedToday: number;
  returnedToday: number;
  visitsToday: number;
  finesOutstanding: number;
}

function Stat({ label, value, href, tone }: { label: string; value: string; href?: string; tone?: "red" }) {
  const body = (
    <div className={`card h-full ${href ? "hover:border-brand-600" : ""}`}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "red" ? "text-red-700" : ""}`}>{value}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Dashboard() {
  const { data: s } = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Stats>("/dashboard") });
  const { data: dueSoon } = useQuery({ queryKey: ["due-soon"], queryFn: () => api<ReportLoan[]>("/reports/due-soon") });
  if (!s) return <Loading />;
  const n = (v: number) => v.toLocaleString("en-IN");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Dashboard</h1>
        <Link href="/staff/circulation" className="btn-primary">
          Issue or return a book
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Issued today" value={n(s.issuedToday)} />
        <Stat label="Returned today" value={n(s.returnedToday)} />
        <Stat label="Visitors today" value={n(s.visitsToday)} />
        <Stat label="On loan now" value={n(s.onLoan)} />
        <Stat label="Overdue" value={n(s.overdue)} href="/staff/reports?tab=overdue" tone={s.overdue ? "red" : undefined} />
        <Stat label="Unpaid fines" value={rupees(s.finesOutstanding)} href="/staff/reports?tab=fines" />
        <Stat label="Titles / copies" value={`${n(s.titles)} / ${n(s.copies)}`} href="/staff/catalogue" />
        <Stat label="Active members" value={n(s.members)} href="/staff/members" />
      </div>
      <div className="card">
        <h2>Due back in the next 3 days</h2>
        {!dueSoon?.length ? (
          <p className="mt-2 text-sm text-slate-500">Nothing due in the next 3 days.</p>
        ) : (
          <table className="table mt-2">
            <thead>
              <tr>
                <th>Due</th>
                <th>Book</th>
                <th>Member</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {dueSoon.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{formatDate(l.dueOn)}</td>
                  <td>{l.title}</td>
                  <td>
                    <Link href={`/staff/members/${l.memberId}`} className="text-brand-700 hover:underline">
                      {l.member}
                    </Link>
                  </td>
                  <td>{l.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
