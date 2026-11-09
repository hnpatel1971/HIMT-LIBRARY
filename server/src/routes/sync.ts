import { Router } from "express";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireRole } from "../auth.js";
import { audit } from "../audit.js";
import { AppError } from "../errors.js";
import { centralApi, isSyncRunning, saveBatches, startSync, SYNC_HOUR, tidy } from "../studentSync.js";

const { courses, batches, members, syncRuns, users } = schema;

export const syncRouter = Router();

/** Courses with batch and member counts, recent runs, and whether a run is going. */
syncRouter.get("/student-sync", requireRole("assistant"), async (_req, res) => {
  const courseRows = await db
    .select({
      id: courses.id,
      code: courses.code,
      name: courses.name,
      batches: sql<number>`(SELECT count(*) FROM batches b WHERE b.course_id = "courses"."id")`,
      running: sql<number>`(SELECT count(*) FROM batches b WHERE b.course_id = "courses"."id" AND (b.ends_on IS NULL OR b.ends_on >= current_date))`,
      members: sql<number>`(SELECT count(*) FROM members m JOIN batches b ON b.id = m.batch_id WHERE b.course_id = "courses"."id")`,
    })
    .from(courses)
    .orderBy(asc(courses.id));
  const runs = await db
    .select({
      id: syncRuns.id,
      kind: syncRuns.kind,
      status: syncRuns.status,
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
      startedBy: users.name,
      batches: syncRuns.batches,
      updated: syncRuns.updated,
      unchanged: syncRuns.unchanged,
      skipped: syncRuns.skipped,
      errors: syncRuns.errors,
    })
    .from(syncRuns)
    .leftJoin(users, eq(syncRuns.startedBy, users.id))
    .orderBy(desc(syncRuns.id))
    .limit(30);
  res.json({
    running: isSyncRunning(),
    syncHour: SYNC_HOUR,
    courses: courseRows.map((c) => ({ ...c, batches: Number(c.batches), running: Number(c.running), members: Number(c.members) })),
    runs,
  });
});

syncRouter.get("/student-sync/courses/:id/batches", requireRole("assistant"), async (req, res) => {
  res.json(
    await db
      .select({
        id: batches.id,
        name: batches.name,
        startsOn: batches.startsOn,
        endsOn: batches.endsOn,
        students: batches.students,
        members: sql<number>`(SELECT count(*) FROM members m WHERE m.batch_id = "batches"."id")`.mapWith(Number),
        syncedAt: batches.syncedAt,
      })
      .from(batches)
      .where(eq(batches.courseId, Number(req.params.id)))
      .orderBy(desc(batches.startsOn), asc(batches.name)),
  );
});

/** Sync now. Answers straight away; the page polls for the result. */
syncRouter.post("/student-sync/run", requireRole("librarian"), async (req, res) => {
  const { full } = z.object({ full: z.boolean().default(false) }).parse(req.body ?? {});
  const run = startSync({ full, userId: req.user!.id });
  if (!run) throw new AppError(409, "A sync is already running");
  run.catch((e) => console.error("Student sync", e));
  await audit(db, req.user!.id, "student_sync.start", { full });
  res.status(202).json({ started: true });
});

/** Members of one batch, for the batch list in Settings. */
syncRouter.get("/student-sync/batches/:id/members", requireRole("assistant"), async (req, res) => {
  res.json(
    await db
      .select({ id: members.id, code: members.code, name: members.name, expiresOn: members.expiresOn, active: members.active })
      .from(members)
      .where(eq(members.batchId, String(req.params.id)))
      .orderBy(asc(members.name)),
  );
});

// Live lookups for the Add a member form: pick course, batch, then student.

const central = async <T>(what: string, f: () => Promise<T>) => {
  try {
    return await f();
  } catch (e) {
    console.error(`Central server (${what})`, e);
    throw new AppError(502, "The central HIMT server did not answer. Try again, or fill the form by hand");
  }
};

syncRouter.get("/central/courses", requireRole("assistant"), async (_req, res) => {
  res.json(await db.select({ id: courses.id, name: courses.name }).from(courses).where(eq(courses.active, true)).orderBy(asc(courses.id)));
});

syncRouter.get("/central/courses/:id/batches", requireRole("assistant"), async (req, res) => {
  const [c] = await db.select().from(courses).where(eq(courses.id, Number(req.params.id)));
  if (!c) throw new AppError(404, "Course not found");
  const rows = await saveBatches(c.id, await central("batches", () => centralApi.batches(c.code)));
  rows.sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? "") || a.name.localeCompare(b.name));
  res.json(rows.map(({ id, name, startsOn, endsOn }) => ({ id, name, startsOn, endsOn })));
});

syncRouter.get("/central/batches/:id/students", requireRole("assistant"), async (req, res) => {
  const batchId = String(req.params.id);
  const list = await central("students", () => centralApi.students(batchId));
  const students = new Map<string, string>();
  for (const s of list) {
    const code = tidy(String(s.Id ?? ""));
    const name = tidy(s.Name);
    if (code && name) students.set(code, name);
  }
  const codes = [...students.keys()];
  const existing = codes.length
    ? await db
        .select({ id: members.id, code: members.code })
        .from(members)
        .where(inArray(sql`lower(${members.code})`, codes.map((c) => c.toLowerCase())))
    : [];
  const memberOf = new Map(existing.map((m) => [m.code.toLowerCase(), m.id]));
  res.json(
    codes
      .map((code) => ({ code, name: students.get(code)!, memberId: memberOf.get(code.toLowerCase()) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
});
