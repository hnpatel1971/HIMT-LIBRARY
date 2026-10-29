import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { code128Svg } from "../barcode";
import { Empty, ErrorNote, Field, formatDate, Loading, Notice, StatusBadge, useDebounced } from "../ui";

export interface LabelCopy {
  id: number;
  barcode: string;
  title: string;
  callNumber: string | null;
}
interface LabelRow extends LabelCopy {
  titleId: number;
  status: string;
  createdAt: string;
}

// The print list survives page changes, so staff can collect copies from
// several titles and print them on one sheet.
const LIST_KEY = "himt-labels";
const SETTINGS_KEY = "himt-label-settings";

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can refuse storage; the list then lasts until reload.
  }
}

export function readLabelList(): LabelCopy[] {
  return load<{ items: LabelCopy[] }>(LIST_KEY, { items: [] }).items;
}
export function addToLabelList(copies: LabelCopy[]) {
  const items = readLabelList();
  const have = new Set(items.map((c) => c.id));
  save(LIST_KEY, { items: [...items, ...copies.filter((c) => !have.has(c.id))] });
}

// Sizes in millimetres on an A4 sheet. 3 across at 64 x 50 mm leaves room for
// the printer's margins; the old SLiMS labels were about 7 x 5 cm.
const defaults = {
  columns: 3,
  width: 64,
  height: 50,
  gap: 3,
  marginTop: 10,
  marginLeft: 6,
  fontSize: 11,
  barcodeWidth: 80,
  showCallNumber: false,
  border: true,
};
type Settings = typeof defaults;
const PAGE_W = 210;
const PAGE_H = 297;
const TITLE_MAX = 50;

export const cutTitle = (t: string) => (t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t);

function perPage(s: Settings) {
  const rows = Math.max(1, Math.floor((PAGE_H - s.marginTop * 2 + s.gap) / (s.height + s.gap)));
  return { rows, total: rows * s.columns };
}

function fitsAcross(s: Settings) {
  return s.marginLeft + s.columns * s.width + (s.columns - 1) * s.gap <= PAGE_W;
}

type Mode = "search" | "range" | "since";

export function BarcodeLabels() {
  const [list, setList] = useState<LabelCopy[]>(readLabelList);
  const [settings, setSettings] = useState<Settings>(() => load(SETTINGS_KEY, defaults));
  const [skip, setSkip] = useState(0);
  useEffect(() => save(LIST_KEY, { items: list }), [list]);
  useEffect(() => save(SETTINGS_KEY, settings), [settings]);

  const add = (rows: LabelCopy[]) => {
    const have = new Set(list.map((c) => c.id));
    setList([...list, ...rows.filter((c) => !have.has(c.id)).map(({ id, barcode, title, callNumber }) => ({ id, barcode, title, callNumber }))]);
  };
  const { total } = perPage(settings);
  const pages = Math.ceil((list.length + skip) / total);

  return (
    <div className="space-y-4">
      <div>
        <h1>Barcode labels</h1>
        <p className="text-sm text-slate-600">
          Find copies, add them to the print list, then print the list on A4 paper. Many labels fit on one sheet.
        </p>
      </div>

      <FindCopies onAdd={add} listed={new Set(list.map((c) => c.id))} />

      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2>
            Print list ({list.length} {list.length === 1 ? "label" : "labels"}
            {list.length > 0 && `, ${pages} ${pages === 1 ? "sheet" : "sheets"}`})
          </h2>
          <div className="flex gap-2">
            {list.length > 0 && (
              <button className="btn-secondary" onClick={() => confirm("Remove every label from the list?") && setList([])}>
                Clear list
              </button>
            )}
            <button className="btn-primary" disabled={!list.length || !fitsAcross(settings)} onClick={() => window.print()}>
              Print labels
            </button>
          </div>
        </div>
        {list.length === 0 ? (
          <Empty>No labels yet. Find copies above and add them.</Empty>
        ) : (
          <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
            {list.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm">
                <span className="font-mono">{c.barcode}</span>
                <button
                  className="rounded-full px-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                  aria-label={`Remove ${c.barcode}`}
                  onClick={() => setList(list.filter((x) => x.id !== c.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <LabelSettings settings={settings} onChange={setSettings} skip={skip} onSkip={setSkip} />
        {!fitsAcross(settings) && (
          <Notice tone="amber">
            {settings.columns} labels of {settings.width} mm do not fit across an A4 sheet (210 mm). Make the labels narrower or use fewer
            per row.
          </Notice>
        )}
        {list.length > 0 && (
          <div>
            <div className="label">Preview of the first sheet</div>
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-slate-100 p-4">
              <div className="mx-auto w-fit shadow-md" style={{ zoom: 0.6 }}>
                <Sheet copies={list.slice(0, total - skip)} skip={skip} settings={settings} />
              </div>
            </div>
          </div>
        )}
      </div>

      {createPortal(<PrintSheets copies={list} skip={skip} settings={settings} />, document.body)}
    </div>
  );
}

function FindCopies({ onAdd, listed }: { onAdd: (rows: LabelCopy[]) => void; listed: Set<number> }) {
  const [mode, setMode] = useState<Mode>("search");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [since, setSince] = useState(() => new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10));
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const params = useDebounced(
    mode === "search"
      ? q.trim().length >= 2
        ? `q=${encodeURIComponent(q.trim())}`
        : ""
      : mode === "range"
        ? from.trim() && to.trim()
          ? `from=${encodeURIComponent(from.trim())}&to=${encodeURIComponent(to.trim())}`
          : ""
        : since
          ? `since=${since}`
          : "",
  );
  const { data, isFetching, error } = useQuery({
    queryKey: ["labels", params],
    queryFn: () => api<{ rows: LabelRow[]; more: boolean }>(`/labels?${params}`),
    enabled: !!params,
  });
  useEffect(() => setPicked(new Set()), [params]);
  const rows = useMemo(() => (params ? (data?.rows ?? []) : []), [data, params]);
  const fresh = rows.filter((r) => !listed.has(r.id));
  const allPicked = fresh.length > 0 && fresh.every((r) => picked.has(r.id));
  const toggle = (id: number) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const tabs: [Mode, string][] = [
    ["search", "Title or barcode"],
    ["range", "Barcode range"],
    ["since", "Recently added"],
  ];
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap gap-1 rounded-md bg-slate-100 p-1 text-sm">
        {tabs.map(([m, label]) => (
          <button
            key={m}
            className={`rounded px-3 py-1.5 ${mode === m ? "bg-white font-medium shadow-xs" : "text-slate-600 hover:text-slate-900"}`}
            onClick={() => setMode(m)}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "search" && (
        <input
          className="input"
          placeholder="Search title, author, call number or barcode"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      )}
      {mode === "range" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From barcode">
            <input className="input font-mono" placeholder="HI01200MT" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To barcode">
            <input className="input font-mono" placeholder="HI01299MT" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      )}
      {mode === "since" && (
        <Field label="Copies added on or after" hint="Copies brought over from SLiMS count as added on the day the new system was installed.">
          <input type="date" className="input max-w-xs" value={since} onChange={(e) => setSince(e.target.value)} />
        </Field>
      )}
      <ErrorNote error={error} />
      {!params ? null : isFetching && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>No copies found.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-slate-600">
              {rows.length.toLocaleString("en-IN")} {rows.length === 1 ? "copy" : "copies"}
              {data?.more && " (showing the first 1,000; narrow the search for more)"}
            </span>
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                disabled={!picked.size}
                onClick={() => {
                  onAdd(rows.filter((r) => picked.has(r.id)));
                  setPicked(new Set());
                }}
              >
                Add selected ({picked.size})
              </button>
              <button className="btn-primary" disabled={!fresh.length} onClick={() => onAdd(fresh)}>
                Add all {fresh.length}
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-auto rounded-md border border-slate-200">
            <table className="table">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allPicked}
                      disabled={!fresh.length}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(fresh.map((r) => r.id)))}
                    />
                  </th>
                  <th>Barcode</th>
                  <th>Title</th>
                  <th>Call no.</th>
                  <th>Status</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={listed.has(r.id) ? "text-slate-400" : ""}>
                    <td>
                      {listed.has(r.id) ? (
                        <span title="Already in the print list">✓</span>
                      ) : (
                        <input type="checkbox" aria-label={`Select ${r.barcode}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                      )}
                    </td>
                    <td className="font-mono">{r.barcode}</td>
                    <td>{r.title}</td>
                    <td>{r.callNumber}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="whitespace-nowrap">{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function LabelSettings({
  settings: s,
  onChange,
  skip,
  onSkip,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  skip: number;
  onSkip: (n: number) => void;
}) {
  const { rows, total } = perPage(s);
  const num = (k: keyof Settings, min: number, max: number) => ({
    type: "number",
    className: "input",
    min,
    max,
    value: s[k] as number,
    onChange: (e: { target: { value: string } }) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v)) onChange({ ...s, [k]: Math.min(max, Math.max(min, v)) });
    },
  });
  return (
    <details className="rounded-md border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-medium text-slate-700">
        Label size and layout: {s.columns} per row, {rows} rows, {total} per sheet, {s.width} × {s.height} mm
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Labels per row">
          <input {...num("columns", 1, 6)} />
        </Field>
        <Field label="Label width (mm)">
          <input {...num("width", 20, 200)} />
        </Field>
        <Field label="Label height (mm)">
          <input {...num("height", 15, 280)} />
        </Field>
        <Field label="Gap between labels (mm)">
          <input {...num("gap", 0, 20)} />
        </Field>
        <Field label="Top and bottom margin (mm)">
          <input {...num("marginTop", 0, 40)} />
        </Field>
        <Field label="Left margin (mm)">
          <input {...num("marginLeft", 0, 40)} />
        </Field>
        <Field label="Title text size (pt)">
          <input {...num("fontSize", 6, 20)} />
        </Field>
        <Field label="Barcode width (% of label)">
          <input {...num("barcodeWidth", 30, 100)} />
        </Field>
        <Field label="Start at label" hint="Skip labels already used on a part-used sheet.">
          <input
            type="number"
            className="input"
            min={1}
            max={total}
            value={skip + 1}
            onChange={(e) => onSkip(Math.min(total - 1, Math.max(0, Number(e.target.value) - 1 || 0)))}
          />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={s.border} onChange={(e) => onChange({ ...s, border: e.target.checked })} />
          Border round each label
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={s.showCallNumber} onChange={(e) => onChange({ ...s, showCallNumber: e.target.checked })} />
          Show call number
        </label>
        <div className="self-end pb-2">
          <button className="text-sm text-brand-700 underline" onClick={() => onChange(defaults)}>
            Reset to standard size
          </button>
        </div>
      </div>
    </details>
  );
}

function Label({ copy, s }: { copy: LabelCopy; s: Settings }) {
  const svg = useMemo(() => {
    try {
      return code128Svg(copy.barcode);
    } catch {
      return null;
    }
  }, [copy.barcode]);
  return (
    <div
      className="flex flex-col items-center justify-center overflow-hidden text-center text-black"
      style={{
        width: `${s.width}mm`,
        height: `${s.height}mm`,
        padding: "2.5mm",
        boxSizing: "border-box",
        border: s.border ? "0.3mm solid #000" : undefined,
        fontSize: `${s.fontSize}pt`,
        lineHeight: 1.2,
      }}
    >
      <div className="w-full font-medium" style={{ overflowWrap: "anywhere" }}>
        {cutTitle(copy.title)}
      </div>
      {s.showCallNumber && copy.callNumber && <div style={{ fontSize: `${Math.max(6, s.fontSize - 2)}pt` }}>{copy.callNumber}</div>}
      {svg ? (
        <div
          className="mt-[1.5mm] min-h-0 flex-1 [&>svg]:h-full [&>svg]:w-full"
          style={{ width: `${s.barcodeWidth}%`, maxHeight: "22mm" }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="mt-[1.5mm] text-red-700">Barcode has characters a label cannot show</div>
      )}
      <div className="mt-[0.8mm] font-mono tracking-wider" style={{ fontSize: `${s.fontSize}pt` }}>
        {copy.barcode}
      </div>
    </div>
  );
}

function Sheet({ copies, skip, settings: s }: { copies: LabelCopy[]; skip: number; settings: Settings }) {
  return (
    <div
      className="label-sheet bg-white"
      style={{
        width: `${PAGE_W}mm`,
        height: `${PAGE_H}mm`,
        padding: `${s.marginTop}mm 0 0 ${s.marginLeft}mm`,
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: `repeat(${s.columns}, ${s.width}mm)`,
        gridAutoRows: `${s.height}mm`,
        gap: `${s.gap}mm`,
        alignContent: "start",
        overflow: "hidden",
      }}
    >
      {Array.from({ length: skip }, (_, i) => (
        <div key={`skip${i}`} />
      ))}
      {copies.map((c) => (
        <Label key={c.id} copy={c} s={s} />
      ))}
    </div>
  );
}

/** Every sheet, shown only when printing (see index.css). */
function PrintSheets({ copies, skip, settings }: { copies: LabelCopy[]; skip: number; settings: Settings }) {
  const { total } = perPage(settings);
  const sheets: LabelCopy[][] = [];
  for (let i = 0, first = total - skip; i < copies.length; first = total) {
    sheets.push(copies.slice(i, i + first));
    i += first;
  }
  return (
    <div className="print-only">
      {sheets.map((page, i) => (
        <Sheet key={i} copies={page} skip={i === 0 ? skip : 0} settings={settings} />
      ))}
    </div>
  );
}
