import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { hashPassword, requireRole } from "../auth.js";
import { audit } from "../audit.js";
import { badRequest, notFound } from "../errors.js";

const { locations, collectionTypes, formats, memberTypes, holidays, users, settings, auditLog } = schema;

export const adminRouter = Router();

// Simple name-only lookup lists. Anyone signed in can read them (forms need
// them); librarians maintain them.
const lookups = { locations, "collection-types": collectionTypes, formats } as const;
const nameInput = z.object({ name: z.string().trim().min(1, "Name is required") });

for (const [path, table] of Object.entries(lookups)) {
  adminRouter.get(`/${path}`, requireRole("assistant"), async (_req, res) => {
    res.json(await db.select().from(table).orderBy(asc(table.name)));
  });
  adminRouter.post(`/${path}`, requireRole("librarian"), async (req, res) => {
    const { name } = nameInput.parse(req.body);
    const [{ id }] = await db.insert(table).values({ name }).returning({ id: table.id });
    res.status(201).json({ id, name });
  });
  adminRouter.put(`/${path}/:id`, requireRole("librarian"), async (req, res) => {
    const { name } = nameInput.parse(req.body);
    await db.update(table).set({ name }).where(eq(table.id, Number(req.params.id)));
    res.json({ id: Number(req.params.id), name });
  });
  adminRouter.delete(`/${path}/:id`, requireRole("librarian"), async (req, res) => {
    try {
      await db.delete(table).where(eq(table.id, Number(req.params.id)));
    } catch {
      throw badRequest("This entry is still used by copies or titles");
    }
    res.status(204).end();
  });
}

const memberTypeInput = z.object({
  name: z.string().trim().min(1),
  loanLimit: z.number().int().min(0),
  loanDays: z.number().int().min(1),
  renewLimit: z.number().int().min(0),
  finePerDay: z.coerce.number().min(0).transform((v) => v.toFixed(2)),
  reserveLimit: z.number().int().min(0).default(0),
  membershipDays: z.number().int().min(1).default(365),
});

adminRouter.get("/member-types", requireRole("assistant"), async (_req, res) => {
  res.json(await db.select().from(memberTypes).orderBy(asc(memberTypes.name)));
});
adminRouter.post("/member-types", requireRole("admin"), async (req, res) => {
  const data = memberTypeInput.parse(req.body);
  const [{ id }] = await db.insert(memberTypes).values(data).returning({ id: memberTypes.id });
  await audit(db, req.user!.id, "member_type.create", { id, ...data });
  res.status(201).json({ id });
});
adminRouter.put("/member-types/:id", requireRole("admin"), async (req, res) => {
  const data = memberTypeInput.parse(req.body);
  const id = Number(req.params.id);
  await db.update(memberTypes).set(data).where(eq(memberTypes.id, id));
  await audit(db, req.user!.id, "member_type.update", { id, ...data });
  res.json({ id });
});

const holidayInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-25"),
  description: z.string().trim().min(1),
});

adminRouter.get("/holidays", requireRole("assistant"), async (_req, res) => {
  const [off] = await db.select().from(settings).where(eq(settings.key, "weekly_off"));
  res.json({ weeklyOff: off?.value ?? [0], holidays: await db.select().from(holidays).orderBy(asc(holidays.date)) });
});
adminRouter.post("/holidays", requireRole("librarian"), async (req, res) => {
  const data = holidayInput.parse(req.body);
  const [{ id }] = await db.insert(holidays).values(data).returning({ id: holidays.id });
  res.status(201).json({ id });
});
adminRouter.delete("/holidays/:id", requireRole("librarian"), async (req, res) => {
  await db.delete(holidays).where(eq(holidays.id, Number(req.params.id)));
  res.status(204).end();
});
adminRouter.put("/weekly-off", requireRole("admin"), async (req, res) => {
  const days = z.array(z.number().int().min(0).max(6)).parse(req.body.days);
  await db
    .insert(settings)
    .values({ key: "weekly_off", value: days })
    .onConflictDoUpdate({ target: settings.key, set: { value: days } });
  res.json({ weeklyOff: days });
});

const userInput = z.object({
  username: z.string().trim().min(3),
  name: z.string().trim().min(1),
  role: z.enum(["admin", "librarian", "assistant"]),
  active: z.boolean().default(true),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
});

adminRouter.get("/users", requireRole("admin"), async (_req, res) => {
  res.json(
    await db
      .select({ id: users.id, username: users.username, name: users.name, role: users.role, active: users.active, lastLoginAt: users.lastLoginAt })
      .from(users)
      .orderBy(asc(users.name)),
  );
});
adminRouter.post("/users", requireRole("admin"), async (req, res) => {
  const data = userInput.parse(req.body);
  if (!data.password) throw badRequest("Password is required");
  const [{ id }] = await db
    .insert(users)
    .values({ ...data, passwordHash: await hashPassword(data.password) })
    .returning({ id: users.id });
  await audit(db, req.user!.id, "user.create", { id, username: data.username, role: data.role });
  res.status(201).json({ id });
});
adminRouter.put("/users/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const { password, ...data } = userInput.parse(req.body);
  if (id === req.user!.id && (!data.active || data.role !== "admin")) {
    throw badRequest("You can't remove your own admin access");
  }
  const result = await db
    .update(users)
    .set({ ...data, ...(password ? { passwordHash: await hashPassword(password) } : {}) })
    .where(eq(users.id, id));
  if (!result.rowCount) throw notFound("User");
  await audit(db, req.user!.id, "user.update", { id, role: data.role, active: data.active, passwordChanged: !!password });
  res.json({ id });
});

adminRouter.get("/audit-log", requireRole("admin"), async (_req, res) => {
  res.json(
    await db
      .select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, details: auditLog.details, user: users.name })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .orderBy(sql`${auditLog.id} DESC`)
      .limit(300),
  );
});
