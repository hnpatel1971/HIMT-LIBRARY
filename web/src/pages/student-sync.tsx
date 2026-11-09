import { Fragment, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, queryClient, type Me } from "../api";
import { ErrorNote, formatDate, Loading, Notice } from "../ui";

interface SyncStatus {
  running: boolean;
  syncHour: number;
  courses: { id: number; code: string; name: string; batches: number; running: number; members: number }[];
  runs: {
    id: number;
    kind: "daily" | "full";
    status: "running" | "ok" | "partial" | "failed";
    startedAt: string;
    finishedAt: string | null;
    startedBy: string | null;
    batches: number;
    added: number;
    updated: number;
    unchanged: number;
    skipped: number;
    errors: string[];
  }[];
}
interface BatchRow {
  id: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  students: number;
  members: number;
  syncedAt: string | null;
}

const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const STATUS: Record<string, string> = { running: "Running…", ok: "Done", partial: "Done with errors", failed: "Failed" };
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** Settings > Student sync: students come from the central HIMT server. */
export function StudentSync({ me }: { me: Me }) {
  const canRun = me.role !== "assistant";
  const { data, error } = useQuery({
    queryKey: ["student-sync"],
    queryFn: () => api<SyncStatus>("/student-sync"),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const run = useMutation({
    mutationFn: (full: boolean) => api("/student-sync/run", { body: { full } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["student-sync"] }),
  });
  const [course, setCourse] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const last = data.runs[0];

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <p className="text-sm text-slate-600">
          Every night at {hourLabel(data.syncHour)} students are brought in from the central HIMT server: new students become members,
          and existing ones get their name, course, batch and expiry date updated. Each night covers batches that are running or ended in
          the last 60 days; on Sundays every batch is read. A student's membership runs until their batch ends, and no one is ever
          deleted. Members &gt; Add a member also fills itself from the central records.
        </p>
        {data.running ? (
          <Notice tone="blue">A sync is running. This page updates by itself.</Notice>
        ) : last ? (
          <p className="text-sm">
            Last sync: <b>{when(last.finishedAt ?? last.startedAt)}</b>, {STATUS[last.status].toLowerCase()}. {last.added} added, {last.updated} updated.
          </p>
        ) : (
          <p className="text-sm">No sync has run yet. The first one reads every batch.</p>
        )}
        {canRun && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={data.running || run.isPending} onClick={() => run.mutate(false)}>
              Sync now
            </button>
            <button className="btn-secondary" disabled={data.running || run.isPending} onClick={() => run.mutate(true)}>
              Sync all batches
            </button>
          </div>
        )}
        <ErrorNote error={run.error} />
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-2">Courses</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Course</th>
              <th className="text-right">Batches</th>
              <th className="text-right">Running now</th>
              <th className="text-right">Members</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.courses.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td className="text-right">{c.batches}</td>
                <td className="text-right">{c.running}</td>
                <td className="text-right">{c.members}</td>
                <td className="text-right">
                  <button className="text-sm text-brand-700 underline" onClick={() => setCourse(course === c.id ? null : c.id)}>
                    {course === c.id ? "Hide batches" : "Batches"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {course && <Batches courseId={course} name={data.courses.find((c) => c.id === course)?.name ?? ""} />}
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-2">Sync history</h2>
        {data.runs.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Kind</th>
                <th>By</th>
                <th>Result</th>
                <th className="text-right">Batches</th>
                <th className="text-right">Added</th>
                <th className="text-right">Updated</th>
                <th className="text-right">Unchanged</th>
                <th className="text-right">Skipped</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td className="whitespace-nowrap">{when(r.startedAt)}</td>
                    <td>{r.kind === "full" ? "All batches" : "Recent batches"}</td>
                    <td>{r.startedBy ?? "Nightly"}</td>
                    <td className={r.status === "failed" ? "text-red-700" : r.status === "partial" ? "text-amber-700" : ""}>
                      {STATUS[r.status]}
                      {r.errors.length > 0 && (
                        <button className="ml-2 text-sm underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                          {r.errors.length} {r.errors.length === 1 ? "problem" : "problems"}
                        </button>
                      )}
                    </td>
                    <td className="text-right">{r.batches}</td>
                    <td className="text-right">{r.added}</td>
                    <td className="text-right">{r.updated}</td>
                    <td className="text-right">{r.unchanged}</td>
                    <td className="text-right">{r.skipped}</td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={9}>
                        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
                          {r.errors.map((e, i) => (
                            <li key={i} className="break-all">
                              {e}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Batches({ courseId, name }: { courseId: number; name: string }) {
  const { data } = useQuery({
    queryKey: ["student-sync", "batches", courseId],
    queryFn: () => api<BatchRow[]>(`/student-sync/courses/${courseId}/batches`),
  });
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <Loading />;
  return (
    <div className="mt-4 space-y-2">
      <h3 className="font-medium">{name} batches</h3>
      {data.length === 0 ? (
        <p className="text-sm text-slate-600">No batches yet. Press Sync now to bring them in.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Starts</th>
              <th>Ends</th>
              <th className="text-right">Students</th>
              <th className="text-right">Members</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((b) => (
              <Fragment key={b.id}>
                <tr>
                  <td>
                    {b.name} <span className="text-xs text-slate-500">{b.id}</span>
                  </td>
                  <td className="whitespace-nowrap">{formatDate(b.startsOn)}</td>
                  <td className="whitespace-nowrap">{formatDate(b.endsOn)}</td>
                  <td className="text-right">{b.students}</td>
                  <td className="text-right">{b.members}</td>
                  <td className="text-right">
                    <button className="text-sm text-brand-700 underline" onClick={() => setOpen(open === b.id ? null : b.id)}>
                      {open === b.id ? "Hide" : "Members"}
                    </button>
                  </td>
                </tr>
                {open === b.id && (
                  <tr>
                    <td colSpan={6}>
                      <BatchStudents batchId={b.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BatchStudents({ batchId }: { batchId: string }) {
  const { data } = useQuery({
    queryKey: ["student-sync", "members", batchId],
    queryFn: () => api<{ id: number; code: string; name: string; expiresOn: string | null; active: boolean }[]>(`/student-sync/batches/${batchId}/members`),
  });
  if (!data) return <Loading />;
  return (
    <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {data.map((m) => (
        <li key={m.id}>
          <span className="font-mono text-xs text-slate-500">{m.code}</span> {m.name}
        </li>
      ))}
    </ul>
  );
}
