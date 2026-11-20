# Progress — where the build stands

**Snapshot: 2026-11-20.** Paused in the middle of Phase 5 to start a UI design phase. Everything below is committed and pushed; lint, 413 API tests and 76 UI tests pass.

## Done

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundations: monorepo, Docker Compose, CI, seed data | Approved |
| 1 | Sign-in, sessions, CSRF, lockout, invitations, roles and the `can()` permission layer | Approved |
| 2 | Clients, contacts, workspace settings, projects, members, milestones, activity | Approved |
| 3 | Tasks (list, board, calendar), subtasks, checklists, dependencies, bulk, My Tasks, templates, duplicate | Approved |
| 4 | Comments, notifications, files with virus scan, dashboards, search, audit log, security review, production deployment — released as `v0.4.0-mvp` | Approved |
| After MVP | Quieter notification defaults (D-35), one "active projects" definition (D-36), image thumbnails (D-37), bundled or external S3 storage (D-38), provider-neutral deployment (D-39), 30-day backups | Approved |

## UI design phase (D-45): in progress

Design system in [DESIGN.md](DESIGN.md). Steps, one commit each, all tests green after each:

0. **Done, awaiting approval:**
   - tokens (`client/src/styles/tokens.css`) with contrast tests;
   - brand-colour contrast protection (`lib/brand.js`);
   - appearance helper (`lib/appearance.js`);
   - the self-hosted font;
   - the design preview at `/design-preview.html` (dev server).
   - Nothing in the app has changed yet. Bundle baseline: 156.02 KB JS, 7.36 KB CSS (gzipped).
1. Foundation: wire the tokens and font into the app, and restyle `ui/` components and status badges. Before-screenshots are taken first.
2. Frame: sidebar `InternalLayout`, top bar, `PageHeader`, `StateViews`, `AuthLayout`, appearance setting (per user, server-stored), brand colour applied app-wide.
3. Libraries within the D-45 limits: 21st.dev, GSAP, React Bits. Bundle size is reported against the 30 KB limit.
4. Dashboard.
5. Projects and clients.
6. Tasks (list, board, calendar, panel).
7. Files, comments, activity, notifications.
8. Portal and approval screens.
9. Contrast scan, before/after screenshots, report.

## Phase 5 (client portal and approvals): paused

Decisions D-40…D-44 in [DECISIONS.md](DECISIONS.md).

### Done
- **Server, complete and tested:**
  - `/api/v1/portal/*` (contacts get 404 from every internal endpoint).
  - Approvals: request, any/all rule, decisions, pins, cancel, history, reminders, auto-close task.
  - Contact invite / revoke / restore, contact export / anonymise.
  - Contact notification settings, contact mentions in Client comments, approval dashboard cards.
  - Portal isolation suite (`server/src/security/portal-isolation.test.js`).
- **Client, built but not yet wired or tested:**
  - Data hooks: `client/src/api/portal.js`.
  - Portal frame and home: `components/PortalLayout.jsx`, `features/portal/PortalHomePage.jsx`.
  - Portal project page: `features/portal/PortalProjectPage.jsx`.
  - Portal approval pages: `features/portal/PortalApprovalPages.jsx`.
  - Internal approval pages, request dialog, proofing viewer with pdf.js: `features/approvals/`.
  - "Request approval" in the file dialog and the task panel; approval history in the file dialog.
  - Comments working in both apps (`lib/apiScope.js`).

### Remaining
1. **Routes and navigation:**
   - Portal routes: `/portal/projects/:id`, `/portal/approvals`, `/portal/approvals/:id`.
   - Internal routes: `/approvals`, `/approvals/:id`.
   - Lazy-page entries for all of them.
   - Labels for the two new dashboard cards.
2. **Contacts tab actions:** invite / resend, revoke, restore (Owner, Admin, PM); export, anonymise (Owner, Admin).
3. **Contact notification settings** on the portal Account page.
4. **English strings** for the new portal and approval screens (`portal.*`, `approvals.*`, `contacts.*` keys).
5. **Tests:**
   - UI tests for portal and approval screens.
   - Playwright: E2E-03 (client request through to Done), approve / request changes / new version, revoking access mid-session.
6. **Penetration-test kit:** scope document, test accounts for every role and both clients, seed data, instructions (D-43).
7. **"Before real clients get access" checklist** in RELEASE-NOTES.md and DEPLOY.md, including the CORS rule an external bucket needs for PDF proofing.
8. **Docs and report:** traceability, release notes, the pdf.js bundle size.

## Later phases

- **Phase 6, time and reports:**
  - Time entries, timer, weekly timesheets.
  - Reports: status, time, utilisation, workload.
  - Gantt view; hours and budget dashboard cards.
- **Phase 7, finance:**
  - Proposals, contracts with e-signature, invoices, payments, expenses, profitability.
  - Finance dashboard; portal documents and billing.
- **End of the build:**
  - Recurring tasks and custom fields (D-28).
  - Reactions and daily digest (D-32).
  - A restore screen for deleted tasks.
- **Before handover:**
  - Smoke test on a real server (release step 7).
  - Independent penetration test.
  - Free demo option and an INSTALL guide (D-39).
