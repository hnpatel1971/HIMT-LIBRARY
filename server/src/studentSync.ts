// Brings students in from the central HIMT server (api.himt.co.in).
//
// For each course in the fixed `courses` table it reads the course's batches,
// then the students of each batch, and refreshes the students who are already
// library members (name, course, batch, expiry). The central student ID is the
// member code. It never adds members: staff add a student through the Add a
// member form, which fills itself from the same central data. Nothing is ever
// deleted.
//
// Daily runs only re-read batches that are running or ended recently; the
// weekly full run (and the first run ever) re-reads every batch.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { addDays, LIBRARY_TZ, today } from "./calendar.js";

const { courses, batches, members, memberTypes, syncRuns } = schema;

export const CENTRAL_API_URL = (process.env.CENTRAL_API_URL || "https://api.himt.co.in").replace(/\/+$/, "");
/** Daily runs re-read batches that ended up to this many days ago. */
export const RECENT_DAYS = 60;
/** Hour of the day (library time) when the nightly run starts. */
export const SYNC_HOUR = Number(process.env.STUDENT_SYNC_HOUR ?? 2);
/** Sunday: the nightly run re-reads every batch. */
const FULL_ON_WEEKDAY = 0;

export interface CentralBatch {
  Course_Code: string;
  Batch_Id: string;
  Batch_Name: string;
  BatchStartDate: string | null;
  BatchEndDate: string | null;
  Presea_Batch_Id: string | null;
}
export interface CentralStudent {
  Id: string | number;
  Name: string | null;
}

export interface CentralApi {
  batches(courseCode: string): Promise<CentralBatch[]>;
  students(batchId: string): Promise<CentralStudent[]>;
}

async function getJson(url: string): Promise<unknown> {
  let last: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const err = last as Error & { cause?: { message?: string; code?: string } };
  const why = [err?.message ?? String(last), err?.cause?.code ?? err?.cause?.message].filter(Boolean).join(", ");
  throw new Error(`${url}: ${why}`);
}

function asArray<T>(v: unknown, what: string): T[] {
  if (!Array.isArray(v)) throw new Error(`The central server sent something other than a list of ${what}`);
  return v as T[];
}

export const centralApi: CentralApi = {
  async batches(courseCode) {
    const url = `${CENTRAL_API_URL}/api/batch/getbycourseV2?course_code=${encodeURIComponent(courseCode)}`;
    return asArray<CentralBatch>(await getJson(url), "batches");
  },
  async students(batchId) {
    const url = `${CENTRAL_API_URL}/api/user/GetStudentforExam?userType=Student_For_Lib&Batch_Id=${encodeURIComponent(batchId)}`;
    return asArray<CentralStudent>(await getJson(url), "students");
  },
};

/** Collapses runs of spaces and line breaks; the central data has a few. */
export const tidy = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
/** "2025-09-01T00:00:00" -> "2025-09-01" */
export const dayOf = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

export interface SyncResult {
  runId: number;
  status: "ok" | "partial" | "failed";
  batches: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: string[];
}

let running: Promise<SyncResult> | null = null;
export const isSyncRunning = () => running !== null;

/** Starts a run unless one is already going. Resolves when it finishes. */
export function startSync(opts: { full: boolean; userId?: number | null; api?: CentralApi }) {
  if (running) return null;
  running = runSync(opts).finally(() => {
    running = null;
  });
  return running;
}

async function studentTypeId() {
  const [t] = await db
    .select({ id: memberTypes.id })
    .from(memberTypes)
    .where(sql`upper(${memberTypes.name}) = 'STUDENT'`);
  if (t) return t.id;
  const [created] = await db.insert(memberTypes).values({ name: "STUDENT" }).returning({ id: memberTypes.id });
  return created.id;
}

async function runSync({ full, userId = null, api = centralApi }: { full: boolean; userId?: number | null; api?: CentralApi }): Promise<SyncResult> {
  // The first run ever reads everything, whatever was asked for.
  const [anyFull] = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(and(eq(syncRuns.kind, "full"), inArray(syncRuns.status, ["ok", "partial"])))
    .limit(1);
  if (!anyFull) full = true;

  const [run] = await db
    .insert(syncRuns)
    .values({ kind: full ? "full" : "daily", startedBy: userId })
    .returning({ id: syncRuns.id });
  const r: SyncResult = { runId: run.id, status: "ok", batches: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] };
  const note = (msg: string) => {
    if (r.errors.length < 200) r.errors.push(msg);
  };

  try {
    const typeId = await studentTypeId();
    const courseRows = await db.select().from(courses).where(eq(courses.active, true));
    const courseName = new Map(courseRows.map((c) => [c.id, c.name]));

    // 1. Batch lists for every course.
    const known = new Map((await db.select().from(batches)).map((b) => [b.id, b]));
    const fresh = new Set<string>();
    for (const c of courseRows) {
      let list: CentralBatch[];
      try {
        list = await api.batches(c.code);
      } catch (e) {
        note(`Batches for ${c.name}: ${(e as Error).message}`);
        continue;
      }
      for (const row of await saveBatches(c.id, list)) {
        const prev = known.get(row.id);
        if (!prev || !prev.syncedAt) fresh.add(row.id);
        known.set(row.id, { ...(prev ?? { students: 0, syncedAt: null }), ...row });
      }
    }

    // 2. Which batches to read students for.
    const cutoff = addDays(today(), -RECENT_DAYS);
    const toRead = [...known.values()]
      .filter((b) => courseName.has(b.courseId))
      .filter((b) => full || fresh.has(b.id) || !b.endsOn || b.endsOn >= cutoff)
      // Oldest first, so a student in two batches ends up on the newer one.
      .sort((a, b) => (a.endsOn ?? "9999").localeCompare(b.endsOn ?? "9999"));

    // 3. Students, one batch at a time.
    for (const b of toRead) {
      let list: CentralStudent[];
      try {
        list = await api.students(b.id);
      } catch (e) {
        note(`Students of ${b.name}: ${(e as Error).message}`);
        continue;
      }
      await syncBatchStudents(b, courseName.get(b.courseId)!, list, typeId, r, note);
      await db.update(batches).set({ students: list.length, syncedAt: new Date() }).where(eq(batches.id, b.id));
      r.batches++;
    }
    if (r.errors.length) r.status = r.batches ? "partial" : "failed";
  } catch (e) {
    console.error("Student sync failed", e);
    note(`Stopped: ${(e as Error).message}`);
    r.status = "failed";
  }

  await db
    .update(syncRuns)
    .set({
      status: r.status,
      finishedAt: new Date(),
      batches: r.batches,
      updated: r.updated,
      unchanged: r.unchanged,
      skipped: r.skipped,
      errors: r.errors,
    })
    .where(eq(syncRuns.id, r.runId));
  return r;
}

type BatchRow = typeof batches.$inferSelect;

/** Stores a course's batch list as the central server sent it. */
export async function saveBatches(courseId: number, list: CentralBatch[]) {
  const rows = [];
  for (const b of list) {
    const id = tidy(b.Batch_Id);
    if (!id) continue;
    const row = {
      id,
      courseId,
      name: tidy(b.Batch_Name).slice(0, 200) || id,
      startsOn: dayOf(b.BatchStartDate),
      endsOn: dayOf(b.BatchEndDate),
      preseaBatchId: tidy(b.Presea_Batch_Id) || null,
    };
    await db
      .insert(batches)
      .values(row)
      .onConflictDoUpdate({ target: batches.id, set: { courseId: row.courseId, name: row.name, startsOn: row.startsOn, endsOn: row.endsOn, preseaBatchId: row.preseaBatchId } });
    rows.push(row);
  }
  return rows;
}

async function syncBatchStudents(
  b: Pick<BatchRow, "id" | "name" | "startsOn" | "endsOn">,
  course: string,
  list: CentralStudent[],
  typeId: number,
  r: SyncResult,
  note: (m: string) => void,
) {
  const students = new Map<string, string>();
  for (const s of list) {
    const code = tidy(String(s.Id ?? ""));
    const name = tidy(s.Name).slice(0, 128);
    if (code && name) students.set(code.toLowerCase(), JSON.stringify([code, name]));
  }
  if (!students.size) return;

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: members.id,
        code: members.code,
        name: members.name,
        typeId: members.typeId,
        department: members.department,
        batchId: members.batchId,
        joinedOn: members.joinedOn,
        expiresOn: members.expiresOn,
        batchEnds: batches.endsOn,
      })
      .from(members)
      .leftJoin(batches, eq(members.batchId, batches.id))
      .where(inArray(sql`lower(${members.code})`, [...students.keys()]));
    const byCode = new Map(existing.map((m) => [m.code.toLowerCase(), m]));
    const now = new Date();

    for (const [key, packed] of students) {
      const [code, name] = JSON.parse(packed) as [string, string];
      const m = byCode.get(key);
      // Students join the library through the Add a member form, not here.
      if (!m) continue;
      if (m.typeId !== typeId) {
        // Same ID as a faculty or staff member: leave that record alone.
        r.skipped++;
        note(`${code} ${name} (${b.name}) has the same ID as a non-student member, ${m.name}. Not changed`);
        continue;
      }
      // A student in two batches stays on the one that ends later.
      if (m.batchId && m.batchId !== b.id && (m.batchEnds ?? "") > (b.endsOn ?? "")) {
        r.unchanged++;
        continue;
      }
      const next = {
        name,
        department: course,
        batchId: b.id,
        joinedOn: m.joinedOn ?? b.startsOn,
        expiresOn: b.endsOn ?? m.expiresOn,
      };
      const same =
        m.name === next.name && m.department === next.department && m.batchId === next.batchId && m.joinedOn === next.joinedOn && m.expiresOn === next.expiresOn;
      await tx.update(members).set({ ...next, syncedAt: now }).where(eq(members.id, m.id));
      if (same) r.unchanged++;
      else r.updated++;
    }
  });
}

/** Hour and weekday in library time. */
function libraryClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: LIBRARY_TZ, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  return { hour, weekday: wd };
}

/** Whether the nightly run is due: past SYNC_HOUR and no nightly run started today. */
export async function nightlyDue(now = new Date()) {
  const { hour, weekday } = libraryClock(now);
  if (hour < SYNC_HOUR) return null;
  const [last] = await db
    .select({ startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(sql`${syncRuns.startedBy} IS NULL`)
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  if (last && today(last.startedAt) === today(now)) return null;
  return { full: weekday === FULL_ON_WEEKDAY };
}

/**
 * Checks every 10 minutes whether tonight's run is due, so a server that was
 * off at 2 AM catches up when it comes back. STUDENT_SYNC=off turns it off.
 */
export function startSyncScheduler() {
  if (process.env.STUDENT_SYNC === "off" || process.env.NODE_ENV === "test") return;
  const tick = async () => {
    try {
      if (isSyncRunning()) return;
      const due = await nightlyDue();
      if (!due) return;
      const result = await startSync({ full: due.full });
      if (result) {
        console.log(
          `Student sync (${due.full ? "full" : "daily"}): ${result.status}, ${result.batches} batches, ${result.updated} updated`,
        );
      }
    } catch (e) {
      console.error("Student sync scheduler", e);
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 10 * 60_000).unref();
}
