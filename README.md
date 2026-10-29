# HIMT Library

Library management for the HIMT College Library: catalogue, members,
issue/return/renew with automatic due dates and late fines, visitor check-in,
reports, and a public catalogue search. It replaces the old SLiMS install, and
`pnpm migrate:slims` moves the SLiMS data across.

- `server/`: Node, TypeScript, Express 5, Drizzle ORM on PostgreSQL.
- `web/`: React, Vite, Tailwind. Built into `web/dist` and served by the server.

## Running locally

```
pnpm install
# Set the variables in .env.example in your shell, then:
pnpm dev        # server on :5000, web on :5173
```

The server creates and updates its tables when it starts, and creates the
admin named in `ADMIN_USERNAME` if that user does not exist yet.

```
pnpm test        # unit tests
pnpm typecheck
pnpm build
```

## Rules

- Each member type sets how many books, for how many days, how many renewals
  and the fine per late day.
- Due dates skip the weekly off-days and holidays set in Settings. Late days
  are counted the same way.
- A member with overdue books, or an expired membership, can only borrow when
  a librarian or admin overrides it.
- E-books: a title can carry PDF files. Readers open them in the browser from
  the public catalogue. Each file is either for anyone or for staff only, and
  download and print are off unless the librarian allows them. Files are
  stored in `FILES_DIR` (default `../files`), up to 100 MB each.
- Barcode labels: Catalogue > Barcode labels prints Code 128 labels for
  chosen copies on A4, 15 per sheet by default (3 across, 64 x 50 mm), with
  the title above the barcode cut to 50 characters. Pick copies by title or
  barcode, by a barcode range, or by date added, or from a title's page.
- Roles: assistant (issue, return, members), librarian (catalogue, overrides,
  fines), admin (rules, staff accounts).

## Deploying

See [docs/deploy-windows.md](docs/deploy-windows.md) for the MilesWeb Windows
server, which runs it next to HIMT-LMS.
