# Student sync from the central HIMT server

Student details come from the central HIMT API (`api.himt.co.in`), so staff
don't type them in by hand.

## Adding a student

Members > Add a member has a Course, Batch, Student picker at the top. It
reads the central server live. Picking a student fills in member ID (central
student ID), name, type STUDENT, department = course, member since = batch
start and expires = batch end, and links the member to the batch. A student
who is already a member is marked "already a member" with a link to their
page. Staff and visitors are still entered by hand. The form no longer has
phone and email fields.

## What it reads

- Courses: a fixed list in the `courses` table (seeded by migration 0003):
  B.Tech(ME), BSc(NS), GME, GP RATING, ETO, OCCP, B.Tech(Lateral), DNS. The
  `code` column is what the API expects. GP RATING's code is `GP  RATING`,
  with two spaces.
- Batches per course: `GET /api/batch/getbycourseV2?course_code=<code>`
  stored in `batches` (id = the central Batch_Id, e.g. B48496).
- Students per batch:
  `GET /api/user/GetStudentforExam?userType=Student_For_Lib&Batch_Id=<id>`.
  The API gives only the student ID and name.

## What the nightly sync does to members

- It never adds members. Students join through the form above.
- An existing student member with that ID gets the central name, course,
  batch and expiry date. Staff edits to those fields are overwritten on the
  next run; phone, email, address and notes are left alone.
- An ID that belongs to a non-student member (faculty, staff) is not touched
  and is listed as a problem in the sync history.
- A student in two batches stays on the batch that ends later.
- Nothing is ever deleted or marked inactive.

## When it runs

- Every night at 2 AM library time (`STUDENT_SYNC_HOUR` changes the hour):
  every course's batch list, then the students of batches that are running,
  ended in the last 60 days, or are new.
- On Sundays the nightly run re-reads every batch. So does the very first run.
- If the server was off at 2 AM, the run starts within 10 minutes of it
  coming back.
- Settings > Student sync has **Sync now** (recent batches) and **Sync all
  batches**, for librarians and admins, plus the course and batch lists and
  the history of runs with any problems.

A full run reads about 120 batches and takes under a minute.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `CENTRAL_API_URL` | `https://api.himt.co.in` | Base URL of the central API |
| `STUDENT_SYNC_HOUR` | `2` | Hour of the nightly run, library time |
| `STUDENT_SYNC` | on | `off` stops the nightly run (Sync now still works) |
