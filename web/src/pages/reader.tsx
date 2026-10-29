import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, type FileInfo } from "../api";
import { ErrorNote, Loading } from "../ui";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** One page, drawn only once it scrolls near the screen. */
function Page({ doc, n, width }: { doc: PDFDocumentProxy; n: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(n <= 2);
  const [ratio, setRatio] = useState(1.414);
  useEffect(() => {
    const el = canvas.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setVisible(true), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible || !canvas.current || !width) return;
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    doc.getPage(n).then((page) => {
      if (cancelled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const c = canvas.current;
      c.width = viewport.width;
      c.height = viewport.height;
      task = page.render({ canvasContext: c.getContext("2d")!, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, width, visible]);
  return (
    <canvas
      ref={canvas}
      className="mx-auto block bg-white shadow"
      style={{ width, height: width * ratio }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

export function Reader({ id }: { id: number }) {
  const info = useQuery({ queryKey: ["file", id], queryFn: () => api<FileInfo>(`/files/${id}`) });
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [zoom, setZoom] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);

  useEffect(() => {
    if (!info.data) return;
    // One request for the whole file, so each reading counts once.
    const task = pdfjs.getDocument({ url: `/api/files/${id}/content`, withCredentials: true, disableRange: true, disableStream: true });
    task.promise.then(setDoc, setLoadError);
    return () => {
      task.destroy();
    };
  }, [id, info.data]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Block the browser's save and print shortcuts while reading.
  useEffect(() => {
    if (info.data?.allowDownload) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ["s", "p"].includes(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [info.data?.allowDownload]);

  const width = Math.min(boxWidth - 16, 900) * zoom;
  return (
    <div className="flex h-screen flex-col bg-slate-200 print:hidden">
      <header className="flex flex-wrap items-center gap-3 bg-brand-900 px-4 py-2 text-white">
        <button className="text-sm text-brand-100 underline" onClick={() => history.back()}>
          ← Back
        </button>
        <div className="min-w-0 flex-1 truncate font-medium">{info.data?.name ?? "E-book"}</div>
        {doc && <span className="text-sm text-brand-100">{doc.numPages} pages</span>}
        <div className="flex gap-1">
          <button className="btn-secondary px-2 py-1" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out">
            −
          </button>
          <button className="btn-secondary px-2 py-1" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label="Zoom in">
            +
          </button>
        </div>
        {info.data?.allowDownload && (
          <a className="btn-secondary px-3 py-1" href={`/api/files/${id}/content?download=1`}>
            Download
          </a>
        )}
      </header>
      <div ref={box} className="flex-1 overflow-auto py-4">
        <div className="mx-auto max-w-3xl px-4">
          <ErrorNote error={info.error ?? loadError} />
        </div>
        {!doc && !info.error && !loadError ? (
          <Loading />
        ) : (
          doc &&
          width > 0 && (
            <div className="space-y-4" style={{ minWidth: width }}>
              {Array.from({ length: doc.numPages }, (_, i) => (
                <Page key={i} doc={doc} n={i + 1} width={width} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
