import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, queryClient, type Lookup, type Me, type MemberType } from "../api";
import { ErrorNote, Field, formatDate, Loading, rupees } from "../ui";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function Settings({ me }: { me: Me }) {
  const admin = me.role === "admin";
  const tabs = [
    ["rules", "Borrowing rules"],
    ["calendar", "Holidays"],
    ["lists", "Shelves & lists"],
    ...(admin ? [["users", "Staff users"] as const, ["log", "Activity log"] as const] : []),
  ] as const;
  const [tab, setTab] = useState<string>("rules");
  return (
    <div className="space-y-4">
      <h1>Settings</h1>
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "rules" && <Rules admin={admin} />}
      {tab === "calendar" && <Calendar admin={admin} />}
      {tab === "lists" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <LookupList path="locations" title="Shelves / racks" />
          <LookupList path="collection-types" title="Collections" />
          <LookupList path="formats" title="Formats" />
        </div>
      )}
      {tab === "users" && admin && <Users me={me} />}
      {tab === "log" && admin && <ActivityLog />}
    </div>
  );
}

function RuleRow({ t, admin }: { t: MemberType; admin: boolean }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(t);
  const save = useMutation({
    mutationFn: () => api(`/member-types/${t.id}`, { method: "PUT", body: f }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member-types"] });
      setEdit(false);
    },
  });
  const num = (k: keyof MemberType) => (e: { target: { value: string } }) => setF({ ...f, [k]: Number(e.target.value) });
  if (!edit) {
    return (
      <tr>
        <td className="font-medium">{t.name}</td>
        <td className="text-right">{t.loanLimit}</td>
        <td className="text-right">{t.loanDays}</td>
        <td className="text-right">{t.renewLimit}</td>
        <td className="text-right">{rupees(t.finePerDay)}</td>
        <td className="text-right">{t.membershipDays}</td>
        <td className="text-right">
          {admin && (
            <button className="text-sm text-brand-700 underline" onClick={() => setEdit(true)}>
              Edit
            </button>
          )}
        </td>
      </tr>
    );
  }
  const box = "input w-20 text-right";
  return (
    <tr>
      <td>
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <ErrorNote error={save.error} />
      </td>
      <td className="text-right">
        <input className={box} type="number" value={f.loanLimit} onChange={num("loanLimit")} />
      </td>
      <td className="text-right">
        <input className={box} type="number" value={f.loanDays} onChange={num("loanDays")} />
      </td>
      <td className="text-right">
        <input className={box} type="number" value={f.renewLimit} onChange={num("renewLimit")} />
      </td>
      <td className="text-right">
        <input className={box} value={f.finePerDay} onChange={(e) => setF({ ...f, finePerDay: e.target.value })} />
      </td>
      <td className="text-right">
        <input className={box} type="number" value={f.membershipDays} onChange={num("membershipDays")} />
      </td>
      <td className="whitespace-nowrap text-right">
        <button className="text-sm text-brand-700 underline" onClick={() => save.mutate()}>
          Save
        </button>
        <button className="ml-2 text-sm underline" onClick={() => (setF(t), setEdit(false))}>
          Cancel
        </button>
      </td>
    </tr>
  );
}

function Rules({ admin }: { admin: boolean }) {
  const { data } = useQuery({ queryKey: ["member-types"], queryFn: () => api<MemberType[]>("/member-types") });
  const add = useMutation({
    mutationFn: () =>
      api("/member-types", {
        body: { name: "New type", loanLimit: 2, loanDays: 7, renewLimit: 1, finePerDay: 0, membershipDays: 365 },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["member-types"] }),
  });
  if (!data) return <Loading />;
  return (
    <div className="card space-y-3 overflow-x-auto">
      <p className="text-sm text-slate-600">How many books each type of member can borrow, for how long, and the fine per late day.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Member type</th>
            <th className="text-right">Books at once</th>
            <th className="text-right">Loan days</th>
            <th className="text-right">Renewals</th>
            <th className="text-right">Fine / day</th>
            <th className="text-right">Membership days</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.map((t) => (
            <RuleRow key={t.id} t={t} admin={admin} />
          ))}
        </tbody>
      </table>
      <ErrorNote error={add.error} />
      {admin && (
        <button className="btn-secondary" onClick={() => add.mutate()}>
          Add a member type
        </button>
      )}
    </div>
  );
}

function Calendar({ admin }: { admin: boolean }) {
  const { data } = useQuery({
    queryKey: ["holidays"],
    queryFn: () => api<{ weeklyOff: number[]; holidays: { id: number; date: string; description: string }[] }>("/holidays"),
  });
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["holidays"] });
  const add = useMutation({
    mutationFn: () => api("/holidays", { body: { date, description } }),
    onSuccess: () => {
      setDate("");
      setDescription("");
      refresh();
    },
  });
  const del = useMutation({ mutationFn: (id: number) => api(`/holidays/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const off = useMutation({ mutationFn: (days: number[]) => api("/weekly-off", { method: "PUT", body: { days } }), onSuccess: refresh });
  if (!data) return <Loading />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3">
        <h2>Holidays</h2>
        <p className="text-sm text-slate-600">Books are never due on a holiday, and holidays are not counted as late days.</p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Name">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} required />
          </Field>
          <button className="btn-primary">Add</button>
        </form>
        <ErrorNote error={add.error} />
        <ul className="divide-y divide-slate-100 text-sm">
          {data.holidays.map((h) => (
            <li key={h.id} className="flex justify-between py-2">
              <span>
                {formatDate(h.date)} · {h.description}
              </span>
              <button className="text-red-700 underline" onClick={() => del.mutate(h.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="card space-y-3">
        <h2>Weekly closed days</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={!admin}
                checked={data.weeklyOff.includes(i)}
                onChange={(e) => off.mutate(e.target.checked ? [...data.weeklyOff, i] : data.weeklyOff.filter((x) => x !== i))}
              />
              {d}
            </label>
          ))}
        </div>
        <ErrorNote error={off.error} />
      </div>
    </div>
  );
}

function LookupList({ path, title }: { path: string; title: string }) {
  const { data } = useQuery({ queryKey: [path], queryFn: () => api<Lookup[]>(`/${path}`) });
  const [name, setName] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: [path] });
  const add = useMutation({
    mutationFn: () => api(`/${path}`, { body: { name } }),
    onSuccess: () => {
      setName("");
      refresh();
    },
  });
  const del = useMutation({ mutationFn: (id: number) => api(`/${path}/${id}`, { method: "DELETE" }), onSuccess: refresh });
  return (
    <div className="card space-y-3">
      <h2>{title}</h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <input className="input" placeholder="Add new…" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="btn-secondary">Add</button>
      </form>
      <ErrorNote error={add.error ?? del.error} />
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
        {data?.map((l) => (
          <li key={l.id} className="flex justify-between py-1.5">
            <span>{l.name}</span>
            <button className="text-xs text-red-700 underline" onClick={() => confirm(`Remove ${l.name}?`) && del.mutate(l.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface StaffUser {
  id: number;
  username: string;
  name: string;
  role: Me["role"];
  active: boolean;
  lastLoginAt: string | null;
}

function UserForm({ user, onDone }: { user?: StaffUser; onDone: () => void }) {
  const [f, setF] = useState({
    username: user?.username ?? "",
    name: user?.name ?? "",
    role: user?.role ?? "assistant",
    active: user?.active ?? true,
    password: "",
  });
  const save = useMutation({
    mutationFn: () =>
      api(user ? `/users/${user.id}` : "/users", { method: user ? "PUT" : "POST", body: { ...f, password: f.password || undefined } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onDone();
    },
  });
  return (
    <form
      className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="sm:col-span-2">
        <ErrorNote error={save.error} />
      </div>
      <Field label="Username">
        <input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
      </Field>
      <Field label="Full name">
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </Field>
      <Field label="Role" hint="Assistant: issue/return and members. Librarian: also catalogue, fines, overrides. Admin: everything.">
        <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Me["role"] })}>
          <option value="assistant">Assistant</option>
          <option value="librarian">Librarian</option>
          <option value="admin">Admin</option>
        </select>
      </Field>
      <Field label={user ? "New password (leave empty to keep)" : "Password"} hint="At least 8 characters">
        <input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required={!user} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        Can log in
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={save.isPending}>
          Save
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Users({ me }: { me: Me }) {
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api<StaffUser[]>("/users") });
  const [editing, setEditing] = useState<number | "new" | null>(null);
  if (!data) return <Loading />;
  return (
    <div className="card space-y-3 overflow-x-auto">
      {editing === null && (
        <button className="btn-secondary" onClick={() => setEditing("new")}>
          Add a staff user
        </button>
      )}
      {editing === "new" && <UserForm onDone={() => setEditing(null)} />}
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Role</th>
            <th>Last login</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.map((u) =>
            editing === u.id ? (
              <tr key={u.id}>
                <td colSpan={5}>
                  <UserForm user={u} onDone={() => setEditing(null)} />
                </td>
              </tr>
            ) : (
              <tr key={u.id} className={u.active ? "" : "text-slate-400"}>
                <td>
                  {u.name}
                  {u.id === me.id && " (you)"}
                  {!u.active && " (disabled)"}
                </td>
                <td className="font-mono">{u.username}</td>
                <td className="capitalize">{u.role}</td>
                <td>{u.lastLoginAt ? formatDate(u.lastLoginAt) : "Never"}</td>
                <td className="text-right">
                  <button className="text-sm text-brand-700 underline" onClick={() => setEditing(u.id)}>
                    Edit
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function ActivityLog() {
  const { data } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<{ id: number; at: string; action: string; details: unknown; user: string | null }[]>("/audit-log"),
  });
  if (!data) return <Loading />;
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{new Date(r.at.replace(" ", "T")).toLocaleString("en-IN")}</td>
              <td>{r.user ?? "—"}</td>
              <td className="font-mono text-xs">{r.action}</td>
              <td className="max-w-md truncate font-mono text-xs text-slate-500">{r.details ? JSON.stringify(r.details) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
