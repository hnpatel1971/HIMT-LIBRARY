import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, queryClient } from "../api";
import { ErrorNote, Notice } from "../ui";

export function VisitorCheckIn() {
  const [code, setCode] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const checkIn = useMutation({
    mutationFn: () => api<{ name: string }>("/visits", { body: { memberCode: code } }),
    onSuccess: (r) => {
      setLog((x) => [`${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · ${r.name}`, ...x].slice(0, 20));
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1>Visitor check-in</h1>
      <p className="text-sm text-slate-600">Leave this page open at the library entrance. Members scan their ID card to record a visit.</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) checkIn.mutate();
        }}
      >
        <input
          className="input py-3 text-lg"
          autoFocus
          placeholder="Scan member ID card"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            checkIn.reset();
          }}
        />
        <button className="btn-primary">Check in</button>
      </form>
      <ErrorNote error={checkIn.error} />
      {log[0] && <Notice>Welcome, {log[0].split(" · ")[1]}!</Notice>}
      {log.length > 1 && (
        <ul className="text-sm text-slate-600">
          {log.slice(1).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
