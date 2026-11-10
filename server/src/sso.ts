import crypto from "node:crypto";
import express, { type Request } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/index.js";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";
import { sameCode } from "./codes.js";
import { memberDetail } from "./routes/members.js";

/*
  Single sign-on from the HIMT Employee Portal.

  1. The portal's server calls POST /api/sso/ticket with the shared key in the
     X-SSO-Key header and the employee's HIMT employee ID in the body.
  2. The library answers with a one-time login URL that works for 60 seconds.
  3. The portal sends the employee's browser to that URL. The library signs
     them in without asking for a password. Library staff land on the staff
     pages; other employees land on their own "My library" page (/my).

  The key never reaches the browser, and a ticket works only once.
  SSO is off until SSO_API_KEY is set in the library's settings file.
*/

const TICKET_TTL_MS = 60_000;
type Who = { kind: "staff"; userId: number } | { kind: "member"; memberId: number };
const tickets = new Map<string, { who: Who; next: string; expires: number }>();

function sweep() {
  const now = Date.now();
  for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k);
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest();

/** Constant-time comparison of the presented key with SSO_API_KEY. */
function keyMatches(presented: string | undefined) {
  const expected = process.env.SSO_API_KEY;
  if (!expected || !presented) return false;
  return crypto.timingSafeEqual(sha256(presented), sha256(expected));
}

function allowedCaller(req: Request) {
  const list = (process.env.SSO_ALLOWED_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return true;
  const ip = (req.ip ?? "").replace(/^::ffff:/, "");
  return list.includes(ip);
}

/** Only paths inside the staff area, so the ticket link can't be used as an open redirect. */
function safeNext(next: string | undefined) {
  if (next && /^\/staff(\/[A-Za-z0-9/_\-?=&.%]*)?$/.test(next) && !next.startsWith("//")) return next;
  return "/staff";
}

function publicBase(req: Request) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

export const ssoRouter = express.Router();

ssoRouter.post("/sso/ticket", async (req, res) => {
  if (!process.env.SSO_API_KEY) throw new AppError(404, "Single sign-on is not turned on");
  if (!allowedCaller(req) || !keyMatches(req.get("x-sso-key"))) {
    await audit(db, null, "auth.sso_rejected", { ip: req.ip, reason: "bad key or caller" });
    throw new AppError(401, "Invalid SSO key");
  }
  const body = z
    .object({
      employeeId: z.string().trim().max(32).optional(),
      username: z.string().trim().max(64).optional(),
      memberCode: z.string().trim().max(32).optional(),
      email: z.string().trim().max(128).optional(),
      next: z.string().max(200).optional(),
    })
    .refine((b) => b.employeeId || b.username || b.memberCode || b.email, "Send employeeId")
    .parse(req.body);

  let who: Who | undefined;
  let blocked: string | undefined;
  // Library staff first: they get the staff pages. Matched by the Employee ID
  // set on the staff user in Settings > Staff users (or, failing that, username).
  const u0 = schema.users;
  const staff = body.employeeId
    ? await db.select({ id: u0.id, active: u0.active }).from(u0).where(sameCode(u0.employeeId, body.employeeId))
    : [];
  if (!staff.length && body.username)
    staff.push(...(await db.select({ id: u0.id, active: u0.active }).from(u0).where(sameCode(u0.username, body.username))));
  if (staff[0]?.active) who = { kind: "staff", userId: staff[0].id };
  else if (staff[0]) blocked = "This library staff account is switched off";

  // Everyone else: their library membership. The library Member ID is the
  // employee ID for faculty and staff; email is a fallback.
  if (!who && !blocked) {
    const m = schema.members;
    const code = body.employeeId || body.memberCode;
    let rows: { id: number; active: boolean }[] = [];
    if (code) rows = await db.select({ id: m.id, active: m.active }).from(m).where(sameCode(m.code, code));
    if (!rows.length && body.email)
      rows = await db.select({ id: m.id, active: m.active }).from(m).where(sql`lower(${m.email}) = lower(${body.email})`);
    if (rows.length > 1) throw new AppError(409, "More than one library member has this email. Send memberCode instead");
    if (rows[0]?.active) who = { kind: "member", memberId: rows[0].id };
    else if (rows[0]) blocked = "This library membership is switched off";
  }
  if (!who) throw new AppError(blocked ? 403 : 404, blocked ?? "No library account matches this employee");

  sweep();
  const ticket = crypto.randomBytes(32).toString("base64url");
  const expires = Date.now() + TICKET_TTL_MS;
  tickets.set(ticket, { who, next: who.kind === "staff" ? safeNext(body.next) : "/my", expires });
  res.json({
    loginUrl: `${publicBase(req)}/api/sso/login?ticket=${ticket}`,
    expiresAt: new Date(expires).toISOString(),
  });
});

ssoRouter.get("/sso/login", async (req, res) => {
  const ticket = typeof req.query.ticket === "string" ? req.query.ticket : "";
  const t = tickets.get(ticket);
  tickets.delete(ticket);
  const fail = (code: string) => res.redirect(303, `/staff/login?sso=${code}`);
  if (!t || t.expires < Date.now()) return fail("expired");

  const regenerate = () => new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
  const save = () => new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
  if (t.who.kind === "staff") {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, t.who.userId));
    if (!u?.active) return fail("inactive");
    await regenerate();
    req.session.userId = u.id;
    await save();
    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
    await audit(db, u.id, "auth.sso_login", { ip: req.ip });
  } else {
    const [m] = await db.select().from(schema.members).where(eq(schema.members.id, t.who.memberId));
    if (!m?.active) return fail("inactive");
    await regenerate();
    req.session.memberId = m.id;
    await save();
    await audit(db, null, "auth.sso_member_login", { memberId: m.id, code: m.code, ip: req.ip });
  }
  res.redirect(303, t.next);
});

/** The signed-in member's own record: loans, due dates, fines. */
ssoRouter.get("/my", async (req, res) => {
  const id = req.session?.memberId;
  if (!id) throw new AppError(401, "Not signed in");
  const m = await memberDetail(eq(schema.members.id, id));
  if (!m || !m.active) throw new AppError(401, "Not signed in");
  const { notes: _notes, address: _address, phone: _phone, email: _email, ...mine } = m;
  res.json({ ...mine, history: mine.history.slice(0, 50) });
});

/** For tests only. */
export const _ssoTickets = tickets;
