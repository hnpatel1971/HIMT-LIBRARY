import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api, queryClient, type Me } from "../api";
import { ErrorNote, Field } from "../ui";

export function Login() {
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => api<Me>("/auth/login", { body: { username, password } }),
    onSuccess: (me) => {
      queryClient.setQueryData(["me"], me);
      navigate("/staff");
    },
  });
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-900 p-4">
      <form
        className="card w-full max-w-sm space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <div>
          <h1>Library staff login</h1>
          <p className="text-sm text-slate-500">HIMT College Library</p>
        </div>
        <ErrorNote error={login.error} />
        <Field label="Username">
          <input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Password">
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className="btn-primary w-full" disabled={login.isPending || !username || !password}>
          {login.isPending ? "Logging in…" : "Log in"}
        </button>
        <Link href="/" className="block text-center text-sm text-brand-700 underline">
          Go to the public catalogue
        </Link>
      </form>
    </div>
  );
}
