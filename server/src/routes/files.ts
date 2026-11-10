import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { Router, type Request } from "express";
import { and, asc, eq, ilike, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireRole } from "../auth.js";
import { audit } from "../audit.js";
import { AppError, badRequest, notFound } from "../errors.js";

const { titleFiles, titles, members, ebookAccess } = schema;

export const MAX_FILE_MB = 100;

/** Where uploaded e-book files are kept. Outside the app folder on the server. */
export function filesDir() {
  const dir = process.env.FILES_DIR || path.resolve(process.cwd(), "../files");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const fileFields = {
  id: titleFiles.id,
  titleId: titleFiles.titleId,
  name: titleFiles.name,
  size: titleFiles.size,
  access: titleFiles.access,
  allowDownload: titleFiles.allowDownload,
  opens: titleFiles.opens,
  createdAt: titleFiles.createdAt,
};

/** True when this member is active and staff have given them access to the title's e-books. */
export async function memberHasAccess(memberId: number | undefined, titleId: number) {
  if (!memberId) return false;
  const [row] = await db
    .select({ id: ebookAccess.id })
    .from(ebookAccess)
    .innerJoin(members, eq(ebookAccess.memberId, members.id))
    .where(and(eq(ebookAccess.memberId, memberId), eq(ebookAccess.titleId, titleId), eq(members.active, true)))
    .limit(1);
  return !!row;
}

/**
 * Files for a title page. Staff see everything. The public catalogue sees
 * public files, and "granted" files with canRead telling the signed-in member
 * (if any) whether they have been given access. Staff-only files stay hidden.
 */
export async function filesForTitle(titleId: number, includeStaffFiles: boolean, memberId?: number) {
  const rows = await db.select(fileFields).from(titleFiles).where(eq(titleFiles.titleId, titleId)).orderBy(asc(titleFiles.id));
  if (includeStaffFiles) return rows;
  const visible = rows.filter((f) => f.access !== "staff");
  const granted = visible.some((f) => f.access === "granted") && (await memberHasAccess(memberId, titleId));
  return visible.map((f) => ({
    id: f.id,
    name: f.name,
    size: f.size,
    allowDownload: f.allowDownload,
    membersOnly: f.access === "granted",
    canRead: f.access === "public" || granted,
  }));
}

/** A file the current visitor may read, or an error (never reveal staff-only files). */
async function readableFile(req: Request) {
  const [f] = await db
    .select({ ...fileFields, storedName: titleFiles.storedName, title: titles.title })
    .from(titleFiles)
    .innerJoin(titles, eq(titleFiles.titleId, titles.id))
    .where(eq(titleFiles.id, Number(req.params.id)));
  if (!f || (f.access === "staff" && !req.user)) throw notFound("File");
  if (f.access === "granted" && !req.user && !(await memberHasAccess(req.session?.memberId, f.titleId)))
    throw new AppError(
      403,
      req.session?.memberId
        ? "You don't have access to this e-book yet. Ask at the library counter."
        : "This e-book is only for members given access. Open the library from the Employee Portal and go to My library.",
    );
  return f;
}

const fileUpdate = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  access: z.enum(["public", "staff", "granted"]),
  allowDownload: z.boolean(),
});

export const filesRouter = Router();

// The browser sends the PDF itself as the request body, with its name in ?name=.
filesRouter.post(
  "/titles/:id/files",
  requireRole("librarian"),
  express.raw({ type: () => true, limit: `${MAX_FILE_MB}mb` }),
  async (req, res) => {
    const titleId = Number(req.params.id);
    const [t] = await db.select({ id: titles.id }).from(titles).where(eq(titles.id, titleId));
    if (!t) throw notFound("Title");
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.subarray(0, 5).toString("latin1") !== "%PDF-") throw badRequest("Only PDF files can be added");
    const name = (String(req.query.name ?? "").trim() || "E-book").replace(/\.pdf$/i, "").slice(0, 255);
    const storedName = `${crypto.randomUUID()}.pdf`;
    await fs.promises.writeFile(path.join(filesDir(), storedName), body);
    const [{ id }] = await db
      .insert(titleFiles)
      .values({ titleId, name, storedName, size: body.length, uploadedBy: req.user!.id })
      .returning({ id: titleFiles.id });
    await audit(db, req.user!.id, "file.create", { id, titleId, name });
    res.status(201).json({ id });
  },
);

filesRouter.put("/files/:id", requireRole("librarian"), async (req, res) => {
  const data = fileUpdate.parse(req.body);
  const id = Number(req.params.id);
  const result = await db.update(titleFiles).set(data).where(eq(titleFiles.id, id));
  if (!result.rowCount) throw notFound("File");
  await audit(db, req.user!.id, "file.update", { id, ...data });
  res.json({ id });
});

filesRouter.delete("/files/:id", requireRole("librarian"), async (req, res) => {
  const id = Number(req.params.id);
  const [f] = await db.delete(titleFiles).where(eq(titleFiles.id, id)).returning();
  if (!f) throw notFound("File");
  await fs.promises.rm(path.join(filesDir(), f.storedName), { force: true });
  await audit(db, req.user!.id, "file.delete", { id, titleId: f.titleId, name: f.name });
  res.status(204).end();
});

// Reading: details for the viewer, then the PDF itself.
filesRouter.get("/files/:id", async (req, res) => {
  const f = await readableFile(req);
  res.json({ id: f.id, titleId: f.titleId, title: f.title, name: f.name, size: f.size, allowDownload: f.allowDownload || !!req.user });
});

filesRouter.get("/files/:id/content", async (req, res) => {
  const f = await readableFile(req);
  const download = req.query.download === "1";
  // Staff can always download; readers only when the file allows it.
  if (download && !f.allowDownload && !req.user) throw new AppError(403, "This e-book can only be read online");
  const full = path.join(filesDir(), f.storedName);
  if (!fs.existsSync(full)) throw notFound("File");
  if (!download) await db.update(titleFiles).set({ opens: sql`${titleFiles.opens} + 1` }).where(eq(titleFiles.id, f.id));
  const filename = `${f.name.replace(/[^\w .()-]+/g, "_")}.pdf`;
  res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type("application/pdf");
  res.sendFile(full);
});

// Giving members access to e-books (files set to "granted").

/** Titles with e-book files members can be given, for the picker on the member page. */
filesRouter.get("/ebook-titles", requireRole("assistant"), async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const rows = await db
    .selectDistinct({ id: titles.id, title: titles.title })
    .from(titles)
    .innerJoin(titleFiles, eq(titleFiles.titleId, titles.id))
    .where(and(ne(titleFiles.access, "staff"), q ? ilike(titles.title, `%${q.replace(/[%_\\]/g, "\\$&")}%`) : undefined))
    .orderBy(asc(titles.title))
    .limit(30);
  res.json(rows);
});

filesRouter.post("/members/:id/ebooks", requireRole("assistant"), async (req, res) => {
  const memberId = Number(req.params.id);
  const { titleId } = z.object({ titleId: z.number().int() }).parse(req.body);
  const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, memberId));
  if (!m) throw notFound("Member");
  const [f] = await db
    .select({ id: titleFiles.id })
    .from(titleFiles)
    .where(and(eq(titleFiles.titleId, titleId), ne(titleFiles.access, "staff")))
    .limit(1);
  if (!f) throw badRequest("This title has no e-book that members can read");
  await db.insert(ebookAccess).values({ memberId, titleId, grantedBy: req.user!.id }).onConflictDoNothing();
  await audit(db, req.user!.id, "ebook.grant", { memberId, titleId });
  res.status(201).json({ ok: true });
});

filesRouter.delete("/members/:id/ebooks/:titleId", requireRole("assistant"), async (req, res) => {
  const memberId = Number(req.params.id);
  const titleId = Number(req.params.titleId);
  const result = await db.delete(ebookAccess).where(and(eq(ebookAccess.memberId, memberId), eq(ebookAccess.titleId, titleId)));
  if (!result.rowCount) throw notFound("E-book access");
  await audit(db, req.user!.id, "ebook.revoke", { memberId, titleId });
  res.status(204).end();
});
