# Traceability — internal MVP (`v0.4.0-mvp`)

Every **Must** requirement of the BRD's release 1 ("Phase 1 — MVP": Auth, Users & Roles, Clients, Projects, Milestones, Tasks, Comments, Files, Notifications, Dashboards, Activity log, plus global search), with the code that implements it and the tests that prove it. All tests listed pass in CI on the release commit.

**Status:** ✅ done · ◐ done for the MVP; the remaining part needs data from a later phase (decision in brackets).

Test file shorthand: `server/src/modules/<m>/<m>.test.js` → *API <m>*; `client/src/features/…test.jsx` → *UI*; `client/e2e/<f>.spec.js` → *E2E <f>*.

## Authentication and users

| ID | Requirement | Code | Tests | Status |
|---|---|---|---|---|
| FR-AUTH-01 | Log in with email + password | `modules/auth` | API auth · E2E auth | ✅ |
| FR-AUTH-02 | Reject wrong credentials | `modules/auth` | API auth | ✅ |
| FR-AUTH-03 | Validate login fields | `shared/schemas/auth.js`, `features/auth` | API auth · UI auth | ✅ |
| FR-AUTH-04 | Protect all private routes and APIs | `auth/authenticate.js`, `auth/authorize.js`, client guards | API auth · E2E auth, projects (TC-AUTH-003) | ✅ |
| FR-AUTH-05 | Log out | `modules/auth` | API auth | ✅ |
| FR-AUTH-06 | Block deactivated users | `auth/sessions.js` | API auth, users | ✅ |
| FR-AUTH-07 | Accept invitation | `modules/auth` | API auth · E2E auth, comms (E2E-02) | ✅ |
| FR-AUTH-08 | Forgot password | `modules/auth` | API auth | ✅ |
| FR-AUTH-09 | Change password | `modules/auth` | API auth | ✅ |
| FR-AUTH-10 | Session timeout | `auth/sessions.js`, `api/client.js` | API auth · `client.test.js` | ✅ |
| FR-AUTH-11 | Brute-force protection | `auth/throttle.js`, `auth/rateLimits.js` | API auth | ✅ |
| FR-AUTH-13 | Profile (incl. photo and notification settings) | `modules/auth`, `modules/misc` (avatar), `modules/notifications` | API auth, dashboard (photo), notifications (settings) | ✅ |
| FR-WS-01 | Workspace settings | `modules/workspace` | API workspace | ✅ |
| FR-USER-01 | Invite user | `modules/users` | API users · E2E auth, comms | ✅ |
| FR-USER-02 | Resend / revoke invitation | `modules/users` | API users | ✅ |
| FR-USER-03 | List and search users | `modules/users` | API users · UI TeamPage | ✅ |
| FR-USER-04 | Change role | `modules/users` | API users | ✅ |
| FR-USER-05 | Deactivate user ("Assignee inactive") | `modules/users`, `modules/tasks` | API users, tasks (TC-USER-002), dashboard | ✅ |
| FR-USER-06 | Reactivate user | `modules/users` | API users | ✅ |

## Clients, projects, milestones

| ID | Requirement | Code | Tests | Status |
|---|---|---|---|---|
| FR-CLI-01…06 | Create, edit, list, 360° view, archive/restore, delete client | `modules/clients` | API clients · UI phase2 · E2E projects | ✅ |
| FR-CLI-08 | Internal notes on client | `modules/clients` | API clients | ✅ |
| FR-CON-01/02 | Add contact; primary contact | `modules/clients` | API clients · E2E projects | ✅ |
| FR-PRJ-01 | Create project | `modules/projects` | API projects (TC-PRJ-001) · E2E projects | ✅ |
| FR-PRJ-04 | Edit project | `modules/projects` | API projects | ✅ |
| FR-PRJ-05 | Manage members | `modules/projects/members.js` | API projects · E2E comms | ✅ |
| FR-PRJ-06 | Change status (members notified) | `modules/projects` | API projects, notifications | ✅ |
| FR-PRJ-07 | Progress | `modules/projects/common.js` | API tasks (TC-PRJ-004) | ✅ |
| FR-PRJ-08 | Project overview page | `features/projects` | UI phase2 | ✅ |
| FR-PRJ-09 | Project list | `modules/projects` | API projects · UI phase2, phase4 (drill-down) | ✅ |
| FR-PRJ-10 | Archive / restore | `modules/projects` | API projects · E2E projects | ✅ |
| FR-PRJ-11 | Delete project (30-day purge incl. stored files) | `modules/projects`, `jobs/purgeDeletedProjects.js` | API projects, files (purge) | ✅ |
| FR-MS-01…03 | Create, status, complete milestone | `modules/projects/milestones.js` | API milestones · E2E projects | ✅ |

## Tasks

| ID | Requirement | Code | Tests | Status |
|---|---|---|---|---|
| FR-TSK-01 | Create task | `modules/tasks` | API tasks · E2E tasks | ✅ |
| FR-TSK-02 | Edit task fields (assignees notified) | `modules/tasks`, `tasks/notifications.js` | API tasks (TC-ROLE-005), notifications | ✅ |
| FR-TSK-03 | Assign only members | `modules/tasks` | API tasks | ✅ |
| FR-TSK-04 | Subtasks | `modules/tasks` | API tasks (TC-TSK-005) · E2E tasks | ✅ |
| FR-TSK-06 | Change status | `modules/tasks` (D-23) | API tasks (TC-TSK-001…004) · E2E tasks | ✅ |
| FR-TSK-09 | Views: list, board, calendar | `features/tasks` | UI phase3 · E2E tasks (TC-TSK-006) | ◐ Gantt in Phase 6 (D-25) |
| FR-TSK-10 | My Tasks | `modules/tasks` (`myTasks`) | API tasks · UI phase3 · E2E tasks | ✅ |
| FR-TSK-12 | Reorder | `modules/tasks` | API tasks | ✅ |
| FR-TSK-13 | Delete task | `modules/tasks` | API tasks · UI phase3 | ✅ |

## Comments, notifications, activity

| ID | Requirement | Code | Tests | Status |
|---|---|---|---|---|
| FR-COM-01 | Post comment (rich text, 1–10,000 chars, ≤ 5 attachments, ≤ 3 s refresh) | `modules/comments`, `features/comments` (D-31) | API comments (TC-COM-002) · UI phase4 · E2E comms | ✅ |
| FR-COM-02 | Comment visibility (Internal tag) | `modules/comments` | API comments (TC-COM-001) · UI phase4 | ✅ |
| FR-COM-03 | @mentions | `modules/comments`, `RichComposer.jsx` | API comments (BR-COM-02) · E2E comms | ✅ |
| FR-COM-04 | Edit within 24 h / delete | `modules/comments` (D-34 a) | API comments · UI phase4 | ✅ |
| FR-NOT-01 | In-app notifications (bell) | `modules/notifications`, `NotificationBell.jsx` | API notifications · UI phase4 · E2E comms | ✅ |
| FR-NOT-02 | Email notifications | `lib/notify.js`, `jobs/outbox.js`, `jobs/dueTomorrow.js` | API notifications, comments | ◐ approval emails in Phase 5, invoice emails in Phase 7 (D-33) |
| FR-NOT-03 | Preferences | `modules/notifications`, `AccountExtras.jsx` | API notifications, comments | ✅ |
| FR-NOT-05 | Follow / unfollow | `lib/notify.js`, `modules/notifications` | API notifications, comments | ✅ |
| FR-ACT-01 | Activity feed per project and client | `lib/activityFeed.js` | API projects, clients · UI ActivityFeed | ✅ |
| BR-NOT-01 | Never notified about own action | `lib/notify.js` | API comments (TC-NOT-001), notifications | ✅ |
| BR-COM-01 | Internal comments never reach contacts | `modules/comments`, `lib/notify.js` | API comments (TC-COM-001) | ✅ |
| BR-ACT-01 | Activity log append-only | DB trigger, no update/delete route | API audit, `schema.test.js` | ✅ |

## Files

| ID | Requirement | Code | Tests | Status |
|---|---|---|---|---|
| FR-FILE-01 | Upload (100 MB, allowed types, progress) | `modules/files`, `FilesTab.jsx` | API files (TC-FILE-001) · UI phase4 · E2E comms | ✅ |
| FR-FILE-02 | New version (older approvals superseded) | `modules/files` | API files (TC-FILE-004) | ✅ |
| FR-FILE-03 | Preview images and PDF | `FileDialog.jsx` (SVG download-only, D-34 c) | API files · E2E comms | ✅ |
| FR-FILE-04 | Download via 10-minute signed link | `lib/storage.js`, `modules/files` | API files (TC-FILE-003) | ✅ |
| FR-FILE-06 | Delete (uploader, PM, Admin; 30 days; blocked by decided approval) | `modules/files` | API files | ✅ |
| FR-FILE-07 | Visibility (PM toggles Client) | `modules/files` | API files · UI phase4 | ✅ |
| BR-FILE-01 | Type checked by content (415) | `lib/fileTypes.js` | API files (TC-FILE-002) | ✅ |
| BR-FILE-02 | Virus scan | `lib/scanner.js` (D-30) | API files (stub) · `scanner.clamav.test.js` (real ClamAV, CI) | ✅ |
| BR-FILE-03 | Quota (413 "Storage limit reached") | `modules/files` | API files, dashboard (storage) | ✅ |

## Dashboards and search

| ID | Requirement | Code | Tests | Status |
|---|---|---|---|---|
| FR-DASH-01 | Admin/Owner dashboard | `modules/dashboard` | API dashboard · UI phase4 | ◐ "awaiting client approval" card in Phase 5 (D-33) |
| FR-DASH-02 | PM dashboard | `modules/dashboard` | API dashboard | ◐ approvals card Phase 5; budget % Phase 6 (D-33) |
| FR-DASH-03 | Team Member dashboard | `modules/dashboard` | API dashboard (TC-DASH-002) · UI phase4 | ✅ (hours vs capacity is a Should, Phase 6) |
| FR-DASH-05 | Drill-down: list count = card count | `modules/dashboard`, `WorkTasksPage.jsx` | API dashboard (TC-DASH-001) · UI phase4 | ✅ |
| FR-DASH-06 | Loading / empty / error states | `DashboardPage.jsx` | UI phase4 (TC-DASH-003) | ✅ |
| BR-DASH-01/02 | Server-side, permitted data; workspace week | `modules/dashboard`, `lib/dates.js` | API dashboard | ✅ |
| FR-SRCH-01 | Global search | `modules/search`, `SearchBox.jsx` | API dashboard (TC-SRCH-001) · UI phase4 · E2E comms (E2E-02) | ✅ |

## End-to-end scenarios and security

| ID | Scenario | Tests | Status |
|---|---|---|---|
| E2E-02 | Onboard a team member | E2E comms | ✅ |
| E2E-05 | Unauthorised access attempts (401/403/404, recorded) | E2E comms, projects · API audit | ✅ |
| NFR-SEC-02/03/05 | XSS, IDOR, mass assignment, headers | `security.test.js` · docs/SECURITY-REVIEW.md | ✅ |
| NFR-SEC-04 | No secrets in the repo | CI "Secret scan" (gitleaks) | ✅ |
| NFR-SEC-06 | Rate limits | API auth | ✅ |

Not in release 1 (Should/Could, or later BRD phases) are tracked in [DECISIONS.md](DECISIONS.md) and the phase plan.
