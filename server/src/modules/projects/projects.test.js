// API tests for projects and members: FR-PRJ-01, 04…11, BR-PRJ-01…05, BRD 16.1,
// D-12, D-14, D-19, TC-PRJ-001…008, deferred TC-ROLE-002…004.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { apiCreateClient, apiCreateProject, auditEntries, client, loginAs } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');
const { purgeDeletedProjects } = await import('../../jobs/purgeDeletedProjects.js');

const app = createApp();
let W; // E-01: this file's own workspace
const as = {};
let nova;
let bright;
let lina;
let omar;
let projectA;
let projectB;

beforeAll(async () => {
  W = await createWorld('Projects');
  Object.assign(as, await W.loginAll(app));
  as.Anonymous = await client(app);
  nova = W.clients.nova;
  bright = W.clients.bright;
  lina = W.users.pm;
  omar = W.users.member;
  projectA = W.projects.A;
  projectB = W.projects.B;
});

const base = () => ({ name: `Project ${randomUUID().slice(0, 8)}`, start_date: '2026-10-01', billing_type: 'Fixed' });

// ---------------------------------------------------------------------------
describe('create (FR-PRJ-01)', () => {
  it('TC-PRJ-001: a PM creates a project → 201, code NOV-002, Not Started, PM and creator are members, listed', async () => {
    const res = await as.PM.post('/api/v1/projects', { ...base(), client_id: nova.id, pm_user_id: lina.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'NOV-002', status: 'NotStarted', progress_pct: 0, pm: { id: lina.id } });
    const members = await db.projectMember.findMany({ where: { project_id: res.body.id } });
    expect(members).toEqual([expect.objectContaining({ user_id: lina.id, project_role: 'PM' })]);
    const list = await as.PM.get('/api/v1/projects?q=NOV-002');
    expect(list.body.data.map((p) => p.id)).toContain(res.body.id);
    const [entry] = await auditEntries('project.created', { entity_id: res.body.id });
    expect(entry).toMatchObject({ project_id: res.body.id, client_id: nova.id });
  });

  it('the creator becomes a member when someone else is the PM', async () => {
    const res = await as.Admin.post('/api/v1/projects', { ...base(), client_id: nova.id, pm_user_id: lina.id });
    const roles = (await db.projectMember.findMany({ where: { project_id: res.body.id }, include: { user: true } })).map((m) => [m.user.email, m.project_role]);
    expect(roles).toEqual(expect.arrayContaining([[W.users.pm.email, 'PM'], [W.users.admin.email, 'Member']]));
  });

  it('TC-PRJ-002: due date before start date → 422, no record', async () => {
    const name = `Backwards ${randomUUID().slice(0, 6)}`;
    const res = await as.PM.post('/api/v1/projects', { ...base(), name, client_id: nova.id, pm_user_id: lina.id, start_date: '2026-11-10', due_date: '2026-11-01' });
    expect(res.status).toBe(422);
    expect(res.body.fields).toContainEqual({ field: 'due_date', message: 'Due date cannot be before start date' });
    expect(await db.project.findFirst({ where: { name } })).toBeNull();
  });

  it('TC-PRJ-003: a blank name → 422, no record', async () => {
    const before = await db.project.count({ where: { workspace_id: W.workspace.id } });
    const res = await as.PM.post('/api/v1/projects', { ...base(), name: '  ', client_id: nova.id, pm_user_id: lina.id });
    expect(res.status).toBe(422);
    expect(await db.project.count({ where: { workspace_id: W.workspace.id } })).toBe(before);
  });

  it('BR-PRJ-01 / D-12: names are unique per client, case-insensitive; another client may reuse it', async () => {
    const name = `Shared Name ${randomUUID().slice(0, 6)}`;
    await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id, name });
    const dup = await as.Admin.post('/api/v1/projects', { ...base(), name: name.toUpperCase(), client_id: nova.id, pm_user_id: lina.id });
    expect(dup.status).toBe(409);
    expect((await as.Admin.post('/api/v1/projects', { ...base(), name, client_id: bright.id, pm_user_id: lina.id })).status).toBe(201);
  });

  it('D-19: the PM must be an active PM, Admin or Owner', async () => {
    const tm = await as.Admin.post('/api/v1/projects', { ...base(), client_id: nova.id, pm_user_id: omar.id });
    expect(tm.status).toBe(422);
    expect(tm.body.fields[0].field).toBe('pm_user_id');
    const inactive = await W.addUser({ role: 'PM', status: 'Deactivated' });
    expect((await as.Admin.post('/api/v1/projects', { ...base(), client_id: nova.id, pm_user_id: inactive.id })).status).toBe(422);
    const admin = W.users.admin;
    expect((await as.Admin.post('/api/v1/projects', { ...base(), client_id: nova.id, pm_user_id: admin.id })).status).toBe(201);
  });

  it('BR-PRJ-05 / D-22: only Active clients get projects (not Lead, Inactive or Archived)', async () => {
    for (const status of ['Lead', 'Inactive']) {
      const c = await apiCreateClient(as.Admin, { status });
      expect((await as.Admin.post('/api/v1/projects', { ...base(), client_id: c.id, pm_user_id: lina.id })).status).toBe(409);
    }
  });

  it('concurrent creates for one client get distinct, sequential codes', async () => {
    const c = await apiCreateClient(as.Admin);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => as.Admin.post('/api/v1/projects', { ...base(), client_id: c.id, pm_user_id: lina.id })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const codes = results.map((r) => r.body.code).sort();
    expect(codes).toEqual([1, 2, 3, 4, 5].map((n) => `${c.code_prefix}-00${n}`));
  });

  it('TC-ROLE-003: a Team Member POST /projects → 403 and no record', async () => {
    const name = `Nope ${randomUUID().slice(0, 6)}`;
    const res = await as.TeamMember.post('/api/v1/projects', { ...base(), name, client_id: nova.id, pm_user_id: lina.id });
    expect(res.status).toBe(403);
    expect(await db.project.findFirst({ where: { name } })).toBeNull();
    expect((await as.Finance.post('/api/v1/projects', { ...base(), client_id: nova.id, pm_user_id: lina.id })).status).toBe(403);
    expect((await as.Contact.post('/api/v1/projects', { ...base(), client_id: nova.id, pm_user_id: lina.id })).status).toBe(404);
    expect((await as.Anonymous.post('/api/v1/projects', { ...base(), client_id: nova.id, pm_user_id: lina.id })).status).toBe(401);
  });

  it('TC-ROLE-002: Lina-style PM demoted to Team Member gets 403 creating a project on the next request', async () => {
    const pm = await W.addUser({ role: 'PM' });
    const pmClient = await loginAs(app, pm.email);
    expect((await pmClient.post('/api/v1/projects', { ...base(), client_id: nova.id, pm_user_id: pm.id })).status).toBe(201);
    const fresh = await db.user.findUniqueOrThrow({ where: { id: pm.id } });
    expect((await as.Admin.patch(`/api/v1/users/${pm.id}`, { role: 'TeamMember', version: fresh.version })).status).toBe(200);
    expect((await pmClient.post('/api/v1/projects', { ...base(), client_id: nova.id, pm_user_id: lina.id })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('read and list (FR-PRJ-08, FR-PRJ-09, BR-CLI-01, BR-PRJ-04)', () => {
  it('Team Members list only their projects; Finance and Admin see all', async () => {
    const omarList = (await as.TeamMember.get('/api/v1/projects?page_size=100')).body.data.map((p) => p.code);
    expect(omarList).toContain('NOV-001');
    expect(omarList).not.toContain('BRI-001');
    const ranaList = (await as.TeamMember2.get('/api/v1/projects?page_size=100')).body.data.map((p) => p.code);
    expect(ranaList).toEqual(['BRI-001']);
    const finance = (await as.Finance.get('/api/v1/projects?page_size=100')).body;
    expect(finance.data.map((p) => p.code)).toEqual(expect.arrayContaining(['NOV-001', 'BRI-001']));
  });

  it('budgets are hidden from Team Members (finance data)', async () => {
    const pm = (await as.PM.get(`/api/v1/projects/${projectA.id}`)).body;
    expect(pm).toMatchObject({ budget_amount: 12_000_000, currency: 'JOD' });
    const tm = (await as.TeamMember.get(`/api/v1/projects/${projectA.id}`)).body;
    expect(tm).not.toHaveProperty('budget_amount');
    expect(tm.code).toBe('NOV-001');
  });

  it('a non-member Team Member gets 403; a contact gets 404 for another client\'s project', async () => {
    expect((await as.TeamMember.get(`/api/v1/projects/${projectB.id}`)).status).toBe(403);
    expect((await as.Contact.get(`/api/v1/projects/${projectA.id}`)).status).toBe(200); // own, portal-enabled, member
    expect((await as.Contact.get(`/api/v1/projects/${projectB.id}`)).status).toBe(404);
    expect((await as.Contact.get('/api/v1/projects?page_size=100')).body.data.map((p) => p.code)).toEqual(['NOV-001']);
  });

  it('a PM who is not a member cannot read the project', async () => {
    const other = await W.addUser({ role: 'PM' });
    const c = await loginAs(app, other.email);
    expect((await c.get(`/api/v1/projects/${projectA.id}`)).status).toBe(403);
  });

  it('filters by client, status and overdue; searches by code; paginates', async () => {
    const byClient = (await as.Admin.get(`/api/v1/projects?client_id=${bright.id}&page_size=100`)).body.data;
    expect(byClient.every((p) => p.client.id === bright.id)).toBe(true);
    const inProgress = (await as.Admin.get('/api/v1/projects?status=InProgress&page_size=100')).body.data;
    expect(inProgress.every((p) => p.status === 'InProgress')).toBe(true);
    const page = await as.Admin.get('/api/v1/projects?page_size=2&sort=code&order=asc');
    expect(page.body.data).toHaveLength(2);
    expect(page.body.total).toBeGreaterThan(2);

    const late = await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id, start_date: '2025-01-01', due_date: '2025-02-01' });
    const overdue = (await as.Admin.get('/api/v1/projects?overdue=true&page_size=100')).body.data;
    expect(overdue.map((p) => p.id)).toContain(late.id);
    expect(overdue.find((p) => p.id === late.id).is_overdue).toBe(true);
  });

  it('detail carries task and milestone summaries and the allowed transitions', async () => {
    const res = await as.PM.get(`/api/v1/projects/${projectA.id}`);
    expect(res.body.task_summary).toMatchObject({ ToDo: expect.any(Number), Done: expect.any(Number) });
    expect(res.body.allowed_transitions).toEqual(['OnHold', 'Completed', 'Cancelled']);
    expect(res.body.permissions).toMatchObject({ update: true, delete: false, manage_members: true });
  });
});

// ---------------------------------------------------------------------------
describe('edit (FR-PRJ-04) and PM change (FR-PRJ-05)', () => {
  it('edits fields with optimistic locking and audits before/after', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: nova.id });
    const res = await as.PM.patch(`/api/v1/projects/${p.id}`, { due_date: '2026-12-31', budget_amount: 5000, version: p.version });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ due_date: '2026-12-31', budget_amount: 5000 });
    const [entry] = await auditEntries('project.updated', { entity_id: p.id });
    expect(entry.after).toMatchObject({ due_date: '2026-12-31', budget_amount: 5000 });
    expect((await as.PM.patch(`/api/v1/projects/${p.id}`, { name: 'Stale', version: p.version })).status).toBe(409);
  });

  it('BR-PRJ-02 also applies when only one date changes', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: nova.id, start_date: '2026-11-10' });
    expect((await as.PM.patch(`/api/v1/projects/${p.id}`, { due_date: '2026-11-01', version: p.version })).status).toBe(422);
  });

  it('TC-PRJ-007: the client cannot change once time entries exist', async () => {
    const p = await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id });
    await db.timeEntry.create({ data: { workspace_id: nova.workspace_id, user_id: lina.id, project_id: p.id, date: new Date('2026-10-02'), duration_minutes: 60, is_billable: true } });
    const res = await as.Admin.patch(`/api/v1/projects/${p.id}`, { client_id: bright.id, version: p.version });
    expect(res.status).toBe(409);
  });

  it('changing the PM keeps the old PM as a member and makes the new one PM', async () => {
    const p = await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id });
    const admin = W.users.admin;
    const res = await as.Admin.patch(`/api/v1/projects/${p.id}`, { pm_user_id: admin.id, version: p.version });
    expect(res.status).toBe(200);
    const roles = Object.fromEntries((await db.projectMember.findMany({ where: { project_id: p.id } })).map((m) => [m.user_id, m.project_role]));
    expect(roles).toMatchObject({ [lina.id]: 'Member', [admin.id]: 'PM' });
    expect(await auditEntries('project.pm_changed', { entity_id: p.id })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('status lifecycle (FR-PRJ-06, BRD 16.1, BR-PRJ-03, BR-PRJ-05)', () => {
  const setStatus = (c, p, status) => c.post(`/api/v1/projects/${p.id}/status`, { status, version: p.version });

  it('follows the allowed transitions and rejects the rest with 409 "Transition not allowed"', async () => {
    let p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: nova.id });
    const skip = await setStatus(as.PM, p, 'Completed');
    expect(skip.status).toBe(409);
    expect(skip.body).toMatchObject({ code: 'TRANSITION_NOT_ALLOWED', message: 'Transition not allowed' });
    for (const next of ['InProgress', 'OnHold', 'InProgress', 'Completed']) {
      const res = await setStatus(as.PM, p, next);
      expect(res.status, next).toBe(200);
      p = res.body;
    }
    expect(p).toMatchObject({ status: 'Completed', progress_pct: 100 });
    const reopened = await setStatus(as.PM, p, 'InProgress');
    expect(reopened.body).toMatchObject({ status: 'InProgress', completed_at: null });
    expect(await auditEntries('project.reopened', { entity_id: p.id })).toHaveLength(1);
    const cancelled = (await setStatus(as.PM, reopened.body, 'Cancelled')).body;
    expect((await setStatus(as.PM, cancelled, 'InProgress')).status).toBe(409);
  });

  it('TC-PRJ-005: Completed with one open task → 409 listing the task', async () => {
    let p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: nova.id });
    p = (await setStatus(as.PM, p, 'InProgress')).body;
    await db.task.create({ data: { workspace_id: nova.workspace_id, project_id: p.id, title: 'Write copy' } });
    const res = await setStatus(as.PM, p, 'Completed');
    expect(res.status).toBe(409);
    expect(res.body.fields).toContainEqual({ field: 'tasks', message: 'Write copy' });
  });

  it('Completed also needs every milestone completed', async () => {
    let p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: nova.id });
    p = (await setStatus(as.PM, p, 'InProgress')).body;
    await as.PM.post(`/api/v1/projects/${p.id}/milestones`, { title: 'Launch', due_date: '2026-12-01' });
    const res = await setStatus(as.PM, p, 'Completed');
    expect(res.status).toBe(409);
    expect(res.body.fields).toContainEqual({ field: 'milestones', message: 'Launch' });
  });

  it('a Team Member cannot change status', async () => {
    const fresh = await db.project.findUniqueOrThrow({ where: { id: projectA.id } });
    expect((await as.TeamMember.post(`/api/v1/projects/${projectA.id}/status`, { status: 'OnHold', version: fresh.version })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('archive, delete, restore, purge (FR-PRJ-10, FR-PRJ-11)', () => {
  async function completedProject() {
    let p = await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id });
    for (const s of ['InProgress', 'Completed']) p = (await as.Admin.post(`/api/v1/projects/${p.id}/status`, { status: s, version: p.version })).body;
    return p;
  }

  it('only Completed or Cancelled projects can be archived; archived projects are read-only and hidden', async () => {
    const open = await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id });
    expect((await as.Admin.post(`/api/v1/projects/${open.id}/archive`)).status).toBe(409);

    const p = await completedProject();
    const archived = await as.Admin.post(`/api/v1/projects/${p.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.archived_at).not.toBeNull();
    expect((await as.Admin.patch(`/api/v1/projects/${p.id}`, { name: 'Changed', version: archived.body.version })).status).toBe(409);
    expect((await as.Admin.post(`/api/v1/projects/${p.id}/milestones`, { title: 'X', due_date: '2026-12-01' })).status).toBe(409);
    expect((await as.Admin.get('/api/v1/projects?page_size=100')).body.data.map((x) => x.id)).not.toContain(p.id);
    expect((await as.Admin.get('/api/v1/projects?archived=only&page_size=100')).body.data.map((x) => x.id)).toContain(p.id);
    expect((await as.Admin.post(`/api/v1/projects/${p.id}/unarchive`)).body.archived_at).toBeNull();
  });

  it('TC-ROLE-004: Team Member and PM DELETE → 403; the project is unchanged', async () => {
    expect((await as.TeamMember.delete(`/api/v1/projects/${projectA.id}`).send({ confirm_name: projectA.name })).status).toBe(403);
    expect((await as.PM.delete(`/api/v1/projects/${projectA.id}`).send({ confirm_name: projectA.name })).status).toBe(403);
    expect((await db.project.findUniqueOrThrow({ where: { id: projectA.id } })).deleted_at).toBeNull();
  });

  it('TC-PRJ-006: deleting a project with time entries → 409 suggesting Archive', async () => {
    const p = await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id });
    await db.timeEntry.create({ data: { workspace_id: nova.workspace_id, user_id: lina.id, project_id: p.id, date: new Date('2026-10-02'), duration_minutes: 30, is_billable: false } });
    const res = await as.Admin.delete(`/api/v1/projects/${p.id}`).send({ confirm_name: p.name });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Archive it instead/);
  });

  it('needs the typed name, soft-deletes, shows in the trash, restores within 30 days', async () => {
    const p = await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id });
    expect((await as.Admin.delete(`/api/v1/projects/${p.id}`).send({ confirm_name: 'wrong' })).status).toBe(422);
    expect((await as.Admin.delete(`/api/v1/projects/${p.id}`).send({ confirm_name: p.name })).status).toBe(204);
    expect((await as.Admin.get(`/api/v1/projects/${p.id}`)).status).toBe(404);
    const trash = (await as.Admin.get('/api/v1/projects?deleted=true&page_size=100')).body.data.map((x) => x.id);
    expect(trash).toContain(p.id);
    expect((await as.PM.get('/api/v1/projects?deleted=true')).status).toBe(403);
    const restored = await as.Admin.post(`/api/v1/projects/${p.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.deleted_at).toBeNull();
  });

  it('a deleted project frees its name; restoring it then conflicts', async () => {
    const p = await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id });
    await as.Admin.delete(`/api/v1/projects/${p.id}`).send({ confirm_name: p.name });
    await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id, name: p.name });
    expect((await as.Admin.post(`/api/v1/projects/${p.id}/restore`)).status).toBe(409);
  });

  it('the nightly job removes projects deleted more than 30 days ago and keeps newer ones', async () => {
    const old = await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id });
    const recent = await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id });
    for (const p of [old, recent]) await as.Admin.delete(`/api/v1/projects/${p.id}`).send({ confirm_name: p.name });
    await db.project.update({ where: { id: old.id }, data: { deleted_at: new Date(Date.now() - 31 * 86_400_000) } });
    expect((await as.Admin.post(`/api/v1/projects/${old.id}/restore`)).status).toBe(409); // too late
    const removed = await purgeDeletedProjects();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await db.project.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.project.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await auditEntries('project.purged', { entity_id: old.id })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('members (FR-PRJ-05, D-14, BR-ROLE-07)', () => {
  it('TC-PRJ-008: adding Omar twice keeps one membership', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: nova.id });
    const first = await as.PM.post(`/api/v1/projects/${p.id}/members`, { user_id: omar.id });
    const second = await as.PM.post(`/api/v1/projects/${p.id}/members`, { user_id: omar.id });
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(await db.projectMember.count({ where: { project_id: p.id, user_id: omar.id } })).toBe(1);
  });

  it("D-14: a PM who is a member but not the project's PM cannot manage members", async () => {
    const p = await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: nova.id }); // PM is Lina
    const otherPm = await W.addUser({ role: 'PM' });
    await as.Admin.post(`/api/v1/projects/${p.id}/members`, { user_id: otherPm.id });
    const c = await loginAs(app, otherPm.email);
    expect((await c.get(`/api/v1/projects/${p.id}`)).status).toBe(200);
    expect((await c.post(`/api/v1/projects/${p.id}/members`, { user_id: omar.id })).status).toBe(403);
    expect((await as.PM.post(`/api/v1/projects/${p.id}/members`, { user_id: omar.id })).status).toBe(201);
  });

  it('contacts join with a portal level (default View) and must belong to the project client', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: nova.id });
    const maya = W.contacts.maya;
    const added = await as.PM.post(`/api/v1/projects/${p.id}/members`, { contact_id: maya.id });
    expect(added.body).toMatchObject({ kind: 'contact', portal_level: 'View' });
    const changed = await as.PM.patch(`/api/v1/projects/${p.id}/members/${added.body.id}`, { portal_level: 'Approve' });
    expect(changed.body.portal_level).toBe('Approve');
    const brightContact = W.contacts.omarN;
    expect((await as.PM.post(`/api/v1/projects/${p.id}/members`, { contact_id: brightContact.id })).status).toBe(422);
    expect((await as.PM.post(`/api/v1/projects/${p.id}/members`, { user_id: omar.id, portal_level: 'View' })).status).toBe(422);
  });

  it('BR-ROLE-07: removing a member removes access on the next request; the PM cannot be removed', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: nova.id });
    const rana = W.users.member2;
    const m = (await as.PM.post(`/api/v1/projects/${p.id}/members`, { user_id: rana.id })).body;
    expect((await as.TeamMember2.get(`/api/v1/projects/${p.id}`)).status).toBe(200);
    expect((await as.PM.delete(`/api/v1/projects/${p.id}/members/${m.id}`)).status).toBe(204);
    expect((await as.TeamMember2.get(`/api/v1/projects/${p.id}`)).status).toBe(403);

    const pmMember = await db.projectMember.findFirstOrThrow({ where: { project_id: p.id, user_id: lina.id } });
    const res = await as.PM.delete(`/api/v1/projects/${p.id}/members/${pmMember.id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/new PM/);
  });

  it('contacts see member names only', async () => {
    const res = await as.Contact.get(`/api/v1/projects/${projectA.id}/members`);
    expect(res.status).toBe(200);
    for (const m of res.body.data) expect(Object.keys(m).sort()).toEqual(['full_name', 'id', 'kind']);
  });
});

// ---------------------------------------------------------------------------
describe('activity feed (FR-PRJ-08)', () => {
  it('lists project events newest first with actor names; Team Members see non-finance events', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: nova.id });
    await as.PM.post(`/api/v1/projects/${p.id}/status`, { status: 'InProgress', version: p.version });
    await as.PM.post(`/api/v1/projects/${p.id}/members`, { user_id: omar.id });
    const feed = await as.TeamMember.get(`/api/v1/projects/${p.id}/activity`);
    expect(feed.status).toBe(200);
    expect(feed.body.data.map((e) => e.action)).toEqual(['project.member_added', 'project.status_changed', 'project.created']);
    expect(feed.body.data[1]).toMatchObject({ actor: { name: 'Lina' }, before: { status: 'NotStarted' }, after: { status: 'InProgress' } });
    expect((await as.Finance.get(`/api/v1/projects/${p.id}/activity`)).body.data).toEqual([]);
  });
});

describe('unauthenticated', () => {
  it('401 on the project list', async () => {
    expect((await request(app).get('/api/v1/projects')).status).toBe(401);
  });
});

