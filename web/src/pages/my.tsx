import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api, ApiError, queryClient, type MemberDetail } from "../api";
import { ErrorNote, formatDate, Loading, rupees } from "../ui";

type Mine = Omit<MemberDetail, "notes" | "address">;

/** "My library": what an employee who signed in from the Employee Portal sees. */
export function MyLibrary() {
  const [, navigate] = useLocation();
  const { data: m, isLoading, error } = useQuery({
    queryKey: ["my"],
    queryFn: async () => {
      try {
        return await api<Mine>("/my");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      navigate("/");
    },
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-brand-900 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4">
          <span className="text-lg font-semibold">My library</span>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-brand-100 underline">
              Search the catalogue
            </Link>
            {m && (
              <button className="text-brand-100 underline" onClick={() => logout.mutate()}>
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {!m ? (
          <div className="card">
            <h1>You're not signed in</h1>
            <p className="mt-2 text-sm text-slate-600">Open the library again from the Employee Portal to see your books and fines.</p>
          </div>
        ) : (
          <>
            <div className="card">
              <h1>{m.name}</h1>
              <p className="text-sm text-slate-500">
                Member ID {m.code} · {m.type.name}
                {m.department ? ` · ${m.department}` : ""}
                {m.expiresOn ? ` · Membership until ${formatDate(m.expiresOn)}` : ""}
              </p>
            </div>

            <div className="card">
              <h2>Books with you ({m.current.length})</h2>
              {m.current.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">You have no books on loan.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table mt-2">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Issued</th>
                        <th>Due back</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.current.map((l) => (
                        <tr key={l.id}>
                          <td>
                            <Link href={`/title/${l.titleId}`} className="text-brand-700 underline">
                              {l.title}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap">{formatDate(l.issuedOn)}</td>
                          <td className={`whitespace-nowrap ${l.overdue ? "font-medium text-red-700" : ""}`}>
                            {formatDate(l.dueOn)}
                            {l.overdue && " (overdue)"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2>Fines</h2>
                <span className={m.balance > 0 ? "font-semibold text-red-700" : "text-slate-600"}>
                  {m.balance > 0 ? `You owe ${rupees(m.balance)}` : "Nothing owed"}
                </span>
              </div>
              {m.balance > 0 && <p className="mt-1 text-sm text-slate-500">Please pay at the library counter.</p>}
              {m.fines.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="table mt-2">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Details</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.fines.map((f) => (
                        <tr key={f.id} className={f.waived ? "text-slate-400 line-through" : ""}>
                          <td className="whitespace-nowrap">{formatDate(f.chargedOn)}</td>
                          <td>{f.reason}</td>
                          <td className="text-right">{rupees(Number(f.amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {m.history.length > 0 && (
              <div className="card">
                <h2>Returned books</h2>
                <div className="overflow-x-auto">
                  <table className="table mt-2">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Issued</th>
                        <th>Returned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.history.map((l) => (
                        <tr key={l.id}>
                          <td>{l.title}</td>
                          <td className="whitespace-nowrap">{formatDate(l.issuedOn)}</td>
                          <td className="whitespace-nowrap">{formatDate(l.returnedOn)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
