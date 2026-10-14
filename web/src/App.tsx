import type { ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Redirect, Route, Switch, useLocation } from "wouter";
import { api, ApiError, queryClient, type Me } from "./api";
import { Loading } from "./ui";
import { OpacHome, OpacTitle } from "./pages/opac";
import { Login } from "./pages/login";
import { Dashboard } from "./pages/dashboard";
import { Circulation } from "./pages/circulation";
import { CatalogueList, TitleEditor, TitlePage } from "./pages/catalogue";
import { MemberEditor, MemberList, MemberPage } from "./pages/members";
import { Reports } from "./pages/reports";
import { Settings } from "./pages/settings";
import { VisitorCheckIn } from "./pages/visits";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<Me>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export const isLibrarian = (me?: Me | null) => me?.role === "librarian" || me?.role === "admin";

const nav: { href: string; label: string; min?: "librarian" | "admin" }[] = [
  { href: "/staff", label: "Dashboard" },
  { href: "/staff/circulation", label: "Issue & return" },
  { href: "/staff/catalogue", label: "Catalogue" },
  { href: "/staff/members", label: "Members" },
  { href: "/staff/reports", label: "Reports" },
  { href: "/staff/visits", label: "Visitor check-in" },
  { href: "/staff/settings", label: "Settings", min: "librarian" },
];

function StaffLayout({ me, children }: { me: Me; children: ReactNode }) {
  const [location, navigate] = useLocation();
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      navigate("/staff/login");
    },
  });
  const active = (href: string) => (href === "/staff" ? location === "/staff" : location.startsWith(href));
  return (
    <div className="min-h-screen md:flex">
      <aside className="bg-brand-900 text-brand-100 md:min-h-screen md:w-56 md:shrink-0">
        <div className="px-5 py-4">
          <div className="text-sm font-semibold text-white">HIMT College Library</div>
          <div className="text-xs text-brand-100/70">Staff</div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {nav
            .filter((n) => !n.min || (n.min === "librarian" ? isLibrarian(me) : me.role === "admin"))
            .map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${
                  active(n.href) ? "bg-white/15 font-medium text-white" : "hover:bg-white/10"
                }`}
              >
                {n.label}
              </Link>
            ))}
        </nav>
        <div className="hidden border-t border-white/10 px-5 py-4 text-xs md:block">
          <div className="text-white">{me.name}</div>
          <div className="capitalize text-brand-100/70">{me.role}</div>
          <div className="mt-3 flex gap-3">
            <Link href="/" className="underline">
              Public catalogue
            </Link>
            <button className="underline" onClick={() => logout.mutate()}>
              Log out
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}

function Staff() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <Loading />;
  if (!me) return <Redirect to="/staff/login" />;
  return (
    <StaffLayout me={me}>
      <Switch>
        <Route path="/staff">
          <Dashboard />
        </Route>
        <Route path="/staff/circulation">
          <Circulation me={me} />
        </Route>
        <Route path="/staff/catalogue">
          <CatalogueList me={me} />
        </Route>
        <Route path="/staff/catalogue/new">
          <TitleEditor />
        </Route>
        <Route path="/staff/catalogue/:id/edit">{(p) => <TitleEditor id={Number(p.id)} />}</Route>
        <Route path="/staff/catalogue/:id">{(p) => <TitlePage id={Number(p.id)} me={me} />}</Route>
        <Route path="/staff/members">
          <MemberList />
        </Route>
        <Route path="/staff/members/new">
          <MemberEditor />
        </Route>
        <Route path="/staff/members/:id/edit">{(p) => <MemberEditor id={Number(p.id)} />}</Route>
        <Route path="/staff/members/:id">{(p) => <MemberPage id={Number(p.id)} me={me} />}</Route>
        <Route path="/staff/reports">
          <Reports />
        </Route>
        <Route path="/staff/visits">
          <VisitorCheckIn />
        </Route>
        <Route path="/staff/settings">
          <Settings me={me} />
        </Route>
        <Route>
          <p>Page not found.</p>
        </Route>
      </Switch>
    </StaffLayout>
  );
}

export function App() {
  return (
    <Switch>
      <Route path="/">
        <OpacHome />
      </Route>
      <Route path="/title/:id">{(p) => <OpacTitle id={Number(p.id)} />}</Route>
      <Route path="/staff/login">
        <Login />
      </Route>
      <Route path="/staff">
        <Staff />
      </Route>
      <Route path="/staff/*">
        <Staff />
      </Route>
      <Route>
        <Redirect to="/" />
      </Route>
    </Switch>
  );
}
