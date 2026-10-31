// Phase 4 security review (NFR-SEC-02/03/05): IDOR, mass assignment, stored XSS and
// security headers, across every endpoint that takes a record id or a body.
// Results are summarised in docs/SECURITY-REVIEW.md.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FILES, apiCreateClient } from '../../test/helpers.js';
import { createWorld } from '../../test/fixtures.js';

vi.mock('../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../app.js');
const { db } = await import('../lib/db.js');

const app = createApp();
let W; // the victim workspace
let as;
let R; // records of W that attackers try to reach
let stranger; // Owner of another workspace
let outsider; // Team Member of W who is not on Project A
let otherClient; // contact of another client of W

beforeAll(async () => {
  W = await createWorld('Security');
  as = await W.loginAll(app);
  const A = W.projects.A;
  const task = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Secret task', assignee_ids: [W.users.member.id] })).body;
  const item = (await as.PM.post(`/api/v1/tasks/${task.id}/checklist`, { text: 'Step' })).body;
  const milestone = (await as.PM.post(`/api/v1/projects/${A.id}/milestones`, { title: 'Secret milestone', due_date: '2026-12-01' })).body.milestone;
  const file = (await as.PM.upload(`/api/v1/projects/${A.id}/files`, SAMPLE_FILES.pdf(), { name: 'secret.pdf' })).body;
  const folder = (await as.PM.post(`/api/v1/projects/${A.id}/folders`, { name: 'Secret folder' })).body;
  const comment = (await as.PM.post('/api/v1/comments', { entity_type: 'Task', entity_id: task.id, body: '<p>Secret</p>' })).body;
  const members = (await as.PM.get(`/api/v1/projects/${A.id}/members`)).body.data;
  const template = (await as.PM.post('/api/v1/templates', { project_id: A.id, name: `Secret template ${Date.now()}` })).body;
  const [notification] = await db.notification.findMany({ where: { user_id: W.users.member.id, channel: 'InApp' }, take: 1 });
  R = { A, task, item, milestone, file, folder, comment, member: members.find((m) => m.kind === 'user'), template, notification, client: W.clients.nova, contact: W.contacts.maya, user: W.users.member };

  const other = await createWorld('Security other');
  stranger = await other.login(app, 'owner');
  outsider = as.TeamMember2;
  otherClient = await W.login(app, 'omarN');
});

/** Every route that takes an id of W's records, with a plausible body. */
const routes = () => [
  ['get', `/api/v1/projects/${R.A.id}`],
  ['patch', `/api/v1/projects/${R.A.id}`, { name: 'Hacked', version: 1 }],
  ['delete', `/api/v1/projects/${R.A.id}`],
  ['post', `/api/v1/projects/${R.A.id}/status`, { status: 'OnHold', version: 1 }],
  ['post', `/api/v1/projects/${R.A.id}/archive`],
  ['post', `/api/v1/projects/${R.A.id}/duplicate`, { name: 'Copy' }],
  ['get', `/api/v1/projects/${R.A.id}/activity`],
  ['get', `/api/v1/projects/${R.A.id}/members`],
  ['post', `/api/v1/projects/${R.A.id}/members`, { user_id: W.users.member2.id }],
  ['patch', `/api/v1/projects/${R.A.id}/members/${R.member.id}`, { project_role: 'PM' }],
  ['delete', `/api/v1/projects/${R.A.id}/members/${R.member.id}`],
  ['get', `/api/v1/projects/${R.A.id}/milestones`],
  ['post', `/api/v1/projects/${R.A.id}/milestones`, { title: 'X', due_date: '2026-12-01' }],
  ['patch', `/api/v1/milestones/${R.milestone.id}`, { title: 'Hacked', version: 1 }],
  ['post', `/api/v1/milestones/${R.milestone.id}/complete`],
  ['delete', `/api/v1/milestones/${R.milestone.id}`],
  ['get', `/api/v1/projects/${R.A.id}/tasks`],
  ['post', `/api/v1/projects/${R.A.id}/tasks`, { title: 'Injected' }],
  ['get', `/api/v1/projects/${R.A.id}/labels`],
  ['get', `/api/v1/tasks/${R.task.id}`],
  ['patch', `/api/v1/tasks/${R.task.id}`, { description: '<p>x</p>', version: 1 }],
  ['delete', `/api/v1/tasks/${R.task.id}`],
  ['post', `/api/v1/tasks/${R.task.id}/status`, { status: 'InProgress', version: 1 }],
  ['put', `/api/v1/tasks/${R.task.id}/position`, { after_id: null }],
  ['post', `/api/v1/tasks/${R.task.id}/checklist`, { text: 'x' }],
  ['patch', `/api/v1/tasks/${R.task.id}/checklist/${R.item.id}`, { is_done: true, version: 1 }],
  ['delete', `/api/v1/tasks/${R.task.id}/checklist/${R.item.id}`],
  ['post', `/api/v1/tasks/bulk`, { task_ids: [R.task.id], action: 'delete' }, { bulk: true }],
  ['get', `/api/v1/projects/${R.A.id}/files`],
  ['get', `/api/v1/projects/${R.A.id}/folders`],
  ['post', `/api/v1/projects/${R.A.id}/folders`, { name: 'Injected' }],
  ['patch', `/api/v1/projects/${R.A.id}/folders/${R.folder.id}`, { name: 'Hacked', version: 1 }],
  ['delete', `/api/v1/projects/${R.A.id}/folders/${R.folder.id}`],
  ['get', `/api/v1/files/${R.file.id}`],
  ['patch', `/api/v1/files/${R.file.id}`, { name: 'hacked.pdf', version: 1 }],
  ['delete', `/api/v1/files/${R.file.id}`],
  ['get', `/api/v1/files/${R.file.id}/versions/1/url`],
  ['get', `/api/v1/comments?entity_type=Task&entity_id=${R.task.id}`],
  ['post', '/api/v1/comments', { entity_type: 'Task', entity_id: R.task.id, body: '<p>x</p>' }],
  ['patch', `/api/v1/comments/${R.comment.id}`, { body: '<p>x</p>', version: 1 }],
  ['delete', `/api/v1/comments/${R.comment.id}`],
  ['post', '/api/v1/follows', { entity_type: 'Task', entity_id: R.task.id }],
  ['post', `/api/v1/me/notifications/${R.notification.id}/read`],
  ['get', `/api/v1/clients/${R.client.id}`],
  ['patch', `/api/v1/clients/${R.client.id}`, { name: 'Hacked', version: 1 }],
  ['get', `/api/v1/clients/${R.client.id}/contacts`],
  ['patch', `/api/v1/contacts/${R.contact.id}`, { full_name: 'Hacked', version: 1 }],
  ['get', `/api/v1/users/${R.user.id}`],
  ['get', `/api/v1/templates/${R.template.id}`],
  ['delete', `/api/v1/templates/${R.template.id}`],
];

const send = (c, [method, url, body]) => (method === 'get' || method === 'delete' ? c[method](url) : c[method](url, body));

/** A fingerprint of everything an attacker could change. */
async function fingerprint() {
  const [p, t, f, c, m, cl, n, folders, tasks, comments] = await Promise.all([
    db.project.findUnique({ where: { id: R.A.id } }),
    db.task.findUnique({ where: { id: R.task.id } }),
    db.file.findUnique({ where: { id: R.file.id } }),
    db.comment.findUnique({ where: { id: R.comment.id } }),
    db.milestone.findUnique({ where: { id: R.milestone.id } }),
    db.client.findUnique({ where: { id: R.client.id } }),
    db.notification.findUnique({ where: { id: R.notification.id } }),
    db.fileFolder.count({ where: { project_id: R.A.id } }),
    db.task.count({ where: { project_id: R.A.id } }),
    db.comment.count({ where: { project_id: R.A.id } }),
  ]);
  return JSON.stringify([p.version, p.deleted_at, p.archived_at, t.version, t.deleted_at, f.version, f.deleted_at, c.version, c.deleted_at, m.version, m.deleted_at, cl.version, n.read_at, folders, tasks, comments]);
}

describe('IDOR (NFR-SEC-02): records cannot be reached by changing an id', () => {
  it('another workspace gets 404 on every route, and nothing changes', async () => {
    const before = await fingerprint();
    for (const r of routes()) {
      const res = await send(stranger, r);
      const ok = r[3]?.bulk ? res.status === 200 && res.body.succeeded === 0 : res.status === 404;
      expect(ok, `${r[0].toUpperCase()} ${r[1]} → ${res.status}`).toBe(true);
    }
    expect(await fingerprint()).toBe(before);
  });

  it('a Team Member who is not on the project never gets a 2xx (except reading the client, allowed by §4.2), and nothing changes', async () => {
    const before = await fingerprint();
    for (const r of routes()) {
      const res = await send(outsider, r);
      if (r[3]?.bulk) {
        expect(res.body.succeeded, r[1]).toBe(0);
        continue;
      }
      expect(res.status, `${r[0].toUpperCase()} ${r[1]} → ${res.status}`).toBeGreaterThanOrEqual(400);
    }
    expect(await fingerprint()).toBe(before);
  });

  it("another client's contact gets 404, never 403 (existence is not revealed, BR-CLI-01), and nothing changes", async () => {
    const before = await fingerprint();
    for (const r of routes()) {
      const res = await send(otherClient, r);
      if (r[3]?.bulk) continue; // internal route: 404 below
      expect(res.status, `${r[0].toUpperCase()} ${r[1]} → ${res.status}`).toBe(404);
    }
    expect((await otherClient.post('/api/v1/tasks/bulk', { task_ids: [R.task.id], action: 'delete' })).status).toBe(404);
    expect(await fingerprint()).toBe(before);
  });
});

describe('mass assignment (NFR-SEC-03): only whitelisted fields are accepted', () => {
  // [client, method, url, valid body, smuggled fields]
  const cases = () => [
    [as.PM, 'patch', `/api/v1/projects/${R.A.id}`, { name: 'Ok' }, { workspace_id: crypto.randomUUID(), progress_pct: 100, created_by: W.users.member.id, deleted_at: new Date().toISOString() }],
    [as.PM, 'post', `/api/v1/projects/${R.A.id}/tasks`, { title: 'Ok' }, { workspace_id: crypto.randomUUID(), project_id: W.projects.B.id, status: 'Done', created_by: W.users.member.id }],
    [as.TeamMember, 'patch', `/api/v1/tasks/${R.task.id}`, { description: '<p>Ok</p>' }, { project_id: W.projects.B.id, workspace_id: crypto.randomUUID() }],
    [as.PM, 'post', '/api/v1/comments', { entity_type: 'Task', entity_id: R.task.id, body: '<p>Ok</p>' }, { author_user_id: W.users.owner.id, created_at: '2020-01-01T00:00:00Z', project_id: W.projects.B.id }],
    [as.PM, 'patch', `/api/v1/files/${R.file.id}`, { name: 'ok.pdf' }, { project_id: W.projects.B.id, storage_key: 'x', created_by: W.users.member.id }],
    [as.PM, 'post', `/api/v1/projects/${R.A.id}/folders`, { name: 'Ok' }, { project_id: W.projects.B.id }],
    [as.Admin, 'patch', '/api/v1/workspace', { name: 'Ok' }, { storage_used_bytes: 0, id: crypto.randomUUID() }],
    [as.TeamMember, 'patch', '/api/v1/auth/me', { full_name: 'Omar' }, { role: 'Owner', status: 'Active', workspace_id: crypto.randomUUID() }],
    [as.TeamMember, 'put', '/api/v1/me/notification-preferences', { mentioned: 'email' }, { user_id: W.users.owner.id }],
    [as.PM, 'post', `/api/v1/clients`, { name: `Ok client ${Date.now()}` }, { workspace_id: crypto.randomUUID(), next_project_number: 999 }],
    [as.PM, 'post', '/api/v1/tasks/bulk', { task_ids: [R.task.id], action: 'status', status: 'InProgress' }, { workspace_id: crypto.randomUUID() }],
  ];

  it('every write endpoint refuses smuggled fields (422 unknown / 403 not allowed) and writes nothing', async () => {
    const before = await fingerprint();
    const ws = await db.workspace.findUnique({ where: { id: W.workspace.id } });
    const omar = await db.user.findUnique({ where: { id: W.users.member.id } });
    for (const [c, method, url, valid, smuggled] of cases()) {
      for (const [k, v] of Object.entries(smuggled)) {
        const res = await c[method](url, { ...valid, ...(valid.version === undefined && method === 'patch' ? {} : {}), [k]: v });
        expect([403, 422], `${method.toUpperCase()} ${url} with ${k} → ${res.status}`).toContain(res.status);
        expect(res.body.fields?.length ?? 0, `${url} ${k} names the field`).toBeGreaterThan(0);
      }
    }
    expect(await fingerprint()).toBe(before);
    expect((await db.workspace.findUnique({ where: { id: W.workspace.id } })).storage_used_bytes).toBe(ws.storage_used_bytes);
    expect(await db.user.findUnique({ where: { id: W.users.member.id } })).toMatchObject({ role: omar.role, status: omar.status, workspace_id: omar.workspace_id });
  });
});

describe('stored XSS (NFR-SEC-02, TC-COM-002)', () => {
  const payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>', '<svg onload=alert(1)>', '<iframe src="https://evil.test"></iframe>', '<p style="background:url(javascript:alert(1))">x</p>'];

  it('rich text (task descriptions, comments) keeps no script, handler, javascript: link or frame', async () => {
    for (const p of payloads) {
      const c = await as.PM.post('/api/v1/comments', { entity_type: 'Task', entity_id: R.task.id, body: `<p>ok</p>${p}` });
      expect(c.status).toBe(201);
      expect(c.body.body).not.toMatch(/<script|onerror|onload|javascript:|<iframe|<svg|style=/i);
      const t = (await as.PM.get(`/api/v1/tasks/${R.task.id}`)).body;
      const u = await as.PM.patch(`/api/v1/tasks/${R.task.id}`, { description: `<p>ok</p>${p}`, version: t.version });
      expect(u.body.description ?? '').not.toMatch(/<script|onerror|onload|javascript:|<iframe|<svg|style=/i);
    }
  });

  it('plain-text fields are stored as given and only ever returned as JSON (React escapes them)', async () => {
    const res = await as.PM.post(`/api/v1/projects/${R.A.id}/tasks`, { title: '<script>alert(1)</script>' });
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const search = await as.PM.get(`/api/v1/search?q=${encodeURIComponent('<script>')}`);
    expect(search.headers['content-type']).toMatch(/^application\/json/);
  });
});

describe('security headers (NFR-SEC-05)', () => {
  it('every API response carries CSP, X-Frame-Options DENY, nosniff and no-store', async () => {
    for (const url of ['/api/v1/health', '/api/v1/projects', `/api/v1/files/${crypto.randomUUID()}`]) {
      const res = await as.PM.get(url);
      expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
    expect((await as.PM.get('/api/v1/projects')).headers['cache-control']).toBe('no-store');
  });

  it('client creation is still possible for allowed roles (sanity check for the suite)', async () => {
    expect((await apiCreateClient(as.PM)).id).toBeTruthy();
  });
});
