import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api, queryClient, type Me, type MemberDetail, type MemberRow, type MemberType, type Paged } from "../api";
import { isLibrarian } from "../App";
import { Empty, ErrorNote, Field, formatDate, Loading, Pager, rupees, useDebounced } from "../ui";

export const useMemberTypes = () =>
  useQuery({ queryKey: ["member-types"], queryFn: () => api<MemberType[]>("/member-types") }).data ?? [];

export function MemberList() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const term = useDebounced(q.trim());
  const { data, isLoading, error } = useQuery({
    queryKey: ["members", term, page],
    queryFn: () => api<Paged<MemberRow>>(`/members?q=${encodeURIComponent(term)}&page=${page}`),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Members</h1>
        <Link href="/staff/members/new" className="btn-primary">
          Add a member
        </Link>
      </div>
      <input
        className="input"
        placeholder="Search by name, member ID or department"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />
      <ErrorNote error={error} />
      <div className="card overflow-x-auto p-0">
        {isLoading ? (
          <Loading />
        ) : !data?.rows.length ? (
          <Empty>No members found.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Type</th>
                <th>Expires</th>
                <th className="text-right">On loan</th>
                <th className="text-right">Owes</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((m) => (
                <tr key={m.id} className={m.active ? "" : "text-slate-400"}>
                  <td>
                    <Link href={`/staff/members/${m.id}`} className="font-medium text-brand-700 hover:underline">
                      {m.name}
                    </Link>
                    {!m.active && <span className="ml-2 text-xs">(inactive)</span>}
                  </td>
                  <td className="font-mono">{m.code}</td>
                  <td>{m.type}</td>
                  <td className="whitespace-nowrap">{formatDate(m.expiresOn)}</td>
                  <td className="text-right">{m.onLoan}</td>
                  <td className={`text-right ${m.balance > 0 ? "font-medium text-red-700" : ""}`}>{m.balance > 0 ? rupees(m.balance) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
    </div>
  );
}

function PaymentForm({ memberId, balance }: { memberId: number; balance: number }) {
  const [amount, setAmount] = useState(String(balance));
  const [receiptNo, setReceiptNo] = useState("");
  const pay = useMutation({
    mutationFn: () => api(`/members/${memberId}/payments`, { body: { amount, receiptNo } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", memberId] });
      setReceiptNo("");
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        pay.mutate();
      }}
    >
      <Field label="Amount paid (₹)">
        <input className="input w-32" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Receipt no. (optional)">
        <input className="input w-40" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
      </Field>
      <button className="btn-primary" disabled={pay.isPending}>
        Record payment
      </button>
      <div className="w-full">
        <ErrorNote error={pay.error} />
      </div>
    </form>
  );
}

export function MemberPage({ id, me }: { id: number; me: Me }) {
  const { data: m, isLoading, error } = useQuery({ queryKey: ["member", id], queryFn: () => api<MemberDetail>(`/members/${id}`) });
  const waive = useMutation({
    mutationFn: (fineId: number) => api(`/fines/${fineId}/waive`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["member", id] }),
  });
  if (isLoading) return <Loading />;
  if (!m) return <ErrorNote error={error} />;
  return (
    <div className="space-y-4">
      <Link href="/staff/members" className="text-sm text-brand-700 underline">
        ← Members
      </Link>
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1>{m.name}</h1>
            <p className="text-slate-600">
              <span className="font-mono">{m.code}</span> · {m.type.name}
              {!m.active && " · inactive"}
            </p>
          </div>
          {isLibrarian(me) && (
            <Link href={`/staff/members/${id}/edit`} className="btn-secondary">
              Edit
            </Link>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          {(
            [
              ["Department", m.department],
              ["Phone", m.phone],
              ["Email", m.email],
              ["Address", m.address],
              ["Member since", formatDate(m.joinedOn)],
              ["Expires", formatDate(m.expiresOn)],
              ["Borrowing", `${m.type.loanLimit} items for ${m.type.loanDays} days`],
              ["Fine", `${rupees(m.type.finePerDay)} per day`],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-slate-500">{k}</dt>
              <dd className="break-words">{v || "—"}</dd>
            </div>
          ))}
        </dl>
        {m.notes && <p className="mt-3 text-sm text-slate-600">{m.notes}</p>}
      </div>

      <div className="card">
        <h2>On loan ({m.current.length})</h2>
        {m.current.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nothing on loan.</p>
        ) : (
          <table className="table mt-2">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Title</th>
                <th>Issued</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {m.current.map((l) => (
                <tr key={l.id}>
                  <td className="font-mono">{l.barcode}</td>
                  <td>{l.title}</td>
                  <td className="whitespace-nowrap">{formatDate(l.issuedOn)}</td>
                  <td className={`whitespace-nowrap ${l.overdue ? "font-medium text-red-700" : ""}`}>
                    {formatDate(l.dueOn)}
                    {l.overdue && " (overdue)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2>Fines</h2>
          <span className={m.balance > 0 ? "font-semibold text-red-700" : "text-slate-600"}>
            {m.balance > 0 ? `Owes ${rupees(m.balance)}` : "Nothing owed"}
          </span>
        </div>
        {m.balance > 0 && <PaymentForm memberId={id} balance={m.balance} />}
        <ErrorNote error={waive.error} />
        {m.fines.length + m.payments.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Details</th>
                <th className="text-right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[
                ...m.fines.map((f) => ({ key: `f${f.id}`, date: f.chargedOn, text: f.reason, amount: Number(f.amount), fine: f })),
                ...m.payments.map((p) => ({
                  key: `p${p.id}`,
                  date: p.paidOn,
                  text: `Payment${p.receiptNo ? `, receipt ${p.receiptNo}` : ""}${p.note ? ` (${p.note})` : ""}`,
                  amount: -Number(p.amount),
                  fine: null,
                })),
              ]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((r) => (
                  <tr key={r.key} className={r.fine?.waived ? "text-slate-400 line-through" : ""}>
                    <td className="whitespace-nowrap">{formatDate(r.date)}</td>
                    <td>{r.text}</td>
                    <td className={`text-right ${r.amount < 0 ? "text-green-700" : ""}`}>
                      {r.amount < 0 ? `−${rupees(-r.amount)}` : rupees(r.amount)}
                    </td>
                    <td className="text-right">
                      {r.fine && !r.fine.waived && isLibrarian(me) && (
                        <button
                          className="text-sm text-brand-700 underline"
                          onClick={() => confirm("Waive this fine?") && waive.mutate(r.fine!.id)}
                        >
                          Waive
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Borrowing history</h2>
        {m.history.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No past loans.</p>
        ) : (
          <table className="table mt-2">
            <thead>
              <tr>
                <th>Title</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Returned</th>
              </tr>
            </thead>
            <tbody>
              {m.history.map((l) => (
                <tr key={l.id}>
                  <td>{l.title}</td>
                  <td className="whitespace-nowrap">{formatDate(l.issuedOn)}</td>
                  <td className="whitespace-nowrap">{formatDate(l.dueOn)}</td>
                  <td className={`whitespace-nowrap ${l.returnedOn! > l.dueOn ? "text-red-700" : ""}`}>{formatDate(l.returnedOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function MemberEditor({ id }: { id?: number }) {
  const [, navigate] = useLocation();
  const types = useMemberTypes();
  const existing = useQuery({ queryKey: ["member", id], queryFn: () => api<MemberDetail>(`/members/${id}`), enabled: !!id });
  const [f, setF] = useState({
    code: "",
    name: "",
    typeId: "",
    department: "",
    email: "",
    phone: "",
    address: "",
    joinedOn: new Date().toISOString().slice(0, 10),
    expiresOn: "",
    active: true,
    notes: "",
  });
  useEffect(() => {
    const m = existing.data;
    if (!m) return;
    setF({
      code: m.code,
      name: m.name,
      typeId: String(m.typeId),
      department: m.department ?? "",
      email: m.email ?? "",
      phone: m.phone ?? "",
      address: m.address ?? "",
      joinedOn: m.joinedOn ?? "",
      expiresOn: m.expiresOn ?? "",
      active: m.active,
      notes: m.notes ?? "",
    });
  }, [existing.data]);
  useEffect(() => {
    if (!f.typeId && types.length) setF((x) => ({ ...x, typeId: String(types.find((t) => /student/i.test(t.name))?.id ?? types[0].id) }));
  }, [types, f.typeId]);
  const save = useMutation({
    mutationFn: () =>
      api<{ id: number }>(id ? `/members/${id}` : "/members", { method: id ? "PUT" : "POST", body: { ...f, typeId: Number(f.typeId) } }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["member", r.id] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      navigate(`/staff/members/${r.id}`);
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  if (id && existing.isLoading) return <Loading />;
  return (
    <form
      className="card max-w-3xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h1>{id ? "Edit member" : "Add a member"}</h1>
      <ErrorNote error={save.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Member ID" hint="Usually the college ID or roll number">
          <input className="input font-mono" value={f.code} onChange={set("code")} required autoFocus={!id} />
        </Field>
        <Field label="Full name">
          <input className="input" value={f.name} onChange={set("name")} required />
        </Field>
        <Field label="Member type">
          <select className="input" value={f.typeId} onChange={set("typeId")}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Department / course">
          <input className="input" value={f.department} onChange={set("department")} />
        </Field>
        <Field label="Phone">
          <input className="input" value={f.phone} onChange={set("phone")} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={f.email} onChange={set("email")} />
        </Field>
        <Field label="Member since">
          <input className="input" type="date" value={f.joinedOn} onChange={set("joinedOn")} />
        </Field>
        <Field label="Expires on" hint="Leave empty to use the member type's period">
          <input className="input" type="date" value={f.expiresOn} onChange={set("expiresOn")} />
        </Field>
      </div>
      <Field label="Address">
        <textarea className="input" rows={2} value={f.address} onChange={set("address")} />
      </Field>
      <Field label="Notes">
        <textarea className="input" rows={2} value={f.notes} onChange={set("notes")} />
      </Field>
      {id && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Active member (can borrow)
        </label>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={save.isPending}>
          Save
        </button>
        <button type="button" className="btn-secondary" onClick={() => history.back()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
