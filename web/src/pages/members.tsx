import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api, ApiError, queryClient, type Me, type MemberDetail, type MemberRow, type MemberType, type Paged } from "../api";
import { isLibrarian } from "../App";
import { Empty, ErrorNote, Field, formatDate, Loading, Notice, Pager, rupees, useDebounced } from "../ui";

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
        placeholder="Search by name, member ID, course or batch ID"
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
                <th>Department / course</th>
                <th>Batch</th>
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
                  <td>{m.department}</td>
                  <td>
                    {m.batchId && (
                      <>
                        <span className="font-mono">{m.batchId}</span>
                        {m.batchName && <div className="text-xs text-slate-500">{m.batchName}</div>}
                      </>
                    )}
                  </td>
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
              ...(m.batch
                ? ([
                    ["Course", m.batch.course],
                    ["Batch", `${m.batch.id} · ${m.batch.name}`],
                  ] as const)
                : ([["Department", m.department]] as const)),
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
        {m.batch && (
          <p className="mt-3 text-xs text-slate-500">
            From the central HIMT server. The name, course, batch and expiry date are refreshed from there every night.
          </p>
        )}
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

      <MemberEbooks memberId={id} ebooks={m.ebooks} />

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

/** E-books this member may read in My library, with Give access and Remove. */
function MemberEbooks({ memberId, ebooks }: { memberId: number; ebooks: MemberDetail["ebooks"] }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["member", memberId] });
  const found = useQuery({
    queryKey: ["ebook-titles", dq],
    queryFn: () => api<{ id: number; title: string }[]>(`/ebook-titles?q=${encodeURIComponent(dq)}`),
    enabled: dq.length > 0,
  });
  const give = useMutation({
    mutationFn: (titleId: number) => api(`/members/${memberId}/ebooks`, { method: "POST", body: { titleId } }),
    onSuccess: () => {
      setQ("");
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (titleId: number) => api(`/members/${memberId}/ebooks/${titleId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const have = new Set(ebooks.map((e) => e.titleId));
  return (
    <div className="card space-y-3">
      <h2>E-books ({ebooks.length})</h2>
      <p className="text-sm text-slate-500">
        E-books given here appear in the member's My library, where they can read them online. Remove takes the access away.
      </p>
      <ErrorNote error={give.error ?? remove.error} />
      {ebooks.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Given on</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ebooks.map((e) => (
              <tr key={e.titleId}>
                <td>
                  <Link href={`/staff/catalogue/${e.titleId}`} className="text-brand-700 underline">
                    {e.title}
                  </Link>
                </td>
                <td className="whitespace-nowrap">{formatDate(e.grantedAt.slice(0, 10))}</td>
                <td className="text-right">
                  <button
                    className="text-sm text-red-700 underline"
                    onClick={() => confirm(`Remove access to ${e.title}?`) && remove.mutate(e.titleId)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Field label="Give access to an e-book">
        <input className="input" placeholder="Type part of the e-book's title" value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      {dq && found.data && (
        found.data.length === 0 ? (
          <p className="text-sm text-slate-500">No e-book matches. Only titles with a PDF that members can read are listed.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {found.data.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>{t.title}</span>
                {have.has(t.id) ? (
                  <span className="text-sm text-slate-500">Already given</span>
                ) : (
                  <button className="btn-primary px-3 py-1 text-sm" disabled={give.isPending} onClick={() => give.mutate(t.id)}>
                    Give access
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      )}
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
    batchId: "",
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
      batchId: m.batchId ?? "",
    });
  }, [existing.data]);
  useEffect(() => {
    if (!f.typeId && types.length) setF((x) => ({ ...x, typeId: String(types.find((t) => /student/i.test(t.name))?.id ?? types[0].id) }));
  }, [types, f.typeId]);
  const [pickOpen, setPickOpen] = useState(false);
  const [batchName, setBatchName] = useState("");
  useEffect(() => {
    if (existing.data?.batch) setBatchName(existing.data.batch.name);
  }, [existing.data]);
  // Editing a student: check the name against the central record for this ID.
  const isStudent = !!existing.data && (!!existing.data.batchId || /student/i.test(existing.data.type.name));
  const centralRec = useQuery({
    queryKey: ["central", "student", existing.data?.code],
    queryFn: () => api<Picked & { batchName: string }>(`/central/student/${encodeURIComponent(existing.data!.code)}`),
    enabled: !!id && isStudent,
    retry: false,
  });
  const [renamedFrom, setRenamedFrom] = useState<string | null>(null);
  useEffect(() => {
    const c = centralRec.data;
    const m = existing.data;
    if (!c || !m || c.name === m.name) return;
    setF((x) => ({ ...x, name: c.name, department: c.course, batchId: c.batchId }));
    setBatchName(c.batchName);
    setRenamedFrom(m.name);
  }, [centralRec.data, existing.data]);
  const [look, setLook] = useState<Lookup>({ state: "idle", code: "" });
  const fill = (p: Picked) => {
    const student = types.find((t) => /student/i.test(t.name));
    setF((x) => ({
      ...x,
      code: p.code,
      name: p.name,
      typeId: student ? String(student.id) : x.typeId,
      department: p.course,
      joinedOn: p.startsOn ?? x.joinedOn,
      expiresOn: p.endsOn ?? "",
      batchId: p.batchId,
    }));
    setBatchName(p.batchName ?? "");
  };
  const lookup = async (raw: string) => {
    const code = raw.trim();
    if (!code || (code === look.code && look.state !== "error")) return;
    setLook({ state: "busy", code });
    try {
      const r = await api<{ memberId?: number; name?: string; student?: Picked & { batchName: string } }>(`/central/lookup/${encodeURIComponent(code)}`);
      if (r.memberId) {
        setLook({ state: "member", code, memberId: r.memberId, name: r.name ?? "" });
      } else if (r.student) {
        fill(r.student);
        setLook({ state: "found", code, batchName: r.student.batchName });
      }
    } catch (e) {
      setLook(e instanceof ApiError && e.status === 404 ? { state: "none", code } : { state: "error", code, message: (e as Error).message });
    }
  };
  const save = useMutation({
    mutationFn: () =>
      api<{ id: number }>(id ? `/members/${id}` : "/members", { method: id ? "PUT" : "POST", body: { ...f, typeId: Number(f.typeId), batchId: f.batchId || undefined } }),
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
      {!id && pickOpen && <StudentPicker onPick={fill} />}
      <ErrorNote error={save.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Member ID"
          hint={id ? "Usually the college ID or roll number" : "For a student, type the ID and press Enter. The rest fills in from the central HIMT records"}
        >
          <input
            className="input font-mono"
            value={f.code}
            onChange={set("code")}
            onBlur={() => !id && lookup(f.code)}
            onKeyDown={(e) => {
              if (!id && e.key === "Enter") {
                e.preventDefault();
                lookup(f.code);
              }
            }}
            required
            autoFocus={!id}
          />
          {!id && <LookupNote state={look} onPick={() => setPickOpen(true)} />}
        </Field>
        <Field label="Full name">
          <input className="input" value={f.name} onChange={set("name")} required />
          {renamedFrom && (
            <p className="mt-2 text-sm text-green-700">
              Updated to the name in the central records for this ID (was "{renamedFrom}"). Save to keep it.
            </p>
          )}
        </Field>
        <Field label="Department / course">
          <input className="input" value={f.department} onChange={set("department")} />
        </Field>
        <Field label="Batch ID" hint={f.batchId ? batchName : "Set from the student's central record"}>
          <input className="input font-mono" value={f.batchId} readOnly placeholder="—" />
        </Field>
        <Field label="Member since">
          <input className="input" type="date" value={f.joinedOn} onChange={set("joinedOn")} />
        </Field>
        <Field label="Expires on" hint="Leave empty to use the member type's period">
          <input className="input" type="date" value={f.expiresOn} onChange={set("expiresOn")} />
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

interface Picked {
  code: string;
  name: string;
  course: string;
  batchId: string;
  batchName?: string;
  startsOn: string | null;
  endsOn: string | null;
}

/** Course, batch and student from the central HIMT server; picking a student fills the form. */
function StudentPicker({ onPick }: { onPick: (p: Picked) => void }) {
  const [courseId, setCourseId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [code, setCode] = useState("");
  const coursesQ = useQuery({ queryKey: ["central", "courses"], queryFn: () => api<{ id: number; name: string }[]>("/central/courses") });
  const batchesQ = useQuery({
    queryKey: ["central", "batches", courseId],
    queryFn: () => api<{ id: string; name: string; startsOn: string | null; endsOn: string | null }[]>(`/central/courses/${courseId}/batches`),
    enabled: !!courseId,
  });
  const studentsQ = useQuery({
    queryKey: ["central", "students", batchId],
    queryFn: () => api<{ code: string; name: string; memberId: number | null }[]>(`/central/batches/${batchId}/students`),
    enabled: !!batchId,
  });
  const course = coursesQ.data?.find((c) => String(c.id) === courseId);
  const batch = batchesQ.data?.find((b) => b.id === batchId);
  const student = studentsQ.data?.find((s) => s.code === code);
  return (
    <div className="space-y-3 rounded-lg border border-brand-100 bg-brand-50/50 p-4">
      <p className="text-sm text-slate-700">
        Pick the student from the central HIMT records to fill in the form. For staff and visitors, fill the form by hand.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Course">
          <select
            className="input"
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              setBatchId("");
              setCode("");
            }}
          >
            <option value="">Choose…</option>
            {coursesQ.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Batch">
          <select
            className="input"
            value={batchId}
            disabled={!courseId || batchesQ.isLoading}
            onChange={(e) => {
              setBatchId(e.target.value);
              setCode("");
            }}
          >
            <option value="">{batchesQ.isLoading ? "Loading…" : "Choose…"}</option>
            {batchesQ.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Student">
          <select
            className="input"
            value={code}
            disabled={!batchId || studentsQ.isLoading}
            onChange={(e) => {
              const s = studentsQ.data?.find((x) => x.code === e.target.value);
              setCode(e.target.value);
              if (s && !s.memberId && course && batch) {
                onPick({ code: s.code, name: s.name, course: course.name, batchId: batch.id, batchName: batch.name, startsOn: batch.startsOn, endsOn: batch.endsOn });
              }
            }}
          >
            <option value="">{studentsQ.isLoading ? "Loading…" : studentsQ.data ? `Choose… (${studentsQ.data.length})` : "Choose…"}</option>
            {studentsQ.data?.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} · {s.code}
                {s.memberId ? " (already a member)" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorNote error={coursesQ.error ?? batchesQ.error ?? studentsQ.error} />
      {student?.memberId && (
        <Notice tone="amber">
          {student.name} is already a member.{" "}
          <Link href={`/staff/members/${student.memberId}`} className="underline">
            Open their page
          </Link>
        </Notice>
      )}
    </div>
  );
}

type Lookup =
  | { state: "idle" | "busy" | "none"; code: string }
  | { state: "found"; code: string; batchName: string }
  | { state: "member"; code: string; memberId: number; name: string }
  | { state: "error"; code: string; message: string };

function LookupNote({ state, onPick }: { state: Lookup; onPick: () => void }) {
  const pick = (
    <button type="button" className="underline" onClick={onPick}>
      pick from course and batch
    </button>
  );
  const box = "mt-2 text-sm";
  switch (state.state) {
    case "busy":
      return <p className={`${box} text-slate-600`}>Looking up {state.code} in the central HIMT records…</p>;
    case "found":
      return <p className={`${box} text-green-700`}>Filled in from the central records ({state.batchName}). Check and save.</p>;
    case "member":
      return (
        <p className={`${box} text-amber-700`}>
          {state.name} already has this member ID.{" "}
          <Link href={`/staff/members/${state.memberId}`} className="underline">
            Open their page
          </Link>
        </p>
      );
    case "none":
      return (
        <p className={`${box} text-amber-700`}>
          No student with this ID in the central records. Fill the form by hand, or {pick}.
        </p>
      );
    case "error":
      return (
        <p className={`${box} text-red-700`}>
          {state.message} You can also {pick}.
        </p>
      );
    default:
      return null;
  }
}
