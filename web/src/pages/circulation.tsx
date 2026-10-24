import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api, ApiError, queryClient, type Me, type MemberDetail } from "../api";
import { isLibrarian } from "../App";
import { ErrorNote, formatDate, Notice, rupees, ScanInput } from "../ui";

interface Returned {
  barcode: string;
  title: string;
  member: string;
  memberCode: string;
  daysLate: number;
  fine: number;
  /** Set when the book was re-issued rather than returned. */
  dueOn?: string;
}

type ReissueVars = { loanId?: number; barcode?: string; override?: boolean };

export function Circulation({ me }: { me: Me }) {
  const [memberInput, setMemberInput] = useState("");
  const [memberCode, setMemberCode] = useState<string | null>(null);
  const [barcode, setBarcode] = useState("");
  const [returnCode, setReturnCode] = useState("");
  // What a scan in Quick return does: return the book, or re-issue it to the same member.
  const [scanMode, setScanMode] = useState<"return" | "reissue">("return");
  const [issued, setIssued] = useState<string[]>([]);
  const [returned, setReturned] = useState<Returned[]>([]);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const returnRef = useRef<HTMLInputElement>(null);

  const findMember = (code: string) => {
    setMemberCode(code || null);
    setIssued([]);
    issue.reset();
    setTimeout(() => barcodeRef.current?.focus(), 50);
  };

  const member = useQuery({
    queryKey: ["member-code", memberCode],
    queryFn: () => api<MemberDetail>(`/members/by-code/${encodeURIComponent(memberCode!)}`),
    enabled: !!memberCode,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["member-code"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const issue = useMutation({
    mutationFn: (override: boolean) =>
      api<{ title: string; dueOn: string; barcode: string }>("/circulation/issue", {
        body: { memberCode, barcode, override },
      }),
    onSuccess: (r) => {
      setIssued((x) => [`${r.barcode} · ${r.title} · due ${formatDate(r.dueOn)}`, ...x]);
      setBarcode("");
      refresh();
      barcodeRef.current?.focus();
    },
    onError: () => barcodeRef.current?.select(),
  });

  const ret = useMutation({
    mutationFn: (code: string) => api<Returned>("/circulation/return", { body: { barcode: code } }),
    onSuccess: (r) => {
      setReturned((x) => [r, ...x]);
      setReturnCode("");
      refresh();
      returnRef.current?.focus();
    },
    // Select the code so the next scan replaces it instead of adding to it.
    onError: () => returnRef.current?.select(),
  });

  const reissue = useMutation({
    mutationFn: (vars: ReissueVars) => api<Returned>("/circulation/reissue", { body: vars }),
    onSuccess: (r, vars) => {
      setReturned((x) => [r, ...x]);
      if (vars.barcode) {
        setReturnCode("");
        returnRef.current?.focus();
      }
      refresh();
    },
    onError: (_e, vars) => {
      if (vars.barcode) returnRef.current?.select();
    },
  });
  const scanned = (code: string) => {
    if (ret.isPending || reissue.isPending) return;
    ret.reset();
    reissue.reset();
    if (scanMode === "return") ret.mutate(code);
    else reissue.mutate({ barcode: code });
  };

  const reissueErr = reissue.error instanceof ApiError ? reissue.error : null;
  const reissueVars = reissue.variables;
  const reissueProblem = reissueErr && (
    <div className="space-y-2">
      <ErrorNote error={reissueErr} />
      {reissueErr.overridable && isLibrarian(me) && reissueVars && (
        <button className="btn-secondary" onClick={() => reissue.mutate({ ...reissueVars, override: true })}>
          Re-issue anyway (librarian override)
        </button>
      )}
    </div>
  );

  const issueErr = issue.error instanceof ApiError ? issue.error : null;
  const m = member.data;
  const expired = m?.expiresOn && m.expiresOn < new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <h1>Issue & return</h1>
      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card space-y-4 lg:col-span-3">
          <h2>Issue books</h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              findMember(memberInput.trim());
            }}
          >
            <ScanInput
              className="input"
              autoFocus
              placeholder="Scan or type member ID"
              value={memberInput}
              onChange={setMemberInput}
              onScan={findMember}
            />
            <button className="btn-secondary">Find</button>
          </form>
          <ErrorNote error={member.error} />

          {m && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-slate-50 p-3">
                <div>
                  <Link href={`/staff/members/${m.id}`} className="text-lg font-semibold text-brand-700 hover:underline">
                    {m.name}
                  </Link>
                  <div className="text-sm text-slate-600">
                    {m.code} · {m.type.name} · {m.department}
                  </div>
                  <div className="text-xs text-slate-500">
                    Can borrow {m.type.loanLimit} for {m.type.loanDays} days · fine {rupees(m.type.finePerDay)}/day
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div>
                    {m.current.length} of {m.type.loanLimit} on loan
                  </div>
                  {m.balance > 0 && <div className="font-medium text-red-700">Owes {rupees(m.balance)}</div>}
                  {expired && <div className="font-medium text-red-700">Membership expired {formatDate(m.expiresOn)}</div>}
                  {!m.active && <div className="font-medium text-red-700">Inactive member</div>}
                </div>
              </div>

              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (barcode.trim()) issue.mutate(false);
                }}
              >
                <ScanInput
                  ref={barcodeRef}
                  className="input font-mono"
                  placeholder="Scan book barcode to issue"
                  value={barcode}
                  onScan={() => issue.mutate(false)}
                  onChange={(v) => {
                    setBarcode(v);
                    issue.reset();
                  }}
                />
                <button className="btn-primary" disabled={issue.isPending || !barcode.trim()}>
                  Issue
                </button>
              </form>
              {issueErr && (
                <div className="space-y-2">
                  <ErrorNote error={issueErr} />
                  {issueErr.overridable && isLibrarian(me) && (
                    <button className="btn-secondary" onClick={() => issue.mutate(true)}>
                      Issue anyway (librarian override)
                    </button>
                  )}
                </div>
              )}
              {issued.map((line) => (
                <Notice key={line}>Issued {line}</Notice>
              ))}

              <div>
                <h3 className="text-sm font-semibold text-slate-700">Currently on loan</h3>
                {m.current.length === 0 ? (
                  <p className="text-sm text-slate-500">Nothing on loan.</p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Barcode</th>
                        <th>Title</th>
                        <th>Due</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {m.current.map((l) => (
                        <tr key={l.id}>
                          <td className="font-mono">{l.barcode}</td>
                          <td>{l.title}</td>
                          <td className={`whitespace-nowrap ${l.overdue ? "font-medium text-red-700" : ""}`}>
                            {formatDate(l.dueOn)}
                            {l.overdue && " (overdue)"}
                          </td>
                          <td className="whitespace-nowrap text-right">
                            <button
                              className="text-sm text-brand-700 underline disabled:opacity-40"
                              disabled={reissue.isPending}
                              title={`Re-issued ${l.renewCount} of ${m.type.renewLimit} times${l.overdue ? ". The late fine is charged first" : ""}`}
                              onClick={() => reissue.mutate({ loanId: l.id })}
                            >
                              Re-issue
                            </button>
                            <button className="ml-3 text-sm text-brand-700 underline" onClick={() => ret.mutate(l.barcode)}>
                              Return
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {reissueVars?.loanId && reissueProblem}
              </div>
            </div>
          )}
        </section>

        <section className="card space-y-4 lg:col-span-2">
          <h2>Quick return</h2>
          <p className="text-sm text-slate-500">
            Pick what a scan should do, then scan the book. Re-issue lends it again to the same member. Late fines are added
            automatically.
          </p>
          <div className="inline-flex rounded-md border border-slate-300 p-0.5" role="radiogroup" aria-label="When a book is scanned">
            {(["return", "reissue"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={scanMode === mode}
                className={`rounded px-3 py-1 text-sm font-medium ${
                  scanMode === mode ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
                onClick={() => {
                  setScanMode(mode);
                  ret.reset();
                  reissue.reset();
                  returnRef.current?.focus();
                }}
              >
                {mode === "return" ? "Return" : "Re-issue"}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (returnCode.trim()) scanned(returnCode.trim());
            }}
          >
            <ScanInput
              ref={returnRef}
              className="input min-w-0 font-mono"
              placeholder={scanMode === "return" ? "Scan book barcode to return" : "Scan book barcode to re-issue"}
              value={returnCode}
              onScan={scanned}
              onChange={(v) => {
                setReturnCode(v);
                ret.reset();
                reissue.reset();
              }}
            />
            <button className="btn-primary whitespace-nowrap" disabled={ret.isPending || reissue.isPending || !returnCode.trim()}>
              {scanMode === "return" ? "Return" : "Re-issue"}
            </button>
          </form>
          <ErrorNote error={ret.error} />
          {reissueVars?.barcode && reissueProblem}
          {returned.map((r, i) => (
            <Notice key={`${r.barcode}-${i}`} tone={r.fine > 0 ? "amber" : "green"}>
              <div>
                {r.dueOn ? "Re-issued" : "Returned"} <span className="font-mono">{r.barcode}</span> · {r.title}
              </div>
              <div className="text-xs">
                {r.dueOn ? "to" : "from"} {r.member} ({r.memberCode})
                {r.dueOn && ` · now due ${formatDate(r.dueOn)}`}
                {r.fine > 0 ? ` · ${r.daysLate} day(s) late, fine ${rupees(r.fine)} added` : r.dueOn ? "" : " · on time"}
              </div>
            </Notice>
          ))}
        </section>
      </div>
    </div>
  );
}
