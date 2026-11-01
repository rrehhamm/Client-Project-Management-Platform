# Release notes

## Unreleased (after v0.4.0-mvp)

- **Notification defaults** (D-35): emails by default only for task assignment, mentions, due tomorrow and security events; everything else in-app. Existing users keep the settings they changed.
- **Active projects** (D-36): Not Started, In Progress or On Hold, the same on the dashboard and in the client list.
- **Image attachments** in comments show as thumbnails that open the full image (D-37).
- **Deployment**: file storage can be the bundled MinIO or any S3-compatible service (D-38); the deployment guide is provider-neutral (D-39).

## v0.4.0-mvp — internal MVP (2026-11-01)

The first release for internal use: the agency team can run client work end to end with full traceability. Clients do not log in yet (the portal arrives in Phase 5).

### What is in it

- **Sign-in and team:** email + password sign-in, invitations, password reset, roles (Owner, Admin, Project Manager, Team Member, Finance), deactivation, profile with photo and notification settings.
- **Clients and projects:** clients with contacts and internal notes, projects with members, milestones, status lifecycle, archive and 30-day trash, templates and duplication.
- **Tasks:** list, board and calendar views, subtasks, checklists, dependencies, bulk actions, My Tasks, a cross-project task list.
- **Communication:** comments on tasks, files and the project message board, with @mentions, attachments and an Internal/Client visibility tag; a notification bell, emails, follow/unfollow and per-event preferences.
- **Files:** drag-and-drop upload with progress, one level of folders, versions, image/PDF preview, 10-minute signed download links, virus scanning (ClamAV), a 50 GB workspace quota.
- **Dashboards and search:** a dashboard per role whose every number opens the matching list; global search over clients, projects, tasks, files and contacts.
- **Audit:** an append-only activity log; an Owner/Admin audit view with filters and CSV export, including refused access attempts.

Traceability of every Must requirement: [TRACEABILITY.md](TRACEABILITY.md). Security review: [SECURITY-REVIEW.md](SECURITY-REVIEW.md). Installation: [DEPLOY.md](DEPLOY.md).

### Known limits

- No client portal, approvals, time tracking, invoices or payments yet (Phases 5–7). Dashboard cards for approvals, hours, budgets and money arrive with that data (D-33).
- Not yet in this release: Gantt view (Phase 6), comment reactions, daily email digest and the Finance dashboard (D-32), recurring tasks and custom fields (D-28).
- English only (Arabic/RTL is planned for BRD Phase 2, OD-12).
- New uploads show "Scanning" for a few seconds; while ClamAV is starting (a few minutes after a restart) they wait longer.
- No independent penetration test yet; planned before clients get access (SECURITY-REVIEW.md).

### Release checklist

| # | Step | Status |
|---|---|---|
| 1 | CI green: lint, unit, API, security suite, all Playwright tests incl. E2E-02/05 | ✅ Done (also: ClamAV EICAR job, secret scan, production image build) |
| 2 | Traceability table: every Must ID → code → test → pass | ✅ Done — [TRACEABILITY.md](TRACEABILITY.md) |
| 3 | Production build: Dockerfiles, `docker-compose.prod.yml`, Caddy with HTTPS, HSTS and HTTP→HTTPS | ✅ Done — built and run locally; CI builds the images on every push |
| 4 | Configuration review: no secrets in repo (secret scan in CI), secure cookies, real SMTP, `APP_URL`, CSP, rate limits | ✅ Done — production refuses unsafe settings at start-up. The SMTP provider is chosen by each installation (D-39) |
| 5 | First-Owner setup script | ✅ Done — `server/scripts/create-owner.js`, tested on an empty database |
| 6 | Backups: nightly dump + file copy, restore tried on a scratch machine | ✅ Done — `deploy/backup.sh` / `restore.sh`; full wipe-and-restore rehearsed locally. The off-site copy is set up with the host |
| 7 | Smoke test on the target | ⏳ **Pending** — no paid hosting for now; each company will deploy its own copy (D-39) |
| 8 | Release notes with known limits, `v0.4.0-mvp` tag | ✅ Done — this file |

### Upgrading

First installation: follow [DEPLOY.md](DEPLOY.md). There is no earlier production version to upgrade from.
