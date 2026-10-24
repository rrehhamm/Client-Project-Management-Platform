# Client Project Management Platform

One workspace where the agency runs clients, projects, tasks, time and billing, plus a branded portal where each client sees only its own work.

The specification is [docs/BAD-BRD.pdf](docs/BAD-BRD.pdf). Every requirement has an ID (`FR-*`, `BR-*`, `NFR-*`, `TC-*`, `OD-*`). Code, commits and tests refer to those IDs. If the code and the BRD disagree, the BRD wins.

## Quick start

**Prerequisites:** Node.js 24+ ([.nvmrc](.nvmrc)) and Docker Desktop (running).

```bash
npm run setup   # .env, npm install, docker compose up, migrations, seed, storage bucket
npm run dev     # API on :4000, app on :5173
```

| What | URL |
|---|---|
| App | http://localhost:5173 |
| API health | http://localhost:4000/api/v1/health |
| Mailpit (caught emails) | http://localhost:8025 |
| MinIO console | http://localhost:9001 (user/password: `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`) |

**Seed accounts** (BRD 19.1). Every password is `SEED_PASSWORD` from `.env`:

| Role | Email |
|---|---|
| Owner | owner@nexa.test |
| Admin | admin@nexa.test |
| PM | lina.pm@nexa.test |
| Team Members | omar@nexa.test, rana@nexa.test |
| Finance | sami.fin@nexa.test |
| Nova Retail contacts | maya@novaretail.test (Approve on Project A), ali@novaretail.test (View) |
| Bright Solutions contact | omar.n@bright.test (Approve on Project B) |

Projects: **NOV-001** E-Commerce Platform (Nova Retail, In Progress, Fixed 12,000 JOD, PM Lina, member Omar) and **BRI-001** Corporate Website (Bright Solutions, Not Started, Hourly, PM Lina, member Rana).

Sign-in arrives in Phase 1. Until then the app shows a system status page.

## Scripts

Run from the repo root.

| Command | What it does |
|---|---|
| `npm run setup` | Full local setup (add `-- --no-docker` to use your own services from `.env`) |
| `npm run dev` | API (auto-restart) + Vite dev server |
| `npm run lint` | ESLint for all packages |
| `npm test` | Unit + API tests (shared, server, client) |
| `npm run test:e2e` | Playwright browser tests (needs the services running) |
| `npm run build` | Production build of the client |
| `npm run services:up` / `services:down` | Start / stop Docker services |
| `npm run db:migrate -w server` | Create a new migration from schema changes (dev only) |
| `npm run db:deploy -w server` | Apply pending migrations |
| `npm run db:seed -w server` | Load seed data (safe to re-run) |
| `npm run db:studio -w server` | Browse the database in Prisma Studio |

Server tests use a separate database (`TEST_DATABASE_URL`, must end in `_test`). Each run wipes it, migrates it and seeds it, so tests never touch your dev data.

## Repository layout

```
client/            React + Vite app (JavaScript)
  src/api/         fetch wrapper (ApiError) + TanStack Query hooks
  src/features/    one folder per module
  src/components/  shared UI (shadcn/ui in components/ui, StateViews for loading/empty/error)
  src/i18n/        all UI strings (NFR-I18N-01)
  e2e/             Playwright tests
server/
  src/modules/     one folder per module: routes.js, controller.js, service.js, schema.js, *.test.js
  src/auth/        authentication + the central can() authorization layer (Phase 1)
  src/lib/         db, logger, errors, mailer, storage
  prisma/          schema.prisma, migrations, seed.js
shared/            constants, money/duration/date helpers, Zod schemas used by both sides
docker/            service init scripts
scripts/setup.mjs  the setup command
docs/              the BRD
```

## Conventions

- **Errors.** Every error response is `{ code, message, fields[] }` ([server/src/lib/errors.js](server/src/lib/errors.js), codes in [shared/src/errors.js](shared/src/errors.js)). Stack traces, SQL and secrets never leave the server.
- **IDs.** Native Postgres `uuid`, time-ordered UUIDv7.
- **Common columns.** Every table has `workspace_id`, `created_at`, `created_by`, `updated_at`, `updated_by`. `created_by`/`updated_by` have no foreign key, because the author can be a user, a client contact or the system.
- **Money.** Integers in the currency's minor unit, using each currency's own decimals: JOD 3, USD/EUR 2. So 12,000 JOD is stored as `12000000`. This is an agreed correction to FR-INV-02 (which said 2 decimals). Helpers: `toMinor` / `fromMinor` in [shared/src/money.js](shared/src/money.js). The API returns amounts as numbers in minor units.
- **Durations.** Integer minutes (estimates and budgets too).
- **Dates.** Timestamps are `timestamptz` (UTC). Date-only fields (due dates, entry dates) are calendar dates in the workspace timezone.
- **Optimistic locking.** Editable tables have a `version` column (NFR-CONC-01).
- **Soft delete.** `deleted_at` on projects, milestones, tasks, comments, files and file versions.
- **Visibility.** `Internal` (default) or `Client` on milestones, tasks, comments and files.
- **Database guards.** Rules Prisma can't express live in [the constraints migration](server/prisma/migrations/20261024000100_constraints_and_triggers/migration.sql):
  - login emails unique across users *and* client contacts
  - activity log is append-only (trigger)
  - a member row is either a user or a contact
  - due date ≥ start date
  - time entry duration 1–1440 minutes
  - plus other range checks
- **Project codes.** `<3 letters>-<NNN>` with a counter per client (NOV-001, NOV-002…). The 3-letter prefix is stored on the client and is unique in the workspace.
- **Config.** All configuration comes from `.env` (documented in [.env.example](.env.example)) and is validated at startup ([server/src/config.js](server/src/config.js)).

## Notes and troubleshooting

- **npm 12 install scripts.** npm blocks dependency install scripts unless they are listed in `allowScripts` in the root [package.json](package.json). `bcrypt`, `prisma` and `@prisma/engines` are approved. If you upgrade one of them, run `npm install-scripts approve <pkg>`.
- **MinIO image.** Official `minio/minio` images are no longer published publicly. Compose uses `pgsty/minio`, a community build of the MinIO source. Any S3-compatible service works: change `S3_*` in `.env`.
- **Docker on Windows.** Docker Desktop needs WSL2, which needs hardware virtualization (Intel VT-x / AMD-V) turned on in BIOS/UEFI. If `docker info` fails with a 500 error, check with `wsl --status`. After installing Docker, open a new terminal so `docker` is on your PATH.
- **Port in use.** Change `POSTGRES_PORT`, `MINIO_API_PORT`, `SMTP_PORT`, `MAILPIT_UI_PORT` or `API_PORT` in `.env`.
