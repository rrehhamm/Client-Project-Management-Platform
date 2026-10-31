// API tests for dashboards and search: FR-DASH-01/02/03/05, BR-DASH-01/02, TC-DASH-001/002, FR-SRCH-01, TC-SRCH-001.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FILES } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');
const { addDays, workspaceWeek } = await import('../../lib/dates.js');

const app = createApp();
let W;
let as;
let week;

beforeAll(async () => {
  W = await createWorld('Dash');
  as = await W.loginAll(app);
  week = workspaceWeek({ timezone: 'Asia/Amman', week_start_day: 0 });
  const A = W.projects.A;
  const B = W.projects.B;
  // A is overdue (due yesterday); B has tasks due this week and one in review
  await db.project.update({ where: { id: A.id }, data: { due_date: new Date(`${addDays(week.today, -1)}T00:00:00Z`) } });
  await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'A this week', due_date: week.weekEnd, assignee_ids: [W.users.member.id] });
  await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'A overdue', due_date: addDays(week.weekStart, -2), assignee_ids: [W.users.member.id] });
  await as.PM.post(`/api/v1/projects/${B.id}/tasks`, { title: 'B this week', due_date: week.weekStart, assignee_ids: [W.users.member2.id] });
  const review = (await as.PM.post(`/api/v1/projects/${B.id}/tasks`, { title: 'B review' })).body;
  await as.PM.post(`/api/v1/tasks/${review.id}/status`, { status: 'InReview', version: review.version });
  await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'A next week', due_date: addDays(week.weekEnd, 1) });
  await as.PM.upload(`/api/v1/projects/${B.id}/files`, SAMPLE_FILES.pdf(), { name: 'Corporate brand book.pdf' });
});

/** Follow a card's link to its list and compare totals (TC-DASH-001). */
async function listTotal(c, link) {
  const [path, query] = link.split('?');
  const api = path === '/work' ? '/api/v1/tasks' : '/api/v1/projects';
  return (await c.get(`${api}?${query}`)).body.total;
}

describe('dashboards (FR-DASH-01/02/03, BR-DASH-01)', () => {
  it('TC-DASH-001: for every role, each card count equals the total of the list it opens', async () => {
    for (const role of ['Owner', 'Admin', 'PM', 'TeamMember', 'Finance']) {
      const d = (await as[role].get('/api/v1/dashboard')).body;
      for (const card of d.cards) expect(await listTotal(as[role], card.link), `${role} ${card.key}`).toBe(card.count);
      if (d.my_projects) expect(await listTotal(as[role], d.my_projects.link)).toBeGreaterThanOrEqual(d.my_projects.total);
    }
  });

  it('Owner/Admin: active projects, overdue projects, tasks due this week (workspace week, BR-DASH-02)', async () => {
    const d = (await as.Admin.get('/api/v1/dashboard')).body;
    expect(d.view).toBe('workspace');
    expect(Object.fromEntries(d.cards.map((c) => [c.key, c.count]))).toEqual({ active_projects: 1, overdue_projects: 1, tasks_due_this_week: 2 });
    expect(d.week).toEqual({ start: week.weekStart, end: week.weekEnd, today: week.today });
    expect(d.cards.find((c) => c.key === 'overdue_projects').link).toBe('/projects?overdue=true');
  });

  it('PM: own overdue projects, tasks awaiting review, inactive assignees, and the list of their projects', async () => {
    await db.user.update({ where: { id: W.users.member2.id }, data: { status: 'Deactivated' } });
    try {
      const d = (await as.PM.get('/api/v1/dashboard')).body;
      expect(d.view).toBe('pm');
      expect(Object.fromEntries(d.cards.map((c) => [c.key, c.count]))).toEqual({ my_overdue_projects: 1, tasks_awaiting_review: 1, inactive_assignees: 1 });
      expect(d.my_projects.data.map((p) => p.code).sort()).toEqual(['BRI-001', 'NOV-001']);
      expect(d.my_projects.data.find((p) => p.code === 'NOV-001')).toMatchObject({ is_overdue: true, progress_pct: expect.any(Number) });
    } finally {
      await db.user.update({ where: { id: W.users.member2.id }, data: { status: 'Active' } });
    }
  });

  it("TC-DASH-002: Omar's dashboard counts only his projects' tasks", async () => {
    const d = (await as.TeamMember.get('/api/v1/dashboard')).body;
    expect(d.view).toBe('member');
    expect(d.my_tasks).toMatchObject({ overdue: 1, link: '/my-tasks' });
    expect(d.my_tasks.today + d.my_tasks.this_week).toBe(1);
    expect(d.my_projects.data.map((p) => p.code)).toEqual(['NOV-001']);
    expect(d.cards).toEqual([]);
    // His task list never includes Project B
    const all = (await as.TeamMember.get('/api/v1/tasks?due=this_week')).body;
    expect(all.data.map((t) => t.project.code)).toEqual(['NOV-001']);
  });

  it('contacts and signed-out callers get no dashboard', async () => {
    expect((await as.Contact.get('/api/v1/dashboard')).status).toBe(404);
    const { client } = await import('../../../test/helpers.js');
    expect((await (await client(app)).get('/api/v1/dashboard')).status).toBe(401);
  });
});

describe('global search (FR-SRCH-01)', () => {
  it('finds clients, projects, tasks, files and contacts by name, grouped by type', async () => {
    const res = await as.Admin.get('/api/v1/search?q=corporate');
    expect(res.status).toBe(200);
    expect(res.body.groups.projects.map((p) => p.title)).toEqual(['Corporate Website']);
    expect(res.body.groups.files.map((f) => f.title)).toEqual(['Corporate brand book.pdf']);
    const people = await as.Admin.get('/api/v1/search?q=maya');
    expect(people.body.groups.contacts[0]).toMatchObject({ title: 'Maya', link: `/clients/${W.clients.nova.id}?tab=contacts` });
  });

  it('TC-SRCH-001: Omar searching "Corporate" gets nothing from Project B', async () => {
    const res = await as.TeamMember.get('/api/v1/search?q=Corporate');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect((await as.TeamMember.get('/api/v1/search?q=B this')).body.groups.tasks).toEqual([]);
    expect((await as.TeamMember.get('/api/v1/search?q=A this')).body.groups.tasks.map((t) => t.title)).toEqual(['A this week']);
    // Team Members never get contact details
    expect((await as.TeamMember.get('/api/v1/search?q=maya')).body.groups.contacts).toEqual([]);
  });

  it('needs at least 2 characters; returns at most 20 results', async () => {
    expect((await as.Admin.get('/api/v1/search?q=a')).status).toBe(422);
    for (let i = 0; i < 12; i += 1) {
      await db.task.create({ data: { workspace_id: W.workspace.id, project_id: W.projects.A.id, title: `Zebra ${i}`, sort_order: 100_000 + i } });
      await db.project.create({ data: { workspace_id: W.workspace.id, client_id: W.clients.nova.id, name: `Zebra project ${i}`, name_normalized: `zebra project ${i}`, code: `ZEB-${String(i).padStart(3, '0')}`, status: 'NotStarted', billing_type: 'Fixed', start_date: new Date('2026-11-01'), pm_user_id: W.users.pm.id } });
    }
    const res = await as.Admin.get('/api/v1/search?q=zebra');
    expect(res.body.total).toBe(20); // top 20 overall
    expect(res.body.groups.tasks).toHaveLength(10);
    expect(res.body.groups.projects).toHaveLength(10);
  });
});

describe('profile photo (FR-AUTH-13) and storage use (BR-FILE-03)', () => {
  it('a user uploads a PNG photo checked by content; colleagues see it; non-images get 415; removing works', async () => {
    const png = SAMPLE_FILES.png();
    const put = await as.TeamMember.agent.put('/api/v1/me/avatar').set('X-CSRF-Token', as.TeamMember.csrf).set('Content-Type', 'image/png').send(png);
    expect(put.status).toBe(200);
    expect((await as.TeamMember.get('/api/v1/auth/me')).body.principal.has_avatar).toBe(true);
    const seen = await as.PM.get(`/api/v1/avatars/${W.users.member.id}`);
    expect(seen.status).toBe(302);
    expect((await fetch(seen.headers.location)).status).toBe(200);
    const exe = await as.TeamMember.agent.put('/api/v1/me/avatar').set('X-CSRF-Token', as.TeamMember.csrf).set('Content-Type', 'image/png').send(SAMPLE_FILES.exe());
    expect(exe.status).toBe(415);
    expect((await as.TeamMember.delete('/api/v1/me/avatar')).body.has_avatar).toBe(false);
    expect((await as.PM.get(`/api/v1/avatars/${W.users.member.id}`)).status).toBe(404);
    const other = await createWorld('Dash other');
    expect((await (await other.login(app, 'owner')).get(`/api/v1/avatars/${W.users.pm.id}`)).status).toBe(404);
  });

  it('Owner/Admin see storage use against the quota; others get 403', async () => {
    const res = await as.Admin.get('/api/v1/storage');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ used_bytes: expect.any(Number), quota_bytes: expect.any(Number), file_max_bytes: expect.any(Number) });
    expect((await as.PM.get('/api/v1/storage')).status).toBe(403);
    expect((await as.TeamMember.get('/api/v1/storage')).status).toBe(403);
  });
});
