// API tests for the client portal and contact access: FR-CON-03…05, FR-PORT-01…05/07/08,
// BR-CLI-01/02/04, TC-PORT-001…005, D-40, D-44, NFR-PRIV-02.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FILES, STANDARD_ERROR, auditEntries, client, loginAs, tokenFromLastMail } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');
const { sendMail } = await import('../../lib/mailer.js');

const app = createApp();
let W;
let as;
let A;
let B;
let ali; // View level on A
let shared; // Client-visible task on A
let secret; // Internal task on A

beforeAll(async () => {
  W = await createWorld('Portal');
  as = await W.loginAll(app);
  A = W.projects.A;
  B = W.projects.B;
  ali = await W.login(app, 'ali');
  shared = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Homepage design', visibility: 'Client', estimate_minutes: 240, is_billable: true, assignee_ids: [W.users.member.id] })).body;
  secret = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Margin review', estimate_minutes: 60 })).body;
});

const P = (path) => `/api/v1/portal${path}`;

describe('the portal is the only API for contacts (D-40)', () => {
  it('contacts get 404 from internal endpoints and the attempt is recorded; internal users get 403 on the portal', async () => {
    for (const url of ['/api/v1/projects', `/api/v1/projects/${A.id}`, `/api/v1/tasks/${shared.id}`, '/api/v1/dashboard', '/api/v1/search?q=ho', '/api/v1/workspace', '/api/v1/users']) {
      const res = await as.Contact.get(url);
      expect(res.status, url).toBe(404);
      expect(res.body).toMatchObject(STANDARD_ERROR);
    }
    const [entry] = await auditEntries('access.denied', { actor_id: W.contacts.maya.id });
    expect(entry.after).toMatchObject({ permission: 'portal.only', reason: 'internal_endpoint' });
    for (const role of ['Owner', 'PM', 'TeamMember']) expect((await as[role].get(P('/home'))).status, role).toBe(403);
    expect((await (await client(app)).get(P('/home'))).status).toBe(401);
  });

  it('FR-PORT-07: branding shows the workspace name, colour and logo; no vendor names', async () => {
    const res = await as.Contact.get(P('/branding'));
    expect(res.body).toMatchObject({ workspace: { name: W.workspace.name, brand_color: '#2563EB' }, client: { name: 'Nova Retail' } });
  });
});

describe('home and projects (FR-PORT-01/02/08)', () => {
  it('home lists active projects with progress, approvals awaiting the contact and recent updates', async () => {
    await as.PM.post('/api/v1/comments', { entity_type: 'Task', entity_id: shared.id, body: '<p>First draft is up</p>', visibility: 'Client' });
    await as.PM.post('/api/v1/comments', { entity_type: 'Task', entity_id: secret.id, body: '<p>Internal only</p>' });
    const home = (await as.Contact.get(P('/home'))).body;
    expect(home.projects.map((p) => p.code)).toEqual(['NOV-001']);
    expect(home.projects[0]).toMatchObject({ name: 'E-Commerce Platform', progress_pct: expect.any(Number), my_level: 'Approve', can_comment: true, can_approve: true });
    expect(home.awaiting).toMatchObject({ approvals: expect.any(Array), contracts: [], invoices: [] });
    expect(home.updates.map((u) => u.title)).toContain('Lina commented');
    expect(JSON.stringify(home)).not.toMatch(/Internal only|Margin review|Corporate Website/);
  });

  it('TC-PORT-001: another client\'s project by id is 404 with no data, and recorded', async () => {
    const res = await as.Contact.get(P(`/projects/${B.id}`));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/Corporate Website|BRI-001/);
    for (const url of [`/projects/${B.id}/tasks`, `/projects/${B.id}/files`]) expect((await as.Contact.get(P(url))).status, url).toBe(404);
    const denied = await db.activityLog.findMany({ where: { action: 'access.denied', actor_id: W.contacts.maya.id } });
    expect(denied.some((d) => d.after.path === P(`/projects/${B.id}`))).toBe(true);
  });

  it('TC-PORT-005: with the portal turned off, the project is not listed and its URL is 404', async () => {
    const p = await db.project.create({ data: { workspace_id: W.workspace.id, client_id: W.clients.nova.id, name: 'Portal off', name_normalized: 'portal off', code: 'NOV-090', status: 'InProgress', billing_type: 'Fixed', start_date: new Date('2026-10-01'), pm_user_id: W.users.pm.id, portal_enabled: false } });
    await db.projectMember.create({ data: { workspace_id: W.workspace.id, project_id: p.id, contact_id: W.contacts.maya.id, portal_level: 'Approve' } });
    expect((await as.Contact.get(P('/projects'))).body.data.map((x) => x.code)).not.toContain('NOV-090');
    expect((await as.Contact.get(P(`/projects/${p.id}`))).status).toBe(404);
  });

  it('TC-PORT-002/003: Client tasks only, without estimates, billing, time or internal comments', async () => {
    const list = (await as.Contact.get(P(`/projects/${A.id}/tasks?page_size=100`))).body.data;
    expect(list.map((t) => t.title)).toEqual(['Homepage design']);
    const detail = (await as.Contact.get(P(`/tasks/${shared.id}`))).body;
    for (const key of ['estimate_minutes', 'is_billable', 'sort_order', 'created_by', 'version', 'checklist', 'labels', 'permissions', 'has_inactive_assignee']) expect(detail, key).not.toHaveProperty(key);
    expect(detail.assignees).toEqual([{ full_name: 'Omar' }]); // D-44 (a): names only
    const comments = (await as.Contact.get(P(`/comments?entity_type=Task&entity_id=${shared.id}`))).body.data;
    expect(comments.every((c) => c.visibility === 'Client')).toBe(true);
    expect((await as.Contact.get(P(`/tasks/${secret.id}`))).status).toBe(404);
    expect((await as.Contact.get(P(`/comments?entity_type=Task&entity_id=${secret.id}`))).status).toBe(404);
  });

  it('BR-CLI-02: switching a task to Internal hides it at once', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Briefly shared', visibility: 'Client' })).body;
    expect((await as.Contact.get(P(`/tasks/${t.id}`))).status).toBe(200);
    await as.PM.patch(`/api/v1/tasks/${t.id}`, { visibility: 'Internal', version: t.version });
    expect((await as.Contact.get(P(`/tasks/${t.id}`))).status).toBe(404);
  });
});

describe('requests, comments and uploads (FR-PORT-03/04, D-44 b)', () => {
  it('a Comment-level contact sends a request: a Client To Do task labelled "Client request"; the PM is notified', async () => {
    const res = await as.Contact.post(P(`/projects/${A.id}/requests`), { title: 'Add size filter', description: '<p>On the shop page</p>' });
    expect(res.status).toBe(201);
    const task = await db.task.findUnique({ where: { id: res.body.id } });
    expect(task).toMatchObject({ visibility: 'Client', status: 'ToDo', labels: ['Client request'], is_client_request: true, requested_by_contact_id: W.contacts.maya.id });
    expect(await db.notification.count({ where: { user_id: W.users.pm.id, entity_id: task.id, type: 'client_request' } })).toBeGreaterThan(0);
    // The PM sees it in the internal app
    expect((await as.PM.get(`/api/v1/tasks/${task.id}`)).body).toMatchObject({ is_client_request: true, visibility: 'Client' });
  });

  it('TC-PORT-004: a View-level contact cannot send requests, comment or upload (403)', async () => {
    expect((await ali.post(P(`/projects/${A.id}/requests`), { title: 'x' })).status).toBe(403);
    expect((await ali.post(P('/comments'), { entity_type: 'Task', entity_id: shared.id, body: '<p>x</p>' })).status).toBe(403);
    expect((await ali.upload(P(`/projects/${A.id}/files`), SAMPLE_FILES.pdf(), { name: 'x.pdf' })).status).toBe(403);
    // …but can read
    expect((await ali.get(P(`/tasks/${shared.id}`))).status).toBe(200);
  });

  it("a contact's comments and uploads are always Client-visible", async () => {
    const c = await as.Contact.post(P('/comments'), { entity_type: 'Task', entity_id: shared.id, body: '<p>Looks great</p>', visibility: 'Internal' });
    expect(c.status).toBe(422); // visibility is not a portal field
    const ok = await as.Contact.post(P('/comments'), { entity_type: 'Task', entity_id: shared.id, body: '<p>Looks great</p>' });
    expect(ok.body.visibility).toBe('Client');
    const up = await as.Contact.upload(P(`/projects/${A.id}/files?task_id=${shared.id}`), SAMPLE_FILES.png(), { name: 'reference.png' });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ name: 'reference.png', task: { id: shared.id }, latest: { scan_status: 'Clean', uploaded_by: { full_name: 'Maya' } } });
    expect((await db.file.findUnique({ where: { id: up.body.id } })).visibility).toBe('Client');
    const link = await as.Contact.get(P(`/files/${up.body.id}/versions/1/url`));
    expect(link.status).toBe(200);
    // An Internal file is 404 for her, even by id
    const internal = (await as.PM.upload(`/api/v1/projects/${A.id}/files`, SAMPLE_FILES.pdf(), { name: 'internal.pdf' })).body;
    expect((await as.Contact.get(P(`/files/${internal.id}`))).status).toBe(404);
    expect((await as.Contact.get(P(`/files/${internal.id}/versions/1/url`))).status).toBe(404);
  });

  it('FR-COM-03: internal users can mention contacts only in Client comments; the contact gets a portal link', async () => {
    expect((await as.PM.post('/api/v1/comments', { entity_type: 'Task', entity_id: shared.id, body: '<p>@Maya</p>', mention_contact_ids: [W.contacts.maya.id] })).status).toBe(422);
    const ok = await as.PM.post('/api/v1/comments', { entity_type: 'Task', entity_id: shared.id, body: '<p>@Maya please check</p>', visibility: 'Client', mention_contact_ids: [W.contacts.maya.id] });
    expect(ok.status).toBe(201);
    const n = await db.notification.findFirst({ where: { contact_id: W.contacts.maya.id, type: 'mentioned', channel: 'Email' }, orderBy: { created_at: 'desc' } });
    expect(n.payload.link).toBe(`/portal/projects/${A.id}?task=${shared.id}&comment=${ok.body.id}`);
    expect(n.payload.reply_to).toBe(W.users.pm.email); // BR-NOT-02
    const picker = (await as.PM.get(`/api/v1/comments/mentionable?entity_type=Task&entity_id=${shared.id}`)).body;
    expect(picker.contacts.map((c) => c.full_name).sort()).toEqual(['Ali', 'Maya']);
  });
});

describe('contact portal access (FR-CON-03/05, BR-CLI-04)', () => {
  it('invite → Invited with a branded email replying to the inviter → set password → Active and signed in', async () => {
    const c = await W.addContact({ portalAccess: false, status: 'NotInvited' });
    sendMail.mockClear();
    const res = await as.PM.post(`/api/v1/contacts/${c.id}/invite`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ contact: { portal_access: true, status: 'Invited' }, email_sent: true });
    const mail = sendMail.mock.calls.at(-1)[0];
    expect(mail).toMatchObject({ to: c.email, replyTo: W.users.pm.email });
    expect(mail.html).toContain('background:#2563EB');
    expect(mail.text).not.toMatch(/Claude|CPMP|vendor/i);
    const { token } = tokenFromLastMail(sendMail, '/accept-invite');
    const anon = await client(app);
    const accepted = await anon.post('/api/v1/auth/invitations/accept', { token, password: 'Portal-pass-2026!' });
    expect(accepted.status).toBe(200);
    expect((await db.clientContact.findUnique({ where: { id: c.id } })).status).toBe('Active');
    // Team Members and Finance cannot invite
    expect((await as.TeamMember.post(`/api/v1/contacts/${c.id}/invite`)).status).toBe(403);
    expect((await as.Finance.post(`/api/v1/contacts/${c.id}/invite`)).status).toBe(403);
  });

  it('revoking access ends sessions at once and keeps the record; restoring needs no new password', async () => {
    const c = await W.addContact({});
    await db.projectMember.create({ data: { workspace_id: W.workspace.id, project_id: A.id, contact_id: c.id, portal_level: 'View' } });
    const her = await loginAs(app, c.email);
    expect((await her.get(P('/home'))).status).toBe(200);
    expect((await as.PM.post(`/api/v1/contacts/${c.id}/revoke-portal`)).body.contact.portal_access).toBe(false);
    expect((await her.get(P('/home'))).status).toBe(401);
    const again = await (await client(app)).post('/api/v1/auth/login', { email: c.email, password: process.env.SEED_PASSWORD });
    expect(again.status).toBe(403);
    expect(await db.clientContact.findUnique({ where: { id: c.id } })).not.toBeNull();
    expect((await as.PM.post(`/api/v1/contacts/${c.id}/restore-portal`)).body.contact.portal_access).toBe(true);
    expect((await loginAs(app, c.email)).csrf).toBeTruthy();
    const [entry] = await auditEntries('contact.portal_revoked', { entity_id: c.id });
    expect(entry.after).toEqual({ portal_access: false });
  });

  it("BR-CLI-04: contacts of an archived client can't be invited", async () => {
    const archived = await db.client.create({ data: { workspace_id: W.workspace.id, name: 'Gone Co', name_normalized: 'gone co', code_prefix: 'GNC', currency: 'JOD', status: 'Archived', archived_at: new Date() } });
    const c = await W.addContact({ clientId: archived.id, portalAccess: false, status: 'NotInvited' });
    expect((await as.PM.post(`/api/v1/contacts/${c.id}/invite`)).status).toBe(409);
  });
});

describe('personal data (NFR-PRIV-02)', () => {
  it('Owner/Admin export everything held about a contact; others get 403', async () => {
    const res = await as.Admin.get(`/api/v1/contacts/${W.contacts.maya.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body.contact).toMatchObject({ email: W.contacts.maya.email, full_name: 'Maya' });
    expect(res.body.comments.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('sessions');
    expect((await as.PM.get(`/api/v1/contacts/${W.contacts.maya.id}/export`)).status).toBe(403);
  });

  it('anonymising replaces personal data, ends access, and keeps comments under the new name', async () => {
    const c = await W.addContact({});
    await db.projectMember.create({ data: { workspace_id: W.workspace.id, project_id: A.id, contact_id: c.id, portal_level: 'Comment' } });
    const her = await loginAs(app, c.email);
    const comment = (await her.post(P('/comments'), { entity_type: 'Task', entity_id: shared.id, body: '<p>Please hurry</p>' })).body;
    expect((await as.Admin.post(`/api/v1/contacts/${c.id}/anonymise`, { confirm_name: 'wrong' })).status).toBe(422);
    const res = await as.Admin.post(`/api/v1/contacts/${c.id}/anonymise`, { confirm_name: c.full_name });
    expect(res.status).toBe(200);
    const after = await db.clientContact.findUnique({ where: { id: c.id } });
    expect(after).toMatchObject({ phone: null, password_hash: null, portal_access: false, notification_prefs: null });
    expect(after.email).toMatch(/@anonymised\.invalid$/);
    expect(after.full_name).toMatch(/^Former contact /);
    expect(after.anonymised_at).not.toBeNull();
    expect((await her.get(P('/home'))).status).toBe(401);
    const list = (await as.PM.get(`/api/v1/comments?entity_type=Task&entity_id=${shared.id}&page_size=100`)).body.data;
    expect(list.find((x) => x.id === comment.id).author.full_name).toBe(after.full_name);
    expect((await as.PM.post(`/api/v1/contacts/${c.id}/anonymise`, { confirm_name: after.full_name })).status).toBe(403);
    expect((await as.Admin.post(`/api/v1/contacts/${c.id}/invite`)).status).toBe(409);
  });
});

describe('contact notifications (FR-NOT-01/03)', () => {
  it('contacts have their own bell and settings, with approval emails on by default', async () => {
    const prefs = (await as.Contact.get(P('/notification-preferences'))).body.preferences;
    expect(prefs).toEqual({ approval_requested: 'email', approval_reminder: 'email', mentioned: 'email', comment_on_followed: 'in_app', followed_task_status: 'in_app' });
    expect((await as.Contact.put(P('/notification-preferences'), { mentioned: 'off' })).body.preferences.mentioned).toBe('off');
    expect((await as.Contact.put(P('/notification-preferences'), { project_status: 'off' })).status).toBe(422);
    const bell = (await as.Contact.get(P('/notifications'))).body;
    expect(bell).toMatchObject({ data: expect.any(Array), unread: expect.any(Number) });
    expect(bell.data.every((n) => !n.link || n.link.startsWith('/portal/'))).toBe(true);
    await as.Contact.put(P('/notification-preferences'), { mentioned: 'email' });
  });
});
