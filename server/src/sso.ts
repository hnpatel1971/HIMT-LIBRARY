import crypto from "node:crypto";
import express, { type Request } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/index.js";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";

/*
  Single sign-on from the HIMT Employee Portal.

  1. The portal's server calls POST /api/sso/ticket with the shared key in the
     X-SSO-Key header and the employee's library username in the body.
  2. The library answers with a one-time login URL that works for 60 seconds.
  3. The portal sends the employee's browser to that URL. The library signs
     them in and opens the staff pages, without asking for a password.

  The key never reaches the browser, and a ticket works only once.
  SSO is off until SSO_API_KEY is set in the library's settings file.
*/

const TICKET_TTL_MS = 60_000;
const tickets = new Map<string, { userId: number; next: string; expires: number }>();

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
      username: z.string().trim().min(1, "username is required").max(64),
      next: z.string().max(200).optional(),
    })
    .parse(req.body);
  const [u] = await db
    .select({ id: schema.users.id, active: schema.users.active })
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.username})`, body.username.toLowerCase()));
  if (!u) throw new AppError(404, "No library staff account has this username");
  if (!u.active) throw new AppError(403, "This library staff account is switched off");

  sweep();
  const ticket = crypto.randomBytes(32).toString("base64url");
  const expires = Date.now() + TICKET_TTL_MS;
  tickets.set(ticket, { userId: u.id, next: safeNext(body.next), expires });
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

  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, t.userId));
  if (!u?.active) return fail("inactive");

  await new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
  req.session.userId = u.id;
  await new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
  await audit(db, u.id, "auth.sso_login", { ip: req.ip });
  res.redirect(303, t.next);
});

/** For tests only. */
export const _ssoTickets = tickets;
