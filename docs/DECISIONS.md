# Decisions and deviations from the BRD

The BRD ([BAD-BRD.pdf](BAD-BRD.pdf)) is the source of truth. This file records every place where the Product Owner corrected or extended it, every interpretation the code relies on, and every test case postponed until its endpoint exists. Code comments refer to these entries by ID (for example "D-04").

## Product Owner decisions

| ID | Decision | Affects | Agreed |
|---|---|---|---|
| D-01 | Money is stored as integers in the currency's own minor unit and rounded to that currency's decimals: **JOD 3**, USD 2, EUR 2. 12,000 JOD is stored as `12000000`. Corrects FR-INV-02, which said 2 decimals. | BR-INV-04, FR-INV-02 | 2026-10-24 |
| D-02 | Project code is 3 uppercase letters from the client name plus a per-client counter (`NOV-001`). When the prefix is taken, the system suggests another unique one (e.g. `NVR`). Admin or PM may edit the prefix only until the client's first project exists; then it is locked. The "NOVA-001" example in FR-PRJ-01 is a typo; TC-PRJ-001 (`NOV-002`) is correct. | FR-PRJ-01, FR-CLI-01 | 2026-10-24 |
| D-03 | `unit_price` on proposal and invoice lines is stored with **4 decimals** (ten-thousandths), regardless of currency. Each line total is rounded half-up to the currency's decimals, then lines are summed. TC-INV-001 is updated below. | FR-INV-02, TC-INV-001 | 2026-10-24 |
| D-04 | Cost rates are always in the workspace currency. A user's default bill rate applies only when the client's currency equals the workspace currency. Otherwise the project must define a `bill_rate_override` in the client's currency, and approving billable time is blocked until it is set. No currency conversion in the MVP. | FR-TIME-06, FR-USER-07 (Phases 6/7) | 2026-10-24 |
| D-05 | One workspace for now, but `workspace_id` stays on every table. Login emails are unique across the whole platform, users and client contacts together. | FR-AUTH-01, BR-ROLE-05 | 2026-10-24 |
| D-06 | **Finance may view and set user rates.** FR-USER-07 ("Admin/Finance set hourly cost rate and default bill rate") wins over the §4.2 matrix, which shows Finance with no access to Users. | FR-USER-07, §4.2 | 2026-10-25 |
| D-07 | PostgreSQL only. Native `uuid`, partial unique indexes and triggers are allowed. | NFR, schema | 2026-10-24 |
| D-08 | **Portal idle timeout wins over "Remember me".** A Client Contact must sign in again after 30 minutes without activity, even with "Remember me" on. "Remember me" (30-day session) applies to internal users only. | FR-AUTH-10 | 2026-10-25 |
| D-11 | Email-change confirmation links expire after **24 hours**. The BRD gives no limit. (was I-03) | FR-AUTH-13 | 2026-10-25 |
| D-12 | Project names are unique per client, case-insensitive. Archived projects count; soft-deleted projects do not. | BR-PRJ-01 | 2026-10-24 |
| D-13 | A PM may create time entries for members **only on projects where they are the project's PM** (`projects.pm_user_id`), not on every project they belong to. Narrows FR-TIME-08 / matrix "R member". (was I-01) | FR-TIME-08, `timeEntry.create` | 2026-10-25 |
| D-14 | PM scope is split. **Requesting approvals:** any project where the PM is a member. **Managing project members** (add/remove, portal levels): only projects where they are the project's PM. Owner and Admin keep full access to both. (was I-02) | FR-APP-01, FR-PRJ-05, FR-CON-04 | 2026-10-25 |
| D-15 | Line tax is calculated on the line subtotal *after* it is rounded to the currency's decimals; the tax amount is then rounded half-up to the currency's decimals. (was I-05) | FR-INV-02, TC-INV-001 | 2026-10-25 |
| D-16 | Commercial rights come from a client-level flag on the contact, **`commercial_authority`** (boolean), not from project portal levels. It allows accepting proposals, signing contracts and paying invoices for that client. The primary contact gets it by default; Owner, Admin or PM can grant or revoke it. Portal levels (View/Comment/Approve) cover deliverables only. Column added in Phase 2; enforced in Phases 5 and 7. (was I-04) | FR-PROP-04, FR-CTR-02, FR-INV-05, §4.2 | 2026-10-25 |
| D-17 | `GET /workspace` is readable by **every signed-in principal** (internal roles and portal contacts): name, logo, brand colour, timezone, currency, date format and week start. Admin-only fields (numbering, currency lock) go to Owner/Admin only. `PATCH /workspace` and `PUT /workspace/logo` stay Owner/Admin. Extends the §4.2 "Workspace settings" row, which shows no read access for other roles. | FR-WS-01, §4.2 | 2026-10-25 |
| D-18 | Project templates (FR-PRJ-02/03) are built in **Phase 3**, right after tasks, because templates copy tasks and checklists. | FR-PRJ-02/03 | 2026-10-25 |
| D-19 | A project's PM must be an **active** user whose workspace role is **PM, Admin or Owner**. Team Members and Finance cannot be a project's PM. | FR-PRJ-01, FR-PRJ-04 | 2026-10-25 |
| D-20 | A milestone's **Overdue** is computed when read (due date before today in the workspace timezone and not Completed), never stored. The `Overdue` enum value is unused. Same approach as the project and task overdue flags. | FR-MS-02 | 2026-10-25 |
| D-21 | The **workspace currency is locked** once any user rate or time entry exists (409 with a clear message), because rates are stored in the workspace currency (D-04). | FR-WS-01, D-04 | 2026-10-25 |
| D-22 | Phase 2 assumptions, approved: the Leads pipeline (FR-CLI-07) moves to Phase 7 with proposals, and manual projects need an **Active** client; progress stays 0% until tasks exist (Phase 3); workspace logo is PNG or SVG ≤ 2 MB checked by content, SVGs with scripts or event handlers rejected, shown via signed URL; supported currencies stay JOD, USD, EUR (OD-09); a contact can be deleted only if they never signed in and have no project membership or history (otherwise 409, turn off portal access instead). | FR-CLI-07, FR-PRJ-07, FR-WS-01, FR-CON | 2026-10-25 |
| D-23 | **Task status moves.** Open statuses (To Do, In Progress, In Review, Blocked) can move in any direction (board drag; TC-TSK-006). The dependency rule (FR-TSK-07) applies whenever a task leaves To Do for In Progress, In Review **or Done** (a blocked task cannot skip straight to Done). **Done** from any open status except Blocked, with the subtask rule (BR-TSK-02). **Cancelled** from any open status. **Reopen** (Done/Cancelled → To Do) only by PM, Admin or Owner. **Assignees may mark their own tasks Done** (relaxes §16.2 "In Review → Done: PM"). | FR-TSK-06, §16.2 | 2026-10-25 |
| D-24 | **Team Member task edits.** On tasks assigned to them: status, checklist, description, their own estimate (BR-TSK-05). On tasks they created: also title, priority, dates and labels. Never: visibility, milestone, billable flag, or other people's assignment. They may **add** themselves as assignee on a task in their project; they may **remove** themselves only from tasks they created or self-assigned — not from a task someone else assigned them to (only PM/Admin/Owner reassign). | BR-TSK-05, §4.2 Tasks | 2026-10-25 |
| D-25 | **Task views.** Calendar (month grid by due date) in Phase 3; Gantt/timeline (FR-TSK-09 "S") in Phase 6 with the workload view. | FR-TSK-09 | 2026-10-25 |
| D-26 | **Templates.** PMs who are members of the project, plus Owner/Admin, can save a project as a template. Templates copy milestones, tasks with relative dates, subtasks, checklists, default members **and task dependencies**, never assignees, comments, files or time. **Duplicate project (FR-PRJ-12)** is built in Phase 3 on the same copy logic. | FR-PRJ-02/03/12 | 2026-10-25 |
| D-27 | **Moving a task** to another project of the same client (BR-TSK-04): subtasks move with it; it loses milestone and dependencies; assignees who aren't members of the target project are removed and listed in the response. | BR-TSK-04 | 2026-10-25 |
| D-28 | Phase 3 assumptions, approved: recurring tasks (FR-TSK-08) and custom fields (FR-TSK-15) at the end of the build; tasks are soft-deleted with no restore screen for now; dependencies link tasks of the same project only. | FR-TSK-08/13/15, FR-TSK-07 | 2026-10-25 |
| D-29 | **Hosting.** The internal MVP stops at "deployable": Dockerfiles, `docker-compose.prod.yml`, Caddy with automatic HTTPS, backup scripts, a first-Owner setup script and `docs/DEPLOY.md` for one Linux VM. Host, domain and email provider are chosen later; the on-target smoke test (release checklist step 7) is pending. | NFR-SEC-01, release | 2026-10-31 |
| D-30 | **Virus scanning (BR-FILE-02).** ClamAV runs in `docker-compose.prod.yml`. Locally it sits behind the optional Compose profile `scan`. Without a scanner, new versions stay **Scanning** and cannot be downloaded, unless the dev-only setting `DEV_MARK_FILES_CLEAN=true` marks them clean (refused when `NODE_ENV=production`). CI uses a stub scanner plus one EICAR test against real ClamAV. | BR-FILE-02 | 2026-10-31 |
| D-31 | **Live updates by polling.** An open comment thread refreshes every 3 s (FR-COM-01 "≤ 3 s"); the notification bell every 30 s and on window focus. | FR-COM-01, FR-NOT-01 | 2026-10-31 |
| D-32 | **Phase 4 scope.** In: project message board (FR-COM-06), one level of folders (FR-FILE-05), audit-log view with CSV (FR-ACT-02). Deferred: reactions (FR-COM-05), daily digest (FR-NOT-04), Finance dashboard (FR-DASH-04). | FR-COM-05/06, FR-NOT-04, FR-FILE-05, FR-ACT-02, FR-DASH-04 | 2026-10-31 |
| D-33 | **Dashboard cards arrive with their data**, so every card has a working drill-down (FR-DASH-05): approval cards in Phase 5, hours/budget cards in Phase 6, money cards in Phase 7. | FR-DASH-01/02/03 | 2026-10-31 |
| D-34 | Phase 4 assumptions, approved: (a) a comment can be edited only within 24 h of posting, and then shows "edited"; (b) signed-out calls to private APIs (limited per IP) and 404s for records that exist but are outside the caller's scope are recorded in the audit log as `access.denied`; (c) SVG files are download-only, never previewed inline; (d) the message board is project-level comments with one reply level. | FR-COM-04, E2E-05, FR-FILE-03, FR-COM-06 | 2026-10-31 |
| D-35 | **Notification defaults.** In-app **and email** by default only for: assigned to a task, mentioned, task due tomorrow, and security events (security emails are always sent). Every other event (comments on followed items, status of followed tasks, project status) defaults to **in-app only**. Users can change any of them. Only the settings a person chooses are stored, so the rest follow the defaults. Existing users get the new defaults unless they changed a setting. Phase 4 had stored the whole table, so migration `20261101000000_notification_defaults` keeps a stored value only if it differs from the old default (email), or if the audit log shows the person switching that event to email themselves. | FR-NOT-02/03 | 2026-11-01 |
| D-36 | **Active projects** means status Not Started, In Progress or On Hold, and neither archived nor deleted, everywhere. The dashboard card, the project list filter (`?active=true`) and the client list column and client page count (FR-CLI-03) use one shared query (`activeProjectWhere`). A test checks that they match. Replaces the Phase 4 card definition (In progress only). | FR-DASH-01, FR-CLI-03/04 | 2026-11-01 |
| D-37 | **Image attachments in comments** (PNG, JPG, GIF, WebP) show as a small thumbnail inside the comment once the virus scan is clean. Clicking it opens the full image, with a Download button. Other types, and images still being scanned, keep the file chip. | FR-COM-01, FR-FILE-03 | 2026-11-01 |
| D-38 | **Provider-neutral storage.** Production runs with either bundled MinIO on the VM (`STORAGE=bundled`) or any external S3-compatible service (`STORAGE=external`, e.g. Cloudflare R2). The Compose file, Caddy and the backup/restore scripts follow the setting. With external storage, file backups are the provider's versioning or replication. | FR-FILE, NFR-SEC-01 | 2026-11-01 |
| D-39 | **Distribution and hosting.** The platform will be sold or handed over to companies; each company deploys its own copy on infrastructure it pays for. **One workspace per installation** (current design). Deployment docs are provider-neutral: any Linux VM with Docker, any SMTP provider, any S3-compatible storage. Hetzner, Brevo and Cloudflare R2 appear only as examples. **No paid hosting for now:** release checklist step 7 (smoke test on a real server) stays pending. **Later, before handover only** (not now, on the Product Owner's request): a free temporary demo option (e.g. Cloudflare Tunnel) and a short INSTALL guide for a company's IT team. Refines D-29. | release, NFR | 2026-11-01 |

### Updated test case: TC-INV-001 (D-03)

| TC ID | Req | Steps / Data | Expected Result |
|---|---|---|---|
| TC-INV-001 | FR-INV-02, D-03 | Invoice in **USD** with a line: qty 3 × unit price 33.335, tax 16% | `unit_price` stored as `333350` (4 decimals). Line subtotal 3 × 33.335 = 100.005 → rounded half-up to USD decimals = **100.01**. Tax 16% of 100.01 = 16.0016 → **16.00**. Line total **116.01**. Invoice totals are sums of rounded line values. The same line in **JOD** gives 100.005 / 16.001 / 116.006. |

Tax is taken on the already-rounded line subtotal, as agreed in D-15.

## Phase changes

| Change | Agreed |
|---|---|
| FR-AUTH-13 (Profile, Must) moved into Phase 1: name, phone, timezone, email change with verification. Avatar upload and notification preferences move to Phase 4. | 2026-10-25 |
| FR-WS-01 (Workspace settings, Must) added to Phase 2. | 2026-10-25 |

## Behaviour choices approved for Phase 1

- A locked account (FR-AUTH-11) answers **423** `ACCOUNT_LOCKED` with `Retry-After`. **429** is used only for rate limits (NFR-SEC-06).
- Expired or used emailed links answer **410** `LINK_EXPIRED` with the BRD texts: "Invitation expired, ask your admin to resend" and "Link expired or used".
- "Your account is deactivated" (403) appears only after a correct password. A wrong password always gets the generic 401 (FR-AUTH-02).
- Accepting an invitation signs the person in. A password reset does not: it revokes every session, and the person signs in again.
- Transferring ownership needs the Owner's current password. The old Owner becomes an Admin.
- The Owner's role changes only by transfer. Checks run in this order: last administrator (409 "At least one administrator is required"), then Owner protection (409), then "not yourself" (403, BR-ROLE-03).
- Deactivating a user keeps their project memberships, so reactivating restores them (FR-USER-06).
- Body fields a role may not set get **403** with the field names. Unknown fields get **422**. Either way the database is unchanged (NFR-SEC-03).

## Interpretations awaiting confirmation

None open. I-01…I-05 were answered on 2026-10-25 and are now D-13, D-14, D-11, D-16 and D-15. (IDs D-09 and D-10 were placeholders for I-01/I-02 and are not used.)

## Behaviour choices made in Phase 3

- A **Completed or Cancelled project** (as well as an archived one) is read-only for tasks: any task change answers 409 "Reopen the project first". On Hold projects still accept task changes.
- `GET /me/tasks` groups open tasks into overdue / today / this_week / later; the reference date is `as_of` ("today" is a group name).
- In the List view, drag-to-reorder is offered to PM/Admin/Owner and only when no filter is active (a filtered list hides siblings, so the new position would be unclear).
- The board also has a status menu on each card, so status changes work by keyboard and screen reader (NFR-A11Y-01).

## Behaviour choices made in Phase 4

Reviewed by the Product Owner on 2026-11-01. Explicitly approved: the upload waits for the virus scan and infected files are refused; Finance sees the Owner/Admin cards until Phase 7. Changed afterwards: notification defaults (D-35) and the "Active projects" card (D-36).

- **Notification channels (FR-NOT-03):** "In-app and email", "In-app only" or "Off" per event. ~~Every event defaults to in-app and email.~~ Superseded by D-35. Security emails (password reset, sign-in email change) are not listed and always go out. Contacts get in-app and email until their preferences arrive with the portal (Phase 5).
- **Who is told what:** creators and assignees follow a task; commenters follow what they commented on (on the board: the post). New assignees, people mentioned, followers (comments, task status) and internal project members (project status) are notified. A person mentioned in a comment does not also get the follower notification for it.
- **Mentions (BR-COM-02):** anyone who can read the item can be mentioned, so Owner, Admin and Finance always can; others must be project members. Mentioning someone else is refused with their name; a PM/Admin/Owner is offered "Add to project".
- **Comment visibility:** comments on an Internal item stay Internal; a Client comment cannot carry an Internal file; replies to an Internal board post are Internal.
- **Virus scan timing (D-30):** the upload request waits for the scan. An infected file is refused (422 "A virus was found") and not kept; its uploader is notified. If the scanner is unreachable, the version stays "Scanning" and is retried every minute.
- **New versions** may have a different file type from the previous version (both must be allowed types).
- **Downloads are logged** (`file.downloaded`) in the audit log, not in the project activity sentences.
- **Dashboards:** ~~"Active projects" counts In progress projects.~~ Superseded by D-36. Finance sees the Owner/Admin cards until its own dashboard (FR-DASH-04, D-32). "My projects" lists open projects (not Completed/Cancelled).
- **Search:** up to 10 results per type and 20 overall, taken in turn from each type so no type crowds out the others. Team Members never get contact results (§4.2).
- **Production safety:** the API refuses to start in production without `SCANNER=clamav`, with `DEV_MARK_FILES_CLEAN`, with placeholder or identical secrets, or with bcrypt cost below 12.
- **First Owner:** `create-owner.js` creates an invited Owner and prints a one-time set-password link, so no password is passed on a command line.

## Engineering requests

| ID | Request | Status |
|---|---|---|
| E-01 | API test files must not depend on running in a fixed order against one shared database. Each file creates its own data, so files can run in any order or in parallel. (Requested 2026-10-25 after Phase 2.) | **Done in Phase 3**, confirmed 2026-10-31: each file builds its own workspace (`server/test/fixtures.js`); the fixed-order sequencer is gone; `server/vitest.config.js` runs files in parallel with shuffled order. Only `prisma/schema.test.js` reads the seed (read-only). |
| E-02 | Bundle size: no further splitting needed for now (main bundle ~565 KB / 177 KB gzip). | Closed 2026-10-25 |
| E-03 | Browser tests must not write to the dev database. (Requested 2026-10-31 after Phase 3.) | **Done** 2026-10-31: Playwright's API uses `cpm_e2e` (wiped and seeded every run, `server/scripts/e2e-server.js`) and bucket `<S3_BUCKET>-e2e`. Leftover E2E records were removed from the dev database (15 projects, 5 clients and their contacts, 3 templates, 5 invited users); their activity-log entries stay, as the log is append-only. |

## Deferred test cases

Covered now at the `can()` level (unit tests in `server/src/auth/can.test.js`). The exact API test is added when the endpoint ships.

| TC | What the BRD asks | Covered now by | Exact API test in |
|---|---|---|---|
| ~~TC-ROLE-002~~ | Lina demoted to Team Member → creating a project gets 403 | **Done in Phase 2** (`projects.test.js`) | — |
| ~~TC-ROLE-003~~ | Team Member `POST /api/v1/projects` → 403, no record | **Done in Phase 2** | — |
| ~~TC-ROLE-004~~ | Team Member `DELETE /api/v1/projects/{A}` → 403 | **Done in Phase 2** | — |
| ~~TC-ROLE-005~~ | Team Member PATCH task with `visibility` and `project_id` → ignored or 403, DB unchanged | **Done in Phase 3** (`tasks.test.js`: 403, DB unchanged) | — |
| TC-ROLE-006 | Team Member `GET /api/v1/invoices` → 403 | `can()` test | Phase 7 |
| ~~TC-USER-002 (part)~~ | Deactivated user's open tasks keep the assignee and show "Assignee inactive" | **Done in Phase 3** (`tasks.test.js`) | — |
| ~~TC-AUTH-003 (page)~~ | Signed-out `GET /projects` page → `/login?next=/projects` | **Done in Phase 2** (Playwright `projects.spec.js`) | — |
| ~~FR-PRJ-02/03~~ | Project templates | **Done in Phase 3** (`templates.test.js`, Playwright `tasks.spec.js`) | — |
| ~~FR-PRJ-07 (live)~~ | Progress recalculated on every task status change | **Done in Phase 3** (`tasks.test.js`) | — |
| FR-TSK-09 (Gantt) | Gantt/timeline view | Calendar view built (D-25) | Phase 6 |
| ~~FR-TSK-02/05 (notify)~~ | Assignees notified when assigned or when a task changes | **Done in Phase 4** (`notifications.test.js`) | — |
| ~~FR-PRJ-06 (notify)~~ | Status change notified to members | **Done in Phase 4** (`notifications.test.js`) | — |
| ~~FR-PRJ-11 (files)~~ | Purge also removes stored files of purged projects | **Done in Phase 4** (`files.test.js`) | — |
| ~~E2E-05~~ | Unauthorised attempts recorded in the audit log | **Done in Phase 4** (`audit.test.js`, Playwright `comms.spec.js`) | — |
| E2E-07 (part) | Deactivating an employee stops and saves a running timer | — | Phase 6 |
