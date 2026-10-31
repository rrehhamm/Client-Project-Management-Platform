# Security review — internal MVP (Phase 4)

**Date:** 2026-11-01 · **Scope:** the whole API and client as of release `v0.4.0-mvp` · **Exit criterion:** XSS, IDOR and mass assignment reviewed (Phase 4); NFR-SEC-01…06.

**Result:** no open High or Critical finding. The table below lists the issues found and fixed while building and reviewing Phase 4, and one safeguard worth knowing about. Residual risks are listed at the end; the main one is that this is an internal review, not the independent penetration test NFR-SEC-02 asks for. That test should happen before the client portal opens to clients (Phase 5).

## How it was checked

| Area | Method | Automated in |
|---|---|---|
| IDOR (reaching records by changing an id) | 50 routes that take a record id, across every module, are called by (a) the Owner of another workspace, (b) a Team Member of the same workspace who is not on the project, (c) a contact of another client. Each must fail, and a fingerprint of the records (versions, deleted/archived flags, row counts) must be unchanged. | `server/src/security/security.test.js` |
| Mass assignment | Every write endpoint is sent a valid body plus smuggled fields (`workspace_id`, `created_by`, `project_id`, `role`, `status`, `progress_pct`, `storage_used_bytes`, `author_user_id` …). Each must answer 422 (unknown field) or 403 (field the role may not set), name the field, and write nothing. | same file; also `tasks.test.js` (TC-ROLE-005), `users.test.js` |
| Stored XSS | Script, event-handler, `javascript:`, iframe, SVG and inline-style payloads in comments and task descriptions; script in plain-text fields and search terms. | `security.test.js`, `comments.test.js` (TC-COM-002), client `phase4.test.jsx` |
| Security headers | CSP, `X-Frame-Options: DENY`, `nosniff`, `Cache-Control: no-store` on API responses; HSTS, CSP and redirect on the Caddy front end. | `security.test.js`; Caddy checked in the deployment rehearsal (docs/DEPLOY.md) |
| CSRF | Signed double-submit token on every state-changing request (BR-AUTH-03). | `csrf.test.js`, `auth.test.js` |
| Authorisation model | One `can()` matrix; list endpoints scoped by `auth/scopes.js`; contacts get 404 instead of 403 for records they cannot see (BR-CLI-01). | `can.test.js` plus every module's API tests, by role |
| Files | Extension allow list, content (magic-byte) check, size limit, quota, virus scan, signed-link expiry, SVG handling. | `files.test.js` (TC-FILE-001…004), `scanner.clamav.test.js` (real ClamAV in CI) |
| Audit trail | Denied attempts (401, 403, out-of-scope 404) recorded; the log cannot be changed through the API or the database. | `audit.test.js`, Playwright `comms.spec.js` (E2E-05) |
| Secrets | gitleaks over the whole git history. | CI job "Secret scan" |
| Dependencies | `npm audit`. | run by hand; see below |

## Findings, fixes and safeguards

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | Rich text was cleaned only on the server. A future server bug would have become stored XSS in every browser. | Medium (defence in depth) | The client cleans rich text again with the same allow list before display (`client/src/lib/safeHtml.js`). |
| 2 | SVG files can contain scripts; shown inline from the files host they could run there. | Medium | SVGs are download-only, never served inline (D-34 c); signed links force `Content-Disposition: attachment`. |
| 3 | CSV export: a cell starting with `=`, `+`, `-` or `@` runs as a formula in spreadsheet apps (CSV injection). | Medium | Such cells are prefixed with `'` (`csvCell` in `modules/audit/routes.js`, tested). |
| 4 | Safeguard, not a found bug: Internal comment text must never reach a contact by email (BR-COM-01). | — | `notify()` itself drops contacts for any Internal content, whatever the caller passes, so a future caller cannot leak it (TC-COM-001). |
| 5 | An upload refused early (413/415) reset the connection, so the browser showed a network error instead of the reason. Not a vulnerability, but it hid the content-type rejection from users. | Low | Refused bodies up to just over the size limit are read and discarded before answering; larger ones get `Connection: close`. |
| 6 | The EICAR antivirus test string in source code makes antivirus software quarantine the file on developers' machines. | Low (tooling) | The string is assembled at runtime from two halves. |

Mass assignment and IDOR checks found no gaps: `authorizeFields` (known fields → permission) and strict body schemas (unknown fields → 422) cover every write route, and every id-based route loads its record with the caller's workspace and then calls `can()`.

## Other OWASP items (NFR-SEC-02)

- **SQL injection:** all queries go through Prisma; the few raw statements (`storage_used_bytes` updates, label listing) use tagged templates, which send values as parameters.
- **SSRF:** the server never fetches a URL a user supplies. Links in rich text are stored as text and opened by the reader's browser.
- **Authentication:** bcrypt cost 12 (refused lower outside tests), HttpOnly/Secure/SameSite cookies, 15-minute access tokens with rotating refresh tokens tied to a session row, login throttling and lockout (FR-AUTH-11), rate limits (NFR-SEC-06).
- **Sensitive data in responses:** API responses are `no-store`; contacts never receive Internal records, finance fields are hidden from Team Members (BR-DASH-03), and the audit log (IP, user agent) is Owner/Admin only.

## Dependencies

`npm audit --omit=dev`: **0 vulnerabilities** in what ships. The full audit reports one moderate advisory (minimatch, via ESLint) in development tooling only; no fix is published yet. It does not reach the built app or the API image's runtime path.

## Residual risks and follow-ups

| Risk | Plan |
|---|---|
| No independent penetration test yet (NFR-SEC-02 "pen-test finds no High/Critical issue"). | Before the portal opens to clients (Phase 5). |
| CSP allows `'unsafe-inline'` for styles (component libraries set style attributes). Scripts are `'self'` only. | Revisit with nonces if a style-based attack becomes relevant. |
| The cap on recording signed-out attempts (10 per IP per minute) is per API process. | Fine for one instance; move to a shared store if the API is scaled out. |
| Without ClamAV (a laptop without the `scan` profile), uploads stay "Scanning" unless `DEV_MARK_FILES_CLEAN` is set; production refuses both missing ClamAV and that setting. | By design (D-30). |
| Backups are only as safe as their copy off the server. | DEPLOY.md requires an off-site copy; to be set up with the host. |
