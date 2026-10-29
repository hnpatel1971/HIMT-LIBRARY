import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { Router, type Request } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireRole } from "../auth.js";
import { audit } from "../audit.js";
import { AppError, badRequest, notFound } from "../errors.js";

const { titleFiles, titles } = schema;

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

/** Files for a title page. The public catalogue only sees public files. */
export async function filesForTitle(titleId: number, includeStaffFiles: boolean) {
  const rows = await db.select(fileFields).from(titleFiles).where(eq(titleFiles.titleId, titleId)).orderBy(asc(titleFiles.id));
  return includeStaffFiles
    ? rows
    : rows.filter((f) => f.access === "public").map((f) => ({ id: f.id, name: f.name, size: f.size, allowDownload: f.allowDownload }));
}

/** A file the current visitor may read, or a 404 (never reveal staff-only files). */
async function readableFile(req: Request) {
  const [f] = await db
    .select({ ...fileFields, storedName: titleFiles.storedName, title: titles.title })
    .from(titleFiles)
    .innerJoin(titles, eq(titleFiles.titleId, titles.id))
    .where(eq(titleFiles.id, Number(req.params.id)));
  if (!f || (f.access !== "public" && !req.user)) throw notFound("File");
  return f;
}

const fileUpdate = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  access: z.enum(["public", "staff"]),
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
