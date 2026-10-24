import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api, queryClient, type CopyInfo, type Lookup, type Me, type Paged, type TitleDetail, type TitleRow } from "../api";
import { isLibrarian } from "../App";
import { Empty, ErrorNote, Field, formatDate, Loading, Pager, rupees, StatusBadge, useDebounced } from "../ui";

export function useLookups() {
  const locations = useQuery({ queryKey: ["locations"], queryFn: () => api<Lookup[]>("/locations") }).data ?? [];
  const collectionTypes = useQuery({ queryKey: ["collection-types"], queryFn: () => api<Lookup[]>("/collection-types") }).data ?? [];
  const formats = useQuery({ queryKey: ["formats"], queryFn: () => api<Lookup[]>("/formats") }).data ?? [];
  return { locations, collectionTypes, formats };
}

export function CatalogueList({ me }: { me: Me }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const term = useDebounced(q.trim());
  const { data, isLoading, error } = useQuery({
    queryKey: ["titles", term, page],
    queryFn: () => api<Paged<TitleRow>>(`/titles?q=${encodeURIComponent(term)}&page=${page}`),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Catalogue</h1>
        {isLibrarian(me) && (
          <Link href="/staff/catalogue/new" className="btn-primary">
            Add a title
          </Link>
        )}
      </div>
      <input
        className="input"
        placeholder="Search title, author, subject, ISBN, call number or barcode"
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
          <Empty>No titles found.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Authors</th>
                <th>Call no.</th>
                <th className="text-right">Copies</th>
                <th className="text-right">On shelf</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/staff/catalogue/${t.id}`} className="font-medium text-brand-700 hover:underline">
                      {t.title}
                    </Link>
                    <div className="text-xs text-slate-500">{[t.publisher, t.year].filter(Boolean).join(", ")}</div>
                  </td>
                  <td>{[...t.authors, t.corporateAuthor].filter(Boolean).join(", ")}</td>
                  <td>{t.callNumber}</td>
                  <td className="text-right">{t.copies}</td>
                  <td className="text-right">{t.available}</td>
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

const emptyCopy = {
  barcode: "",
  locationId: null as number | null,
  collectionTypeId: null as number | null,
  status: "available" as CopyInfo["status"],
  callNumber: "",
  price: "",
  supplier: "",
  invoice: "",
  receivedOn: "",
};

function CopyForm({ titleId, copy, onDone }: { titleId: number; copy?: CopyInfo; onDone: () => void }) {
  const { locations, collectionTypes } = useLookups();
  const [f, setF] = useState(() =>
    copy
      ? {
          barcode: copy.barcode,
          locationId: copy.locationId ?? null,
          collectionTypeId: copy.collectionTypeId ?? null,
          status: copy.status,
          callNumber: copy.callNumber ?? "",
          price: copy.price ?? "",
          supplier: copy.supplier ?? "",
          invoice: copy.invoice ?? "",
          receivedOn: copy.receivedOn ?? "",
        }
      : emptyCopy,
  );
  const [pattern, setPattern] = useState("HI00000MT");
  useEffect(() => {
    if (copy) return;
    api<{ barcode: string }>(`/next-barcode?pattern=${pattern}`)
      .then((r) => setF((x) => ({ ...x, barcode: r.barcode })))
      .catch(() => undefined);
  }, [pattern, copy]);
  const save = useMutation({
    mutationFn: () =>
      api(copy ? `/copies/${copy.id}` : `/titles/${titleId}/copies`, {
        method: copy ? "PUT" : "POST",
        body: { ...f, price: f.price === "" ? null : f.price },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["title", titleId] });
      onDone();
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const setId = (k: "locationId" | "collectionTypeId") => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value ? Number(e.target.value) : null });
  return (
    <form
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <ErrorNote error={save.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Barcode" hint={copy ? undefined : "Next free number is filled in"}>
          <input className="input font-mono" value={f.barcode} onChange={set("barcode")} required />
        </Field>
        {!copy && (
          <Field label="Barcode series">
            <select className="input" value={pattern} onChange={(e) => setPattern(e.target.value)}>
              <option value="HI00000MT">Books (HI00000MT)</option>
              <option value="E00000B">E-resources (E00000B)</option>
            </select>
          </Field>
        )}
        <Field label="Shelf / rack">
          <select className="input" value={f.locationId ?? ""} onChange={setId("locationId")}>
            <option value="">Not set</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Collection">
          <select className="input" value={f.collectionTypeId ?? ""} onChange={setId("collectionTypeId")}>
            <option value="">Not set</option>
            {collectionTypes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className="input" value={f.status} onChange={set("status")}>
            <option value="available">Available to lend</option>
            <option value="no_loan">Reference only (no loan)</option>
            <option value="repair">Under repair</option>
            <option value="missing">Missing</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </Field>
        <Field label="Price (₹)">
          <input className="input" inputMode="decimal" value={f.price} onChange={set("price")} />
        </Field>
        <Field label="Supplier">
          <input className="input" value={f.supplier} onChange={set("supplier")} />
        </Field>
        <Field label="Invoice no.">
          <input className="input" value={f.invoice} onChange={set("invoice")} />
        </Field>
        <Field label="Received on">
          <input className="input" type="date" value={f.receivedOn} onChange={set("receivedOn")} />
        </Field>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={save.isPending}>
          {copy ? "Save copy" : "Add copy"}
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function TitlePage({ id, me }: { id: number; me: Me }) {
  const [, navigate] = useLocation();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const { data: t, isLoading, error } = useQuery({ queryKey: ["title", id], queryFn: () => api<TitleDetail>(`/titles/${id}`) });
  const del = useMutation({
    mutationFn: () => api(`/titles/${id}`, { method: "DELETE" }),
    onSuccess: () => navigate("/staff/catalogue"),
  });
  const delCopy = useMutation({
    mutationFn: (copyId: number) => api(`/copies/${copyId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["title", id] }),
  });
  if (isLoading) return <Loading />;
  if (!t) return <ErrorNote error={error} />;
  const lib = isLibrarian(me);
  return (
    <div className="space-y-4">
      <Link href="/staff/catalogue" className="text-sm text-brand-700 underline">
        ← Catalogue
      </Link>
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1>{t.title}</h1>
            <p className="text-slate-700">{[...t.authors, t.corporateAuthor].filter(Boolean).join(", ")}</p>
          </div>
          {lib && (
            <div className="flex gap-2">
              <Link href={`/staff/catalogue/${id}/edit`} className="btn-secondary">
                Edit
              </Link>
              {t.copies.length === 0 && (
                <button className="btn-danger" onClick={() => confirm("Delete this title?") && del.mutate()}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
        <ErrorNote error={del.error} />
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          {(
            [
              ["Corporate author", t.corporateAuthor],
              ["Publisher", t.publisher],
              ["Place", t.place],
              ["Year", t.year],
              ["Edition", t.edition],
              ["ISBN", t.isbn],
              ["Call number", t.callNumber],
              ["Classification", t.classification],
              ["Language", t.language],
              ["Format", t.format],
              ["Subjects", t.subjects.join(", ")],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-slate-500">{k}</dt>
              <dd>{v || "—"}</dd>
            </div>
          ))}
        </dl>
        {t.notes && <p className="mt-3 text-sm text-slate-600">{t.notes}</p>}
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2>Copies ({t.copies.length})</h2>
          {lib && editing === null && (
            <button className="btn-secondary" onClick={() => setEditing("new")}>
              Add a copy
            </button>
          )}
        </div>
        {editing === "new" && <CopyForm titleId={id} onDone={() => setEditing(null)} />}
        <ErrorNote error={delCopy.error} />
        {t.copies.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Barcode</th>
                  <th>Shelf</th>
                  <th>Collection</th>
                  <th>Status</th>
                  <th>Price</th>
                  {lib && <th />}
                </tr>
              </thead>
              <tbody>
                {t.copies.map((c) =>
                  editing === c.id ? (
                    <tr key={c.id}>
                      <td colSpan={6}>
                        <CopyForm titleId={id} copy={c} onDone={() => setEditing(null)} />
                      </td>
                    </tr>
                  ) : (
                    <tr key={c.id}>
                      <td className="font-mono">{c.barcode}</td>
                      <td>{c.location}</td>
                      <td>{c.collectionType}</td>
                      <td>
                        {c.onLoan ? (
                          <span className="text-sm">
                            <StatusBadge status="on loan" /> {c.borrower} ({c.borrowerCode}), due {formatDate(c.dueOn)}
                          </span>
                        ) : (
                          <StatusBadge status={c.status} />
                        )}
                      </td>
                      <td>{c.price ? rupees(c.price) : ""}</td>
                      {lib && (
                        <td className="whitespace-nowrap text-right">
                          <button className="text-sm text-brand-700 underline" onClick={() => setEditing(c.id)}>
                            Edit
                          </button>
                          {!c.onLoan && (
                            <button
                              className="ml-3 text-sm text-red-700 underline"
                              onClick={() => confirm(`Delete copy ${c.barcode}?`) && delCopy.mutate(c.id)}
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const splitList = (s: string) =>
  s
    .split(/[\n;]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function TitleEditor({ id }: { id?: number }) {
  const [, navigate] = useLocation();
  const { formats } = useLookups();
  const existing = useQuery({ queryKey: ["title", id], queryFn: () => api<TitleDetail>(`/titles/${id}`), enabled: !!id });
  const [f, setF] = useState({
    title: "",
    authors: "",
    corporateAuthor: "",
    subjects: "",
    publisher: "",
    place: "",
    year: "",
    edition: "",
    isbn: "",
    callNumber: "",
    classification: "",
    language: "English",
    formatId: "",
    notes: "",
  });
  useEffect(() => {
    const t = existing.data;
    if (!t) return;
    setF({
      title: t.title,
      authors: t.authors.join("; "),
      corporateAuthor: t.corporateAuthor ?? "",
      subjects: t.subjects.join("; "),
      publisher: t.publisher ?? "",
      place: t.place ?? "",
      year: t.year ?? "",
      edition: t.edition ?? "",
      isbn: t.isbn ?? "",
      callNumber: t.callNumber ?? "",
      classification: t.classification ?? "",
      language: t.language ?? "",
      formatId: t.formatId ? String(t.formatId) : "",
      notes: t.notes ?? "",
    });
  }, [existing.data]);
  const save = useMutation({
    mutationFn: () =>
      api<{ id: number }>(id ? `/titles/${id}` : "/titles", {
        method: id ? "PUT" : "POST",
        body: { ...f, authors: splitList(f.authors), subjects: splitList(f.subjects), formatId: f.formatId ? Number(f.formatId) : null },
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["title", r.id] });
      queryClient.invalidateQueries({ queryKey: ["titles"] });
      navigate(`/staff/catalogue/${r.id}`);
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
      <h1>{id ? "Edit title" : "Add a title"}</h1>
      <ErrorNote error={save.error} />
      <Field label="Title">
        <input className="input" value={f.title} onChange={set("title")} required autoFocus />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Authors" hint="Separate several with ;">
          <input className="input" value={f.authors} onChange={set("authors")} />
        </Field>
        <Field label="Corporate author" hint="An organisation, e.g. IMO or DG Shipping">
          <input className="input" value={f.corporateAuthor} onChange={set("corporateAuthor")} />
        </Field>
        <Field label="Subjects" hint="Separate several with ;" className="sm:col-span-2">
          <input className="input" value={f.subjects} onChange={set("subjects")} />
        </Field>
        <Field label="Publisher">
          <input className="input" value={f.publisher} onChange={set("publisher")} />
        </Field>
        <Field label="Place of publication">
          <input className="input" value={f.place} onChange={set("place")} />
        </Field>
        <Field label="Year">
          <input className="input" value={f.year} onChange={set("year")} />
        </Field>
        <Field label="Edition">
          <input className="input" value={f.edition} onChange={set("edition")} />
        </Field>
        <Field label="ISBN">
          <input className="input" value={f.isbn} onChange={set("isbn")} />
        </Field>
        <Field label="Call number">
          <input className="input" value={f.callNumber} onChange={set("callNumber")} />
        </Field>
        <Field label="Classification (DDC)">
          <input className="input" value={f.classification} onChange={set("classification")} />
        </Field>
        <Field label="Language">
          <input className="input" value={f.language} onChange={set("language")} />
        </Field>
        <Field label="Format">
          <select className="input" value={f.formatId} onChange={set("formatId")}>
            <option value="">Not set</option>
            {formats.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Notes">
        <textarea className="input" rows={3} value={f.notes} onChange={set("notes")} />
      </Field>
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
