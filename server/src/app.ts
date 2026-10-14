import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import { eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { db, pool, schema } from "./db/index.js";
import { checkPassword, loadUser } from "./auth.js";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";
import { catalogueRouter } from "./routes/catalogue.js";
import { membersRouter } from "./routes/members.js";
import { circulationRouter } from "./routes/circulation.js";
import { adminRouter } from "./routes/admin.js";
import { opacRouter, reportsRouter } from "./routes/reports.js";

// Small in-memory brake on password guessing: 10 failures per IP per 15 minutes.
const failures = new Map<string, { n: number; until: number }>();
function tooManyFailures(ip: string) {
  const f = failures.get(ip);
  return !!f && f.n >= 10 && f.until > Date.now();
}
function noteFailure(ip: string) {
  const f = failures.get(ip);
  const fresh = !f || f.until < Date.now();
  failures.set(ip, { n: fresh ? 1 : f!.n + 1, until: Date.now() + 15 * 60_000 });
}

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));

  const MySQLStore = MySQLStoreFactory(session as never);
  app.use(
    session({
      name: "himt_lib_sid",
      secret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: process.env.NODE_ENV === "test" ? undefined : new MySQLStore({ createDatabaseTable: true }, pool as never),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.COOKIE_SECURE === "true",
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
  app.use(loadUser);

  const api = express.Router();
  api.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  api.post("/auth/login", async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (tooManyFailures(ip)) throw new AppError(429, "Too many failed attempts. Try again in 15 minutes");
    const { username, password } = z.object({ username: z.string().trim(), password: z.string() }).parse(req.body);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.username, username));
    if (!u || !u.active || !(await checkPassword(password, u.passwordHash))) {
      noteFailure(ip);
      await audit(db, null, "auth.failed", { username, ip });
      throw new AppError(401, "Wrong username or password");
    }
    failures.delete(ip);
    await new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    req.session.userId = u.id;
    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
    await audit(db, u.id, "auth.login", { ip });
    res.json({ id: u.id, username: u.username, name: u.name, role: u.role });
  });

  api.post("/auth/logout", (req, res) => {
    req.session.destroy(() => res.status(204).end());
  });

  api.get("/auth/me", (req, res) => {
    if (!req.user) throw new AppError(401, "Not signed in");
    res.json(req.user);
  });

  api.use(opacRouter, catalogueRouter, membersRouter, circulationRouter, adminRouter, reportsRouter);
  api.use((_req, _res, next) => next(new AppError(404, "Not found")));
  app.use("/api", api);

  // The built web app, with client-side routing.
  const web = process.env.WEB_DIST_DIR || path.resolve(process.cwd(), "../web/dist");
  if (fs.existsSync(web)) {
    app.use(express.static(web, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(web, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, overridable: err.overridable || undefined });
    } else if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues.map((i) => i.message).join("; ") });
    } else if ((err as { code?: string })?.code === "ER_DUP_ENTRY") {
      res.status(400).json({ error: "That value is already used" });
    } else {
      console.error(err);
      res.status(500).json({ error: "Something went wrong. Please try again" });
    }
  });
  return app;
}
