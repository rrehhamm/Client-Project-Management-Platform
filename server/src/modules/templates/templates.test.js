// API tests for templates and duplication: FR-PRJ-02/03/12, D-26.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { apiCreateProject } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');

const app = createApp();
let W;
let as;
let source; // a project with structure to copy

beforeAll(async () => {
  W = await createWorld('Templates');
  as = await W.loginAll(app);
  // Source project: starts 2026-10-01, milestone on day 30, tasks with subtask, checklist, dependency
  source = await apiCreateProject(as.PM, { clientId: W.clients.nova.id, pmId: W.users.pm.id, start_date: '2026-10-01', budget_amount: 500_000 });
  await as.PM.post(`/api/v1/projects/${source.id}/members`, { user_id: W.users.member.id });
  const ms = (await as.PM.post(`/api/v1/projects/${source.id}/milestones`, { title: 'Design done', due_date: '2026-10-31', amount: 200_000 })).body.milestone;
  const design = (await as.PM.post(`/api/v1/projects/${source.id}/tasks`, { title: 'Design', milestone_id: ms.id, start_date: '2026-10-02', due_date: '2026-10-10', estimate_minutes: 240, labels: ['ux'], assignee_ids: [W.users.member.id] })).body;
  await as.PM.post(`/api/v1/projects/${source.id}/tasks`, { title: 'Wireframes', parent_task_id: design.id });
  await as.PM.post(`/api/v1/tasks/${design.id}/checklist`, { text: 'Mood board' });
  const build = (await as.PM.post(`/api/v1/projects/${source.id}/tasks`, { title: 'Build', due_date: '2026-10-20' })).body;
  await as.PM.post(`/api/v1/tasks/${build.id}/dependencies`, { predecessor_id: design.id });
});

async function saveTemplate(c, name = `Website ${Math.random().toString(36).slice(2, 7)}`) {
  return c.post('/api/v1/templates', { project_id: source.id, name, description: 'Standard website' });
}

describe('save as template (FR-PRJ-03)', () => {
  it("a PM on the project saves its structure; counts include milestones, tasks (with subtasks) and members", async () => {
    const res = await saveTemplate(as.PM);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ billing_type: 'Fixed', source_project_id: source.id, counts: { milestones: 1, tasks: 3, members: 2 } });
    expect(res.body.milestones).toEqual([expect.objectContaining({ title: 'Design done', due_offset_days: 30 })]);
  });

  it('names are unique (case-insensitive)', async () => {
    const name = `Unique ${Date.now()}`;
    expect((await saveTemplate(as.PM, name)).status).toBe(201);
    expect((await saveTemplate(as.Admin, name.toUpperCase())).status).toBe(409);
  });

  it('only Owner/Admin and PMs who belong to the project (D-26)', async () => {
    const outsider = await W.addUser({ role: 'PM' });
    const c = await (await import('../../../test/helpers.js')).loginAs(app, outsider.email);
    expect((await saveTemplate(c)).status).toBe(403);
    expect((await saveTemplate(as.TeamMember)).status).toBe(403);
    expect((await saveTemplate(as.Finance)).status).toBe(403);
    expect((await as.TeamMember.get('/api/v1/templates')).status).toBe(403);
  });
});

describe('create from template (FR-PRJ-02)', () => {
  it('copies milestones, tasks, subtasks, checklists, dependencies and default members, shifted to the new start; no assignees', async () => {
    const tpl = (await saveTemplate(as.PM)).body;
    const res = await as.PM.post('/api/v1/projects', {
      client_id: W.clients.bright.id,
      name: `From template ${Date.now()}`,
      start_date: '2027-01-01',
      billing_type: 'Fixed',
      pm_user_id: W.users.pm.id,
      template_id: tpl.id,
    });
    expect(res.status).toBe(201);
    const p = res.body;
    expect(p.code).toMatch(/^BRI-\d{3}$/);

    const milestones = await db.milestone.findMany({ where: { project_id: p.id } });
    expect(milestones).toEqual([expect.objectContaining({ title: 'Design done', due_date: new Date('2027-01-31T00:00:00Z'), amount: 200_000n })]);
    const tasks = await db.task.findMany({ where: { project_id: p.id }, include: { assignees: true, checklist_items: true } });
    const design = tasks.find((t) => t.title === 'Design');
    expect(design).toMatchObject({ start_date: new Date('2027-01-02T00:00:00Z'), due_date: new Date('2027-01-10T00:00:00Z'), estimate_minutes: 240, labels: ['ux'], milestone_id: milestones[0].id });
    expect(design.assignees).toEqual([]); // D-26: never assignees
    expect(design.checklist_items.map((c) => c.text)).toEqual(['Mood board']);
    expect(tasks.find((t) => t.title === 'Wireframes').parent_task_id).toBe(design.id);
    const build = tasks.find((t) => t.title === 'Build');
    expect(await db.taskDependency.findMany({ where: { successor_id: build.id } })).toEqual([expect.objectContaining({ predecessor_id: design.id })]);
    const members = (await db.projectMember.findMany({ where: { project_id: p.id } })).map((m) => m.user_id);
    expect(members).toEqual(expect.arrayContaining([W.users.pm.id, W.users.member.id]));
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).source_template_id).toBe(tpl.id);
  });

  it('deactivated default members are not added; amounts are dropped for non-Fixed projects', async () => {
    const temp = await W.addUser();
    await as.Admin.post(`/api/v1/projects/${source.id}/members`, { user_id: temp.id });
    const tpl = (await saveTemplate(as.Admin)).body;
    await as.Admin.post(`/api/v1/users/${temp.id}/deactivate`);
    const p = (
      await as.PM.post('/api/v1/projects', {
        client_id: W.clients.nova.id,
        name: `Hourly from template ${Date.now()}`,
        start_date: '2027-03-01',
        billing_type: 'Hourly',
        pm_user_id: W.users.pm.id,
        template_id: tpl.id,
      })
    ).body;
    const members = (await db.projectMember.findMany({ where: { project_id: p.id } })).map((m) => m.user_id);
    expect(members).not.toContain(temp.id);
    expect((await db.milestone.findFirstOrThrow({ where: { project_id: p.id } })).amount).toBeNull();
  });

  it('an unknown template is 422', async () => {
    const res = await as.PM.post('/api/v1/projects', { client_id: W.clients.nova.id, name: 'X template', start_date: '2027-01-01', billing_type: 'Fixed', pm_user_id: W.users.pm.id, template_id: '00000000-0000-7000-8000-000000000000' });
    expect(res.status).toBe(422);
  });
});

describe('manage templates', () => {
  it('lists, renames (optimistic lock) and deletes; projects keep working after deletion', async () => {
    const tpl = (await saveTemplate(as.PM)).body;
    expect((await as.PM.get('/api/v1/templates')).body.data.map((t) => t.id)).toContain(tpl.id);
    const renamed = await as.PM.patch(`/api/v1/templates/${tpl.id}`, { name: `Renamed ${Date.now()}`, version: tpl.version });
    expect(renamed.status).toBe(200);
    expect((await as.PM.patch(`/api/v1/templates/${tpl.id}`, { name: 'Stale', version: tpl.version })).status).toBe(409);
    expect((await as.Admin.delete(`/api/v1/templates/${tpl.id}`)).status).toBe(204);
    expect((await as.PM.get(`/api/v1/templates/${tpl.id}`)).status).toBe(404);
  });
});

describe('duplicate project (FR-PRJ-12)', () => {
  it('copies the structure under a new name for the same client, shifting dates', async () => {
    const res = await as.PM.post(`/api/v1/projects/${source.id}/duplicate`, { name: `Copy ${Date.now()}`, start_date: '2027-02-01' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ client: { id: W.clients.nova.id }, status: 'NotStarted', start_date: '2027-02-01', budget_amount: 500_000 });
    expect(res.body.code).not.toBe(source.code);
    const tasks = await db.task.findMany({ where: { project_id: res.body.id } });
    expect(tasks.map((t) => t.title).sort()).toEqual(['Build', 'Design', 'Wireframes']);
    expect((await db.project.findUniqueOrThrow({ where: { id: res.body.id } })).duplicated_from_id).toBe(source.id);
  });

  it('needs a new name; Team Members cannot duplicate', async () => {
    expect((await as.PM.post(`/api/v1/projects/${source.id}/duplicate`, { name: source.name })).status).toBe(409);
    expect((await as.PM.post(`/api/v1/projects/${source.id}/duplicate`, {})).status).toBe(422);
    expect((await as.TeamMember.post(`/api/v1/projects/${source.id}/duplicate`, { name: 'Mine' })).status).toBe(403);
  });
});

describe('project permissions shown to the UI', () => {
  it('the project tells each role what it may do with tasks and templates', async () => {
    const pm = (await as.PM.get(`/api/v1/projects/${source.id}`)).body.permissions;
    expect(pm).toMatchObject({ create_task: true, manage_tasks: true, assign_self: true, save_template: true, duplicate: true });
    const member = (await as.TeamMember.get(`/api/v1/projects/${source.id}`)).body.permissions;
    expect(member).toMatchObject({ create_task: true, manage_tasks: false, assign_self: true, save_template: false, duplicate: false });
  });
});
