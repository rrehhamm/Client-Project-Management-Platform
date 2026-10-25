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

## Deferred test cases

Covered now at the `can()` level (unit tests in `server/src/auth/can.test.js`). The exact API test is added when the endpoint ships.

| TC | What the BRD asks | Covered now by | Exact API test in |
|---|---|---|---|
| TC-ROLE-002 | Lina demoted to Team Member → creating a project gets 403 | API test: demoted PM gets 403 when inviting a Team Member (also a PM-only action) | Phase 2 (POST /projects) |
| TC-ROLE-003 | Team Member `POST /api/v1/projects` → 403, no record | `can()` test | Phase 2 |
| TC-ROLE-004 | Team Member `DELETE /api/v1/projects/{A}` → 403 | `can()` test | Phase 2 |
| TC-ROLE-005 | Team Member PATCH task with `visibility` and `project_id` → ignored or 403, DB unchanged | `can()` test; field-level mechanism tested on `/users` | Phase 3 |
| TC-ROLE-006 | Team Member `GET /api/v1/invoices` → 403 | `can()` test | Phase 7 |
| TC-USER-002 (part) | Deactivated user's open tasks keep the assignee and show "Assignee inactive" | Deactivation, sign-out and "not assignable" tested now | Phase 3 |
| TC-AUTH-003 (page) | Signed-out `GET /projects` page → `/login?next=/projects` | Same redirect tested with `/team` (Vitest + Playwright) | Phase 2 |
| E2E-05 | Unauthorised attempts recorded in the audit log | Denials are audited (`access.denied`), tested on `/users` | Phase 4 |
| E2E-07 (part) | Deactivating an employee stops and saves a running timer | — | Phase 6 |
