import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { AppError } from "./errors.js";

export type Role = "admin" | "librarian" | "assistant";
const rank: Record<Role, number> = { assistant: 1, librarian: 2, admin: 3 };

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

export interface StaffUser {
  id: number;
  username: string;
  name: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: StaffUser;
    }
  }
}

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

/** Accepts bcrypt hashes from PHP ($2y$) as well as our own ($2a$/$2b$). */
export function checkPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash.replace(/^\$2y\$/, "$2a$"));
}

export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const id = req.session?.userId;
  if (id) {
    const [u] = await db
      .select({ id: schema.users.id, username: schema.users.username, name: schema.users.name, role: schema.users.role, active: schema.users.active })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    if (u?.active) req.user = { id: u.id, username: u.username, name: u.name, role: u.role };
  }
  next();
}

export function requireRole(min: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(401, "Please log in"));
    if (rank[req.user.role] < rank[min]) return next(new AppError(403, "You don't have permission to do this"));
    next();
  };
}

export const canOverride = (u?: StaffUser) => !!u && rank[u.role] >= rank.librarian;
