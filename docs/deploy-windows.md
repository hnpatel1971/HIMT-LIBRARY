# Installing the HIMT Library on the MilesWeb server

The library runs on the same Windows server as HIMT-LMS, next to it. It uses
the PostgreSQL that HIMT-LMS already runs (a separate database called
`library`), runs as its own Windows service, and gets its own IIS site.

| | HIMT-LMS | HIMT Library |
|---|---|---|
| Code | `C:\himt-lms` | `C:\himt-library` |
| Settings | `C:\himt-lms-config\himt-lms.env` | `C:\himt-library-config\himt-library.env` |
| Windows service | HIMT-LMS (port 8080) | HIMT-Library (port 8090) |
| Database | `lms` | `library` |
| IIS site | himt-lms (port 80) | himt-library (first free port from 8081, or port 80 with its own web address) |

## First install

1. Sign in to the server with Remote Desktop.
2. Download `deploy/windows/install.ps1` from the HIMT-LIBRARY repository to
   the server, for example to `C:\Users\Administrator\Downloads`.
3. Copy `library-data.sql` (the old SLiMS data, already converted) into
   `C:\himt-library-config\`. Create the folder if it does not exist yet.
   Skip this step to start with an empty library.
4. Open PowerShell as Administrator and run:

   ```
   powershell -ExecutionPolicy Bypass -File C:\Users\Administrator\Downloads\install.ps1
   ```

   The first run creates `C:\himt-library-config\himt-library.env` and opens
   it in Notepad. It fills in the PostgreSQL password from the LMS settings.
5. Fill in `ADMIN_USERNAME` and `ADMIN_PASSWORD` (your first staff login),
   save, and run the same command again. If the library has its own web
   address (for example `library.himtmarine.com`), put it in `SITE_HOST` first
   and point that name's DNS record at the server.
6. When it says Done, open the address it prints, such as `http://<server IP>:8082/` (or your web address).
   The public catalogue is at `/` and staff sign in at `/staff/login`.

Git may ask you to sign in to GitHub the first time, because the repository is
private. Use the same GitHub account as for HIMT-LMS.

The old SLiMS staff logins (lib_admin, himt_lib, Himtlib_man) keep working
with their old passwords.

## Updating

Run `install.ps1` again. It pulls the latest code, rebuilds and restarts the
service. Data and settings are kept.

## Good to know

- Logs: `C:\himt-library\logs\service.log`.
- Restart: `Restart-Service HIMT-Library`.
- The library's port must also be open in the MilesWeb firewall if the library does not
  open from outside the server.
- Backups: the `library` database is in the same PostgreSQL as the LMS, so a
  backup of that PostgreSQL covers both. For a library-only backup:
  `pg_dump -U postgres -h 127.0.0.1 -d library -f library-backup.sql`.
- E-book PDFs are files, not database rows. They are kept in
  `C:\himt-library-files` (or `FILES_DIR` in the settings file), so back up
  that folder together with the database.
- HTTPS: bind a certificate to the himt-library site in IIS once it has a web
  address. Sign-in cookies switch to secure automatically over HTTPS.

## Loading fresh data from SLiMS

`library-data.sql` is a snapshot of the SLiMS database taken in October 2026.
Anything issued in SLiMS after that is not in it. To move the latest SLiMS
data instead, export the `himt_lib` database from SLiMS (phpMyAdmin, Export,
SQL) and run the migration script against it:

```
SLIMS_DATABASE_URL=mysql://root@127.0.0.1:3306/himt_lib \
DATABASE_URL=postgres://postgres:PASSWORD@127.0.0.1:5432/library \
pnpm migrate:slims --reset
```

`--reset` replaces all titles, members, loans and fines in the new system.
