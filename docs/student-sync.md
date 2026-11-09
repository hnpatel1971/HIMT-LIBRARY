# Student sync from the central HIMT server

Student details come from the central HIMT API (`api.himt.co.in`), so staff
don't type them in by hand.

## Adding a student

On Members > Add a member, type the student's ID and press Enter (or Tab
out of the field). The form fills in the name, type STUDENT, course, member
since (batch start) and expiry (batch end) from the central server, and links
the member to the batch. The central API can't search by ID, so the server
reads the batch lists and then the students of running and recent batches
(newest first, six at a time) until the ID turns up, then older batches.
A found student takes about 1 to 5 seconds, and an unknown ID up to about 15.
Student lists are cached for 10 minutes. An ID that is already a member shows
a link to that member. If the ID isn't found, staff can fill the form by hand
or pick from course and batch. Staff and visitors are entered by hand. The
form has no phone or email fields.

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

- The central student ID is the member ID. A new ID becomes a STUDENT member
  with department = course, linked to the batch, member since = batch start,
  expires = batch end.
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
