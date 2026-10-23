import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";

export const rupees = (n: number | string | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function formatDate(d: string | null | undefined) {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Notice({ tone = "green", children }: { tone?: "green" | "amber" | "blue"; children: ReactNode }) {
  const tones = {
    green: "border-green-200 bg-green-50 text-green-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-brand-100 bg-brand-50 text-brand-900",
  };
  return <div className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

export function Loading() {
  return <p className="py-8 text-center text-sm text-slate-500">Loading…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-3 text-sm text-slate-600">
      <span>
        {total.toLocaleString("en-IN")} results · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

const statusStyle: Record<string, string> = {
  available: "bg-green-100 text-green-800",
  "on loan": "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
  repair: "bg-slate-200 text-slate-700",
  no_loan: "bg-slate-200 text-slate-700",
  missing: "bg-red-100 text-red-800",
  withdrawn: "bg-slate-200 text-slate-500",
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusStyle[status] ?? "bg-slate-100"}`}>{status.replace("_", " ")}</span>;
}

/** Search box that waits for the user to pause typing. */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

type ScanInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  /** Called with the trimmed code when a scan or typed entry is complete. */
  onScan: (code: string) => void;
};

/**
 * A text box for barcode scanners. Scanners type the code very fast and then
 * usually press Enter, but some are set to send Tab or nothing at all. Enter
 * and Tab both finish the entry, and a fast burst of keys followed by a short
 * pause counts as a finished scan too. Typing by hand still needs Enter.
 */
export const ScanInput = forwardRef<HTMLInputElement, ScanInputProps>(function ScanInput(
  { value, onChange, onScan, onKeyDown, ...rest },
  ref,
) {
  const keys = useRef<number[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const finish = () => {
    window.clearTimeout(timer.current);
    keys.current = [];
    const code = latest.current.trim();
    if (code) onScan(code);
  };

  return (
    <input
      ref={ref}
      autoComplete="off"
      spellCheck={false}
      {...rest}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        const now = performance.now();
        keys.current = [...keys.current.filter((t) => now - t < 1000), now];
        window.clearTimeout(timer.current);
        const k = keys.current;
        // At least 4 keys, each under 50 ms apart: a scanner, not a person.
        const burst = k.length >= 4 && k.slice(1).every((t, i) => t - k[i] < 50);
        if (burst) timer.current = window.setTimeout(finish, 150);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.key === "Enter" || (e.key === "Tab" && latest.current.trim())) {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
});
