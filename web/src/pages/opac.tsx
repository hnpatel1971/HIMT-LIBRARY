import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api, type Paged, type TitleDetail, type TitleRow } from "../api";
import { Empty, ErrorNote, formatDate, Loading, Pager, StatusBadge, useDebounced } from "../ui";

function useLibraryName() {
  return useQuery({ queryKey: ["opac-info"], queryFn: () => api<{ libraryName: string }>("/opac/info") }).data?.libraryName;
}

function Header() {
  const name = useLibraryName();
  return (
    <header className="bg-brand-900 text-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-lg font-semibold">
          {name ?? "Library"}
        </Link>
        <Link href="/staff" className="text-sm text-brand-100 underline">
          Staff login
        </Link>
      </div>
    </header>
  );
}

export function OpacHome() {
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [page, setPage] = useState(1);
  const term = useDebounced(q.trim());
  const { data, isLoading, error } = useQuery({
    queryKey: ["opac", term, page],
    queryFn: () => api<Paged<TitleRow>>(`/opac/titles?q=${encodeURIComponent(term)}&page=${page}`),
    enabled: term.length > 1,
    placeholderData: keepPreviousData,
  });
  return (
    <div className="min-h-screen">
      <Header />
      <section className="bg-brand-700 pb-10 pt-8 text-white">
        <div className="mx-auto max-w-5xl px-4">
          <h1 className="text-white">Search the library catalogue</h1>
          <p className="mt-1 text-sm text-brand-100">Find books by title, author, subject or ISBN, and see if a copy is on the shelf.</p>
          <input
            autoFocus
            className="input mt-4 py-3 text-base text-slate-900"
            placeholder="e.g. marine engineering, Reeds, 9780..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </section>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <ErrorNote error={error} />
        {term.length < 2 ? (
          <Empty>Type at least two letters to search.</Empty>
        ) : isLoading ? (
          <Loading />
        ) : !data?.rows.length ? (
          <Empty>No books match “{term}”.</Empty>
        ) : (
          <>
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {data.rows.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <Link href={`/title/${t.id}`} className="font-medium text-brand-700 hover:underline">
                      {t.title}
                    </Link>
                    <div className="text-sm text-slate-600">
                      {[t.authors.join(", "), t.publisher, t.year].filter(Boolean).join(" · ")}
                    </div>
                    {t.callNumber && <div className="text-xs text-slate-500">Call number {t.callNumber}</div>}
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    {t.available > 0 ? (
                      <span className="badge bg-green-100 text-green-800">{t.available} available</span>
                    ) : t.copies > 0 ? (
                      <span className="badge bg-amber-100 text-amber-800">All on loan</span>
                    ) : (
                      <span className="badge bg-slate-100 text-slate-600">No copies</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </>
        )}
      </main>
    </div>
  );
}

export function OpacTitle({ id }: { id: number }) {
  const { data: t, isLoading, error } = useQuery({ queryKey: ["opac-title", id], queryFn: () => api<TitleDetail>(`/opac/titles/${id}`) });
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <button className="mb-4 text-sm text-brand-700 underline" onClick={() => history.back()}>
          ← Back to results
        </button>
        <ErrorNote error={error} />
        {isLoading || !t ? (
          <Loading />
        ) : (
          <div className="card">
            <h1>{t.title}</h1>
            {t.authors.length > 0 && <p className="mt-1 text-slate-700">{t.authors.join(", ")}</p>}
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {(
                [
                  ["Publisher", [t.publisher, t.place].filter(Boolean).join(", ")],
                  ["Year", t.year],
                  ["Edition", t.edition],
                  ["ISBN", t.isbn],
                  ["Call number", t.callNumber],
                  ["Format", t.format],
                  ["Subjects", t.subjects.join(", ")],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-slate-500">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            <h2 className="mt-6">Copies</h2>
            {t.copies.length === 0 ? (
              <Empty>The library has no copies of this title.</Empty>
            ) : (
              <table className="table mt-2">
                <thead>
                  <tr>
                    <th>Barcode</th>
                    <th>Shelf</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {t.copies.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono">{c.barcode}</td>
                      <td>{c.location}</td>
                      <td>
                        {c.onLoan ? (
                          <span className="text-amber-800">On loan, due {formatDate(c.dueOn)}</span>
                        ) : (
                          <StatusBadge status={c.status} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
