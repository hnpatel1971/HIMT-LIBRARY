import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api, type ReportLoan } from "../api";
import { downloadCsv, Empty, formatDate, Loading, rupees } from "../ui";

const tabs = [
  ["overdue", "Overdue"],
  ["loans", "Loans"],
  ["fines", "Fines"],
  ["collection", "Collection"],
  ["visits", "Visitors"],
] as const;
type Tab = (typeof tabs)[number][0];

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export function Reports() {
  const initial = new URLSearchParams(location.search).get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(initial ?? "overdue");
  return (
    <div className="space-y-4">
      <h1>Reports</h1>
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overdue" && <Overdue />}
      {tab === "loans" && <Loans />}
      {tab === "fines" && <Fines />}
      {tab === "collection" && <Collection />}
      {tab === "visits" && <Visits />}
    </div>
  );
}

function Overdue() {
  const { data } = useQuery({ queryKey: ["overdue"], queryFn: () => api<ReportLoan[]>("/reports/overdue") });
  if (!data) return <Loading />;
  if (!data.length) return <Empty>Nothing is overdue.</Empty>;
  return (
    <div className="card space-y-3 overflow-x-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">{data.length} books are overdue.</p>
        <button
          className="btn-secondary"
          onClick={() =>
            downloadCsv(
              "overdue.csv",
              data.map((l) => ({
                member: l.member,
                memberId: l.memberCode,
                phone: l.phone,
                barcode: l.barcode,
                title: l.title,
                due: l.dueOn,
                daysOverdue: l.daysOverdue,
              })),
            )
          }
        >
          Download CSV
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Phone</th>
            <th>Book</th>
            <th>Due</th>
            <th className="text-right">Days late</th>
          </tr>
        </thead>
        <tbody>
          {data.map((l) => (
            <tr key={l.id}>
              <td>
                <Link href={`/staff/members/${l.memberId}`} className="text-brand-700 hover:underline">
                  {l.member}
                </Link>
                <div className="font-mono text-xs text-slate-500">{l.memberCode}</div>
              </td>
              <td>{l.phone}</td>
              <td>
                {l.title}
                <div className="font-mono text-xs text-slate-500">{l.barcode}</div>
              </td>
              <td className="whitespace-nowrap">{formatDate(l.dueOn)}</td>
              <td className="text-right font-medium text-red-700">{l.daysOverdue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Loans() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(0));
  const { data } = useQuery({
    queryKey: ["loans-report", from, to],
    queryFn: () => api<{ total: number; byMemberType: Record<string, number>; rows: ReportLoan[] }>(`/reports/loans?from=${from}&to=${to}`),
  });
  return (
    <div className="card space-y-3 overflow-x-auto">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          From <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          To <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {data && (
          <button
            className="btn-secondary"
            onClick={() =>
              downloadCsv(
                `loans-${from}-to-${to}.csv`,
                data.rows.map((l) => ({
                  issued: l.issuedOn,
                  due: l.dueOn,
                  returned: l.returnedOn,
                  member: l.member,
                  memberId: l.memberCode,
                  type: l.memberType,
                  barcode: l.barcode,
                  title: l.title,
                })),
              )
            }
          >
            Download CSV
          </button>
        )}
      </div>
      {!data ? (
        <Loading />
      ) : (
        <>
          <p className="text-sm text-slate-600">
            {data.total} books issued
            {Object.keys(data.byMemberType).length > 0 &&
              `: ${Object.entries(data.byMemberType)
                .map(([k, v]) => `${v} to ${k.toLowerCase()}`)
                .join(", ")}`}
            .
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Issued</th>
                <th>Member</th>
                <th>Book</th>
                <th>Due</th>
                <th>Returned</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{formatDate(l.issuedOn)}</td>
                  <td>{l.member}</td>
                  <td>{l.title}</td>
                  <td className="whitespace-nowrap">{formatDate(l.dueOn)}</td>
                  <td className="whitespace-nowrap">{l.returnedOn ? formatDate(l.returnedOn) : <span className="text-amber-700">On loan</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Fines() {
  const { data } = useQuery({
    queryKey: ["fines-report"],
    queryFn: () =>
      api<{ totalCharged: number; totalPaid: number; rows: { id: number; code: string; name: string; phone: string | null; charged: number; paid: number; balance: number }[] }>(
        "/reports/fines",
      ),
  });
  if (!data) return <Loading />;
  return (
    <div className="card space-y-3 overflow-x-auto">
      <p className="text-sm text-slate-600">
        Charged {rupees(data.totalCharged)} in total, {rupees(data.totalPaid)} paid, {rupees(data.totalCharged - data.totalPaid)} still owed by{" "}
        {data.rows.length} members.
      </p>
      {data.rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Phone</th>
              <th className="text-right">Charged</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Owes</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/staff/members/${r.id}`} className="text-brand-700 hover:underline">
                    {r.name}
                  </Link>
                  <div className="font-mono text-xs text-slate-500">{r.code}</div>
                </td>
                <td>{r.phone}</td>
                <td className="text-right">{rupees(r.charged)}</td>
                <td className="text-right">{rupees(r.paid)}</td>
                <td className="text-right font-medium text-red-700">{rupees(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Breakdown({ title, rows, unit }: { title: string; rows: { name: string; n: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="card">
      <h2>{title}</h2>
      <ul className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[8rem_1fr_4rem] items-center gap-2 text-sm">
            <span className="truncate capitalize">{r.name.replace("_", " ")}</span>
            <span className="h-2.5 rounded bg-brand-600" style={{ width: `${(r.n / max) * 100}%` }} />
            <span className="text-right tabular-nums">
              {r.n.toLocaleString("en-IN")} <span className="text-xs text-slate-500">{unit}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Collection() {
  type R = { name: string; copies?: number; titles?: number };
  const { data } = useQuery({
    queryKey: ["collection"],
    queryFn: () => api<{ byLocation: R[]; byCollectionType: R[]; byFormat: R[]; byStatus: R[] }>("/reports/collection"),
  });
  if (!data) return <Loading />;
  const map = (rows: R[]) => rows.map((r) => ({ name: r.name, n: r.copies ?? r.titles ?? 0 }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Breakdown title="Copies by collection" rows={map(data.byCollectionType)} unit="copies" />
      <Breakdown title="Copies by status" rows={map(data.byStatus)} unit="copies" />
      <Breakdown title="Titles by format" rows={map(data.byFormat)} unit="titles" />
      <Breakdown title="Copies by shelf" rows={map(data.byLocation)} unit="copies" />
    </div>
  );
}

function Visits() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(0));
  const { data } = useQuery({
    queryKey: ["visits-report", from, to],
    queryFn: () => api<{ rows: { day: string; visits: number }[] }>(`/reports/visits?from=${from}&to=${to}`),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          From <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          To <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {!data ? (
        <Loading />
      ) : !data.rows.length ? (
        <Empty>No visits recorded in this period.</Empty>
      ) : (
        <Breakdown
          title={`Visitors per day (${data.rows.reduce((s, r) => s + r.visits, 0)} in total)`}
          rows={data.rows.map((r) => ({ name: formatDate(r.day), n: r.visits }))}
          unit="visits"
        />
      )}
    </div>
  );
}
