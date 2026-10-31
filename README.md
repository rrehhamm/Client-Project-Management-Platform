# Client Project Management Platform

One workspace where the agency runs clients, projects, tasks, time and billing, plus a branded portal where each client sees only its own work.

The specification is [docs/BAD-BRD.pdf](docs/BAD-BRD.pdf). Every requirement has an ID (`FR-*`, `BR-*`, `NFR-*`, `TC-*`, `OD-*`). Code, commits and tests refer to those IDs. If the code and the BRD disagree, the BRD wins. Product Owner corrections, interpretations and deferred test cases are in [docs/DECISIONS.md](docs/DECISIONS.md).

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

Internal users land on the dashboard; client contacts land on `/portal`. `/status` (no sign-in) shows whether the API, database, storage and mail are reachable. Invitation and password emails appear in Mailpit.

## Scripts

Run from the repo root.

| Command | What it does |
|---|---|
| `npm run setup` | Full local setup (add `-- --no-docker` to use your own services from `.env`) |
| `npm run dev` | API (auto-restart) + Vite dev server |
| `npm run lint` | ESLint for all packages |
| `npm test` | Unit + API tests (shared, server, client) |
| `npm run test:e2e` | Playwright browser tests on their own database (needs the services running) |
| `npm run build` | Production build of the client |
| `npm run services:up` / `services:down` | Start / stop Docker services |
| `npm run db:migrate -w server` | Create a new migration from schema changes (dev only) |
| `npm run db:deploy -w server` | Apply pending migrations |
| `npm run db:seed -w server` | Load seed data (safe to re-run) |
| `npm run db:studio -w server` | Browse the database in Prisma Studio |
| `docker compose --profile scan up -d` | Also start ClamAV locally (optional, ~1.5 GB RAM); then set `SCANNER=clamav` |

Tests never touch your dev database:

- **API tests** use `TEST_DATABASE_URL` (must end in `_test`). Each run wipes, migrates and seeds it. Every test file builds its own workspace (`server/test/fixtures.js`), so files run in parallel and in shuffled order. The suite uses bcrypt cost 4 for speed; outside tests the server refuses a cost below 12.
- **Browser tests** (Playwright) start their own API on port 4100 against `E2E_DATABASE_URL` (default: `cpm_e2e`, must end in `_e2e`) and storage bucket `<S3_BUCKET>-e2e`. Each run creates the database if needed, wipes it and seeds it (`npm run e2e:server -w server`). A running `npm run dev` is not used. Invitation emails are read from Mailpit, so the services must be up.

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

## Authentication and permissions

- **Sessions.** Login sets two HttpOnly, SameSite=Lax cookies:
  - `cpm_at`: a 15-minute access JWT.
  - `cpm_rt`: a refresh JWT, sent only to `/api/v1/auth`.

  The refresh token is replaced on every use, and reusing an old one revokes the session.
- **Every request reloads the session and the person** from the database. So logout, deactivation, role changes and the 30-minute portal idle timeout take effect immediately.
- **CSRF.** Every POST/PUT/PATCH/DELETE must send the `X-CSRF-Token` header, with the value of the `cpm_csrf` cookie (from `GET /api/v1/auth/csrf`). The client does this automatically ([client/src/api/client.js](client/src/api/client.js)).
- **Permissions.** One place: [server/src/auth/permissions.js](server/src/auth/permissions.js) holds the BRD §4.2 matrix as data. `can(principal, action, ctx)` reads it, and routes call it through `authorize()` and `authorizeFields()` ([server/src/auth/authorize.js](server/src/auth/authorize.js)). Controllers never make their own permission decisions.
  - Denied: 403, or 404 for client contacts when the record must stay hidden. Every denial is written to the audit log.
  - Fields a role may not set: 403. Unknown fields: 422.
- **Secure cookies on localhost.** `COOKIE_SECURE=true` works on http://localhost, because browsers treat localhost as secure. Tests set it to `false`.

## What exists so far

| Area | Where |
|---|---|
| Sign-in, sessions, invitations, passwords, profile | `server/src/modules/auth`, `client/src/features/auth`, `features/account` |
| Team (internal users) | `server/src/modules/users`, `client/src/features/team` |
| Workspace settings and logo | `server/src/modules/workspace`, `client/src/features/settings` |
| Clients and contacts | `server/src/modules/clients`, `client/src/features/clients` |
| Projects, members, milestones, activity, duplicate | `server/src/modules/projects`, `client/src/features/projects` |
| Tasks: list / board / calendar, subtasks, checklists, dependencies, bulk, My Tasks | `server/src/modules/tasks`, `client/src/features/tasks` |
| Project templates | `server/src/modules/templates`, `client/src/features/templates` |
| Comments, @mentions, message board | `server/src/modules/comments`, `client/src/features/comments` |
| Notifications: bell, email outbox, preferences, follows | `server/src/modules/notifications`, `server/src/lib/notify.js`, `client/src/features/notifications` |
| Files: upload, versions, folders, virus scan, signed links | `server/src/modules/files`, `server/src/lib/{fileTypes,scanner,storage}.js`, `client/src/features/files` |
| Dashboards and the cross-project task list | `server/src/modules/dashboard`, `client/src/features/dashboard` |
| Global search | `server/src/modules/search`, `client/src/features/search` |
| Audit log (Owner/Admin) | `server/src/modules/audit`, `client/src/features/audit` |
| Scheduled jobs: purges (03:15/03:30 UTC), "due tomorrow" (08:00 workspace time), scan retries, email outbox (every 30 s) | `server/src/jobs` |
| Production deployment | `docker-compose.prod.yml`, `deploy/`, [docs/DEPLOY.md](docs/DEPLOY.md) |

Release documents: [release notes and checklist](docs/RELEASE-NOTES.md), [traceability](docs/TRACEABILITY.md), [security review](docs/SECURITY-REVIEW.md).

## Conventions

- **API shape.** REST JSON under `/api/v1`. Lists return `{ data, page, page_size, total }` (default 25, max 100). Every update of an editable record sends `version`; a stale one gets 409 `STALE_UPDATE`.

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
- **File uploads stay "Scanning".** Downloads need a virus scan (D-30). Locally, either start ClamAV (`docker compose --profile scan up -d`, then `SCANNER=clamav` in `.env`) or add `DEV_MARK_FILES_CLEAN=true` to `.env` to mark uploads clean without a scan. Production refuses both `SCANNER=none` and that setting. Restart `npm run dev` after changing `.env`.
- **Port in use.** Change `POSTGRES_PORT`, `MINIO_API_PORT`, `SMTP_PORT`, `MAILPIT_UI_PORT` or `API_PORT` in `.env`.
