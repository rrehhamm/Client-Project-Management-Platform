// API tests for milestones: FR-MS-01…03, BR-PRJ-06, D-20, TC-MS-001.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { apiCreateClient, apiCreateProject } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');
const { todayInTimeZone } = await import('@cpm/shared');

const app = createApp();
let W; // E-01: this file's own workspace
const as = {};
let nova;
let acme; // own client, so Nova Retail project codes stay predictable for TC-PRJ-001
let projectA;

beforeAll(async () => {
  W = await createWorld('Milestones');
  Object.assign(as, await W.loginAll(app));
  nova = W.clients.nova;
  projectA = W.projects.A;
  acme = await apiCreateClient(as.Admin, { name: `Acme Milestones ${Date.now()}` });
});

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const create = (c, projectId, body) => c.post(`/api/v1/projects/${projectId}/milestones`, body);

describe('create (FR-MS-01)', () => {
  it('needs a title and a due date', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: acme.id });
    const res = await create(as.PM, p.id, {});
    expect(res.status).toBe(422);
    expect(res.body.fields.map((f) => f.field).sort()).toEqual(['due_date', 'title']);
  });

  it('a due date outside the project dates is saved with a warning', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: acme.id, start_date: '2026-10-01', due_date: '2026-12-31' });
    const inside = await create(as.PM, p.id, { title: 'Design', due_date: '2026-11-01' });
    expect(inside.status).toBe(201);
    expect(inside.body.warnings).toEqual([]);
    const outside = await create(as.PM, p.id, { title: 'Late', due_date: '2027-03-01' });
    expect(outside.status).toBe(201);
    expect(outside.body.warnings).toEqual(["The milestone's due date is outside the project's dates"]);
    expect(outside.body.milestone).toMatchObject({ status: 'Upcoming', visibility: 'Internal', sort_order: 1 });
  });

  it('a Team Member cannot create milestones; a member can list them', async () => {
    expect((await create(as.TeamMember, projectA.id, { title: 'X', due_date: '2026-11-01' })).status).toBe(403);
    expect((await as.TeamMember.get(`/api/v1/projects/${projectA.id}/milestones`)).status).toBe(200);
  });
});

describe('amounts and budget (FR-MS-04, BR-PRJ-06)', () => {
  it('amounts only on Fixed projects', async () => {
    const hourly = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: acme.id, billing_type: 'Hourly' });
    const res = await create(as.PM, hourly.id, { title: 'Phase 1', due_date: '2026-11-01', amount: 1000 });
    expect(res.status).toBe(422);
    expect(res.body.fields[0].field).toBe('amount');
  });

  it('exceeding the budget needs confirmation', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: acme.id, budget_amount: 1_000_000 });
    expect((await create(as.PM, p.id, { title: 'A', due_date: '2026-11-01', amount: 600_000 })).status).toBe(201);
    const over = await create(as.PM, p.id, { title: 'B', due_date: '2026-11-15', amount: 500_000 });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('CONFIRMATION_REQUIRED');
    const confirmed = await create(as.PM, p.id, { title: 'B', due_date: '2026-11-15', amount: 500_000, confirm_over_budget: true });
    expect(confirmed.status).toBe(201);
  });

  it('Team Members do not see amounts', async () => {
    const list = (await as.TeamMember.get(`/api/v1/projects/${projectA.id}/milestones`)).body.data;
    for (const m of list) expect(m).not.toHaveProperty('amount');
  });
});

describe('status, overdue and completion (FR-MS-02, FR-MS-03, D-20)', () => {
  it('Overdue is computed in the workspace timezone and never stored', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: acme.id, start_date: '2026-01-01' });
    const yesterday = addDays(todayInTimeZone('Asia/Amman'), -1);
    const m = (await create(as.PM, p.id, { title: 'Past', due_date: yesterday })).body.milestone;
    expect(m).toMatchObject({ status: 'Upcoming', is_overdue: true });
    const row = await db.milestone.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.status).toBe('Upcoming');
    const done = await as.PM.post(`/api/v1/milestones/${m.id}/complete`);
    expect(done.body.milestone).toMatchObject({ status: 'Completed', is_overdue: false });
  });

  it('Upcoming → In Progress by edit; Completed only through /complete; reopening goes back to In Progress', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: acme.id });
    let m = (await create(as.PM, p.id, { title: 'Build', due_date: '2026-11-01' })).body.milestone;
    m = (await as.PM.patch(`/api/v1/milestones/${m.id}`, { status: 'InProgress', version: m.version })).body.milestone;
    expect(m.status).toBe('InProgress');
    expect((await as.PM.patch(`/api/v1/milestones/${m.id}`, { status: 'Completed', version: m.version })).status).toBe(422);
    m = (await as.PM.post(`/api/v1/milestones/${m.id}/complete`)).body.milestone;
    expect((await as.PM.post(`/api/v1/milestones/${m.id}/complete`)).status).toBe(409);
    const reopened = await as.PM.patch(`/api/v1/milestones/${m.id}`, { status: 'InProgress', version: m.version });
    expect(reopened.body.milestone).toMatchObject({ status: 'InProgress', completed_at: null });
  });

  it('TC-MS-001: a milestone with an open task cannot complete (409 listing it); after closing the task it can', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: acme.id });
    const m = (await create(as.PM, p.id, { title: 'Checkout', due_date: '2026-11-01' })).body.milestone;
    const task = await db.task.create({ data: { workspace_id: nova.workspace_id, project_id: p.id, milestone_id: m.id, title: 'Payment page' } });
    const blocked = await as.PM.post(`/api/v1/milestones/${m.id}/complete`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.fields).toEqual([{ field: 'tasks', message: 'Payment page' }]);
    await db.task.update({ where: { id: task.id }, data: { status: 'Done' } });
    expect((await as.PM.post(`/api/v1/milestones/${m.id}/complete`)).status).toBe(200);
  });
});

describe('order, visibility, delete', () => {
  it('reorders only with the complete list of milestones', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: acme.id });
    const a = (await create(as.PM, p.id, { title: 'A', due_date: '2026-11-01' })).body.milestone;
    const b = (await create(as.PM, p.id, { title: 'B', due_date: '2026-11-02' })).body.milestone;
    expect((await as.PM.put(`/api/v1/projects/${p.id}/milestones/order`, { ids: [b.id] })).status).toBe(422);
    const res = await as.PM.put(`/api/v1/projects/${p.id}/milestones/order`, { ids: [b.id, a.id] });
    expect(res.body.data.map((m) => m.title)).toEqual(['B', 'A']);
  });

  it('contacts see only Client-visible milestones (FR-PORT-02, BR-CLI-02)', async () => {
    const m = (await create(as.PM, projectA.id, { title: 'Shown to client', due_date: '2026-11-20', visibility: 'Client' })).body.milestone;
    const hidden = (await create(as.PM, projectA.id, { title: 'Internal only', due_date: '2026-11-21' })).body.milestone;
    expect((await as.Contact.get(`/api/v1/projects/${projectA.id}/milestones`)).status).toBe(404); // D-40
    const titles = (await as.Contact.get(`/api/v1/portal/projects/${projectA.id}`)).body.milestones.map((x) => x.title);
    expect(titles).toContain('Shown to client');
    expect(titles).not.toContain('Internal only');
    // Switching back to Internal hides it at once
    await as.PM.patch(`/api/v1/milestones/${m.id}`, { visibility: 'Internal', version: m.version });
    expect((await as.Contact.get(`/api/v1/portal/projects/${projectA.id}`)).body.milestones.map((x) => x.id)).not.toContain(m.id); // BR-CLI-02
    // A contact editing a milestone they cannot see gets 404
    expect((await as.Contact.patch(`/api/v1/milestones/${hidden.id}`, { title: 'x', version: hidden.version })).status).toBe(404);
  });

  it('deleting a milestone clears it from its tasks (BRD 5.2)', async () => {
    const p = await apiCreateProject(as.PM, { pmId: W.users.pm.id, clientId: acme.id });
    const m = (await create(as.PM, p.id, { title: 'Temp', due_date: '2026-11-01' })).body.milestone;
    const task = await db.task.create({ data: { workspace_id: nova.workspace_id, project_id: p.id, milestone_id: m.id, title: 'Linked' } });
    expect((await as.PM.delete(`/api/v1/milestones/${m.id}`)).status).toBe(204);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).milestone_id).toBeNull();
    expect((await as.PM.get(`/api/v1/projects/${p.id}/milestones`)).body.data).toEqual([]);
  });
});
