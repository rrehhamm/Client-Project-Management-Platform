// API tests for tasks: FR-TSK-01…07/09…14, BR-TSK-01…06, D-23, D-24, D-27,
// FR-PRJ-07, TC-TSK-001…006, TC-NFR-001, TC-ROLE-005, TC-PRJ-004, TC-USER-002 (task part).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { apiCreateProject, auditEntries, client } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');
const { todayInTimeZone } = await import('@cpm/shared');

const app = createApp();
let W;
let as;
let A; // NOV-001 (Lina PM, Omar member)

beforeAll(async () => {
  W = await createWorld('Tasks');
  as = await W.loginAll(app);
  as.Anonymous = await client(app);
  A = W.projects.A;
});

const create = (c, projectId, body) => c.post(`/api/v1/projects/${projectId}/tasks`, body);
async function newTask(body = {}, { as: who = as.PM, projectId = A.id } = {}) {
  const res = await create(who, projectId, { title: `Task ${Math.random().toString(36).slice(2, 8)}`, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
const fresh = (id) => as.PM.get(`/api/v1/tasks/${id}`).then((r) => r.body);
const setStatus = (c, t, status, extra = {}) => c.post(`/api/v1/tasks/${t.id}/status`, { status, version: t.version, ...extra });
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A fresh project in the world (own progress numbers). */
async function ownProject(extra = {}) {
  const p = await apiCreateProject(as.Admin, { clientId: W.clients.nova.id, pmId: W.users.pm.id, ...extra });
  await as.Admin.post(`/api/v1/projects/${p.id}/members`, { user_id: W.users.member.id });
  return p;
}

// ---------------------------------------------------------------------------
describe('create (FR-TSK-01, FR-TSK-04)', () => {
  it('defaults to To Do, Normal priority, Internal, at the bottom of the list', async () => {
    const first = await newTask();
    const second = await newTask();
    expect(second).toMatchObject({ status: 'ToDo', priority: 'Normal', visibility: 'Internal', parent_task_id: null, labels: [] });
    expect(second.sort_order).toBeGreaterThan(first.sort_order);
    expect(await auditEntries('task.created', { entity_id: second.id })).toHaveLength(1);
  });

  it('validates the title (1–255 characters)', async () => {
    expect((await create(as.PM, A.id, { title: '  ' })).status).toBe(422);
    expect((await create(as.PM, A.id, { title: 'x'.repeat(256) })).status).toBe(422);
  });

  it('estimates use quarter-hour steps (FR-TSK-02); due ≥ start (BR-TSK-01)', async () => {
    expect((await create(as.PM, A.id, { title: 'Est', estimate_minutes: 20 })).status).toBe(422);
    expect((await create(as.PM, A.id, { title: 'Est', estimate_minutes: 90 })).status).toBe(201);
    expect((await create(as.PM, A.id, { title: 'Dates', start_date: '2026-11-10', due_date: '2026-11-01' })).status).toBe(422);
  });

  it('cleans the rich-text description (NFR-SEC-02)', async () => {
    const t = await newTask({ description: '<p>Hi <script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a> <a href="https://x.test">ok</a></p>' });
    expect(t.description).not.toMatch(/script|onerror|javascript:|<img/i);
    expect(t.description).toContain('<a href="https://x.test" target="_blank" rel="noopener noreferrer nofollow">ok</a>');
  });

  it('subtasks inherit visibility; TC-TSK-005: a subtask of a subtask → 422', async () => {
    const parent = await newTask({ visibility: 'Client' });
    const sub = await newTask({ parent_task_id: parent.id, visibility: 'Internal' });
    expect(sub).toMatchObject({ parent_task_id: parent.id, visibility: 'Client' });
    const res = await create(as.PM, A.id, { title: 'Too deep', parent_task_id: sub.id });
    expect(res.status).toBe(422);
    expect(res.body.fields[0]).toEqual({ field: 'parent_task_id', message: 'Subtasks cannot have subtasks' });
  });

  it('Team Members create on member projects but cannot set visibility, milestone, billable or assign others (D-24)', async () => {
    expect((await create(as.TeamMember, A.id, { title: 'Mine' })).status).toBe(201);
    expect((await create(as.TeamMember, A.id, { title: 'x', visibility: 'Client' })).status).toBe(403);
    expect((await create(as.TeamMember, A.id, { title: 'x', is_billable: true })).status).toBe(403);
    expect((await create(as.TeamMember, A.id, { title: 'x', assignee_ids: [W.users.pm.id] })).status).toBe(403);
    expect((await create(as.TeamMember, A.id, { title: 'self', assignee_ids: [W.users.member.id] })).status).toBe(201);
    expect((await create(as.TeamMember, W.projects.B.id, { title: 'x' })).status).toBe(403); // not a member
    expect((await create(as.Finance, A.id, { title: 'x' })).status).toBe(403);
    // D-40: contacts never reach the internal API (their requests go through the portal)
    expect((await create(as.Contact, A.id, { title: 'x' })).status).toBe(404);
    expect((await create(as.Contact, W.projects.B.id, { title: 'x' })).status).toBe(404);
    expect((await create(as.Anonymous, A.id, { title: 'x' })).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('assignment (FR-TSK-03, D-24)', () => {
  it('TC-TSK-001: assigning a non-member (Rana on A) → 422', async () => {
    const t = await newTask();
    const res = await as.PM.patch(`/api/v1/tasks/${t.id}`, { assignee_ids: [W.users.member2.id], version: t.version });
    expect(res.status).toBe(422);
  });

  it('a deactivated member cannot be assigned, and an open task of a deactivated assignee is flagged (TC-USER-002)', async () => {
    const p = await ownProject();
    const temp = await W.addUser();
    await as.Admin.post(`/api/v1/projects/${p.id}/members`, { user_id: temp.id });
    const t = await newTask({ assignee_ids: [temp.id] }, { projectId: p.id });
    expect(t.has_inactive_assignee).toBe(false);
    expect((await as.Admin.post(`/api/v1/users/${temp.id}/deactivate`)).status).toBe(200);
    const after = await fresh(t.id);
    expect(after.assignees[0]).toMatchObject({ id: temp.id, status: 'Deactivated' }); // keeps the assignee
    expect(after.has_inactive_assignee).toBe(true);
    const other = await newTask({}, { projectId: p.id });
    expect((await as.PM.patch(`/api/v1/tasks/${other.id}`, { assignee_ids: [temp.id], version: other.version })).status).toBe(422);
  });

  it('a Team Member may add themselves, but not remove themselves from a task the PM assigned them to', async () => {
    const t = await newTask();
    const self = await as.TeamMember.patch(`/api/v1/tasks/${t.id}`, { assignee_ids: [W.users.member.id], version: t.version });
    expect(self.status).toBe(200);
    expect(self.body.assignees[0]).toMatchObject({ id: W.users.member.id, self_assigned: true });
    // They self-assigned, so they may remove themselves again
    expect((await as.TeamMember.patch(`/api/v1/tasks/${t.id}`, { assignee_ids: [], version: self.body.version })).status).toBe(200);

    const byPm = await newTask({ assignee_ids: [W.users.member.id] });
    const res = await as.TeamMember.patch(`/api/v1/tasks/${byPm.id}`, { assignee_ids: [], version: byPm.version });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Ask the project manager to reassign this task');
    const other = await as.TeamMember.patch(`/api/v1/tasks/${byPm.id}`, { assignee_ids: [W.users.member.id, W.users.pm.id], version: byPm.version });
    expect(other.status).toBe(403);
    expect((await fresh(byPm.id)).assignees.map((a) => a.id)).toEqual([W.users.member.id]);
  });

  it('a Team Member may remove themselves from a task they created', async () => {
    const own = (await create(as.TeamMember, A.id, { title: 'Own', assignee_ids: [W.users.member.id] })).body;
    // Even after the PM re-saves the assignment, the creator may step off
    expect((await as.TeamMember.patch(`/api/v1/tasks/${own.id}`, { assignee_ids: [], version: own.version })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('field-level edits (FR-TSK-02, BR-TSK-05, D-24, NFR-CONC-01)', () => {
  it('on an assigned task a Team Member edits status, description and estimate, not the title', async () => {
    const t = await newTask({ assignee_ids: [W.users.member.id] });
    const ok = await as.TeamMember.patch(`/api/v1/tasks/${t.id}`, { description: '<p>Notes</p>', estimate_minutes: 120, version: t.version });
    expect(ok.status).toBe(200);
    expect((await as.TeamMember.patch(`/api/v1/tasks/${t.id}`, { title: 'Renamed', version: ok.body.version })).status).toBe(403);
    expect((await as.TeamMember.patch(`/api/v1/tasks/${t.id}`, { milestone_id: null, version: ok.body.version })).status).toBe(403);
    expect((await setStatus(as.TeamMember, ok.body, 'InProgress')).status).toBe(200);
  });

  it('on their own task a Team Member also edits title, priority, dates and labels', async () => {
    const own = (await create(as.TeamMember, A.id, { title: 'Mine' })).body;
    const res = await as.TeamMember.patch(`/api/v1/tasks/${own.id}`, { title: 'Mine, renamed', priority: 'High', due_date: '2026-12-01', labels: ['design', 'design', 'ux'], version: own.version });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Mine, renamed', priority: 'High', due_date: '2026-12-01', labels: ['design', 'ux'] });
  });

  it('a Team Member cannot edit a task that is neither theirs nor assigned', async () => {
    const t = await newTask();
    expect((await as.TeamMember.patch(`/api/v1/tasks/${t.id}`, { description: 'x', version: t.version })).status).toBe(403);
  });

  it('TC-ROLE-005: Team Member PATCH {visibility: Client, project_id: B} → 403 and nothing changes', async () => {
    const t = await newTask({ assignee_ids: [W.users.member.id] });
    const res = await as.TeamMember.patch(`/api/v1/tasks/${t.id}`, { visibility: 'Client', project_id: W.projects.B.id, version: t.version });
    expect(res.status).toBe(403);
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ visibility: 'Internal', project_id: A.id, version: t.version });
  });

  it('FR-TSK-14: PM switches visibility; subtasks follow only when asked', async () => {
    const parent = await newTask();
    const sub = await newTask({ parent_task_id: parent.id });
    const one = await as.PM.patch(`/api/v1/tasks/${parent.id}`, { visibility: 'Client', version: parent.version });
    expect(one.body.visibility).toBe('Client');
    expect((await fresh(sub.id)).visibility).toBe('Internal');
    await as.PM.patch(`/api/v1/tasks/${parent.id}`, { visibility: 'Internal', version: one.body.version });
    const again = await fresh(parent.id);
    await as.PM.patch(`/api/v1/tasks/${parent.id}`, { visibility: 'Client', apply_to_subtasks: true, version: again.version });
    expect((await fresh(sub.id)).visibility).toBe('Client');
  });

  it('TC-NFR-001: two PMs save different titles; the second gets 409', async () => {
    const pm2 = await W.addUser({ role: 'PM' });
    await as.Admin.post(`/api/v1/projects/${A.id}/members`, { user_id: pm2.id });
    const c2 = await W.login(app, 'pm');
    const other = await (await import('../../../test/helpers.js')).loginAs(app, pm2.email);
    const t = await newTask();
    expect((await c2.patch(`/api/v1/tasks/${t.id}`, { title: 'First', version: t.version })).status).toBe(200);
    const second = await other.patch(`/api/v1/tasks/${t.id}`, { title: 'Second', version: t.version });
    expect(second.status).toBe(409);
    expect(second.body.message).toBe('This item was changed by someone else');
    expect((await fresh(t.id)).title).toBe('First');
  });

  it('an empty edit is refused', async () => {
    const t = await newTask();
    expect((await as.PM.patch(`/api/v1/tasks/${t.id}`, { version: t.version })).status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
describe('status (FR-TSK-06, D-23, BR-TSK-02)', () => {
  it('open statuses move in any direction; TC-TSK-006: To Do → In Review is allowed', async () => {
    let t = await newTask();
    for (const s of ['InReview', 'Blocked', 'InProgress', 'ToDo', 'InProgress']) {
      const res = await setStatus(as.PM, t, s);
      expect(res.status, s).toBe(200);
      t = res.body;
    }
    expect(await auditEntries('task.status_changed', { entity_id: t.id })).toHaveLength(5);
  });

  it('Blocked cannot go straight to Done; closed tasks only reopen to To Do', async () => {
    let t = await newTask();
    t = (await setStatus(as.PM, t, 'Blocked')).body;
    expect((await setStatus(as.PM, t, 'Done')).status).toBe(409);
    t = (await setStatus(as.PM, t, 'InProgress')).body;
    t = (await setStatus(as.PM, t, 'Done')).body;
    expect(t.completed_at).not.toBeNull();
    const bad = await setStatus(as.PM, t, 'InProgress');
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('TRANSITION_NOT_ALLOWED');
  });

  it('assignees mark their own task Done; only PM/Admin/Owner reopen', async () => {
    let t = await newTask({ assignee_ids: [W.users.member.id] });
    t = (await setStatus(as.TeamMember, t, 'Done')).body;
    expect(t.status).toBe('Done');
    expect((await setStatus(as.TeamMember, t, 'ToDo')).status).toBe(403);
    const reopened = await setStatus(as.PM, t, 'ToDo');
    expect(reopened.body).toMatchObject({ status: 'ToDo', completed_at: null });
  });

  it('TC-TSK-002: Done with an open subtask → 409 listing it; "complete all subtasks" closes both', async () => {
    const parent = await newTask();
    await newTask({ parent_task_id: parent.id, title: 'Open sub' });
    const res = await setStatus(as.PM, parent, 'Done');
    expect(res.status).toBe(409);
    expect(res.body.fields).toEqual([{ field: 'subtasks', message: 'Open sub' }]);
    const all = await setStatus(as.PM, parent, 'Done', { complete_subtasks: true });
    expect(all.status).toBe(200);
    expect((await fresh(parent.id)).subtasks.every((s) => s.status === 'Done')).toBe(true);
  });

  it('Finance and contacts cannot change status', async () => {
    const t = await newTask({ visibility: 'Client' });
    expect((await setStatus(as.Finance, t, 'InProgress')).status).toBe(403);
    expect((await setStatus(as.Contact, t, 'InProgress')).status).toBe(404); // D-40
  });
});

// ---------------------------------------------------------------------------
describe('dependencies (FR-TSK-07)', () => {
  it('TC-TSK-003: T2 depends on T1 (To Do) → T2 cannot start: 409 "Blocked by: T1"; after T1 is Done it can', async () => {
    let t1 = await newTask({ title: 'T1' });
    const t2 = await newTask({ title: 'T2' });
    expect((await as.PM.post(`/api/v1/tasks/${t2.id}/dependencies`, { predecessor_id: t1.id })).status).toBe(201);
    const blocked = await setStatus(as.PM, t2, 'InProgress');
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe('Blocked by: T1');
    expect((await setStatus(as.PM, t2, 'Done')).status).toBe(409); // cannot skip to Done either
    t1 = (await setStatus(as.PM, t1, 'InProgress')).body;
    t1 = (await setStatus(as.PM, t1, 'Done')).body;
    expect((await setStatus(as.PM, t2, 'InProgress')).status).toBe(200);
    expect((await fresh(t2.id)).predecessors).toEqual([expect.objectContaining({ id: t1.id, status: 'Done' })]);
  });

  it('TC-TSK-004: making T1 depend on T2 when T2 depends on T1 → 422 cycle', async () => {
    const t1 = await newTask();
    const t2 = await newTask();
    const t3 = await newTask();
    await as.PM.post(`/api/v1/tasks/${t2.id}/dependencies`, { predecessor_id: t1.id });
    await as.PM.post(`/api/v1/tasks/${t3.id}/dependencies`, { predecessor_id: t2.id });
    const direct = await as.PM.post(`/api/v1/tasks/${t1.id}/dependencies`, { predecessor_id: t2.id });
    expect(direct.status).toBe(422);
    expect(direct.body.message).toBe('This dependency would create a loop');
    expect((await as.PM.post(`/api/v1/tasks/${t1.id}/dependencies`, { predecessor_id: t3.id })).status).toBe(422); // longer loop
    expect((await as.PM.post(`/api/v1/tasks/${t1.id}/dependencies`, { predecessor_id: t1.id })).status).toBe(422);
  });

  it('dependencies stay inside one project; only PM/Admin/Owner manage them', async () => {
    const t = await newTask();
    const elsewhere = await newTask({}, { projectId: W.projects.B.id });
    expect((await as.PM.post(`/api/v1/tasks/${t.id}/dependencies`, { predecessor_id: elsewhere.id })).status).toBe(422);
    const other = await newTask();
    expect((await as.TeamMember.post(`/api/v1/tasks/${t.id}/dependencies`, { predecessor_id: other.id })).status).toBe(403);
    await as.PM.post(`/api/v1/tasks/${t.id}/dependencies`, { predecessor_id: other.id });
    expect((await as.PM.delete(`/api/v1/tasks/${t.id}/dependencies/${other.id}`)).status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
describe('progress (FR-PRJ-07, TC-PRJ-004)', () => {
  it('4 tasks, 1 Done and 1 Cancelled → 1/3 = 33%; subtasks do not count; deletes recalculate', async () => {
    const p = await ownProject();
    const tasks = [];
    for (let i = 0; i < 4; i++) tasks.push(await newTask({}, { projectId: p.id }));
    await newTask({ parent_task_id: tasks[0].id }, { projectId: p.id });
    expect((await as.PM.get(`/api/v1/projects/${p.id}`)).body.progress_pct).toBe(0);
    const doing = (await setStatus(as.PM, tasks[1], 'InProgress')).body;
    await setStatus(as.PM, doing, 'Done');
    await setStatus(as.PM, tasks[2], 'Cancelled');
    expect((await as.PM.get(`/api/v1/projects/${p.id}`)).body.progress_pct).toBe(33);
    await as.PM.delete(`/api/v1/tasks/${tasks[3].id}`);
    expect((await as.PM.get(`/api/v1/projects/${p.id}`)).body.progress_pct).toBe(50);
  });
});

// ---------------------------------------------------------------------------
describe('ordering (FR-TSK-12)', () => {
  it('reorders within the sibling list and keeps the order after many moves', async () => {
    const p = await ownProject();
    const [a, b, c] = [await newTask({ title: 'A' }, { projectId: p.id }), await newTask({ title: 'B' }, { projectId: p.id }), await newTask({ title: 'C' }, { projectId: p.id })];
    const order = async () => (await as.PM.get(`/api/v1/projects/${p.id}/tasks`)).body.data.map((t) => t.title);
    await as.PM.put(`/api/v1/tasks/${c.id}/position`, { after_id: null });
    expect(await order()).toEqual(['C', 'A', 'B']);
    // Squeeze repeatedly between the same two tasks to use up the gap and force a renumber
    for (let i = 0; i < 12; i++) {
      await as.PM.put(`/api/v1/tasks/${b.id}/position`, { after_id: c.id });
      await as.PM.put(`/api/v1/tasks/${a.id}/position`, { after_id: c.id });
    }
    expect(await order()).toEqual(['C', 'A', 'B']);
    expect((await as.PM.put(`/api/v1/tasks/${a.id}/position`, { after_id: W.projects.B.id })).status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
describe('move to another project (BR-TSK-04, D-27)', () => {
  it('moves with subtasks, drops milestone and dependencies, removes non-member assignees', async () => {
    const target = await apiCreateProject(as.Admin, { clientId: W.clients.nova.id, pmId: W.users.pm.id });
    const ms = (await as.PM.post(`/api/v1/projects/${A.id}/milestones`, { title: 'M', due_date: '2026-12-01' })).body.milestone;
    const pred = await newTask();
    const t = await newTask({ milestone_id: ms.id, assignee_ids: [W.users.member.id, W.users.pm.id] });
    const sub = await newTask({ parent_task_id: t.id });
    await as.PM.post(`/api/v1/tasks/${t.id}/dependencies`, { predecessor_id: pred.id });

    const res = await as.PM.post(`/api/v1/tasks/${t.id}/move`, { project_id: target.id });
    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({ project_id: target.id, milestone: null });
    expect(res.body.removed_assignees).toEqual([{ id: W.users.member.id, full_name: 'Omar' }]); // Omar is not on the target
    expect(res.body.task.assignees.map((a) => a.id)).toEqual([W.users.pm.id]);
    expect((await db.task.findUniqueOrThrow({ where: { id: sub.id } })).project_id).toBe(target.id);
    expect(await db.taskDependency.count({ where: { successor_id: t.id } })).toBe(0);
  });

  it('refuses another client, subtasks, tasks with time, and Team Members', async () => {
    const t = await newTask();
    expect((await as.PM.post(`/api/v1/tasks/${t.id}/move`, { project_id: W.projects.B.id })).status).toBe(409); // Bright Solutions
    const sub = await newTask({ parent_task_id: t.id });
    expect((await as.PM.post(`/api/v1/tasks/${sub.id}/move`, { project_id: W.projects.B.id })).status).toBe(422);
    const timed = await newTask();
    await db.timeEntry.create({ data: { workspace_id: W.workspace.id, user_id: W.users.pm.id, project_id: A.id, task_id: timed.id, date: new Date('2026-10-02'), duration_minutes: 30, is_billable: true } });
    const target = await apiCreateProject(as.Admin, { clientId: W.clients.nova.id, pmId: W.users.pm.id });
    expect((await as.PM.post(`/api/v1/tasks/${timed.id}/move`, { project_id: target.id })).status).toBe(409);
    expect((await as.TeamMember.post(`/api/v1/tasks/${t.id}/move`, { project_id: target.id })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('delete (FR-TSK-13)', () => {
  it('creator, PM or Admin; subtasks go too; invoiced time blocks', async () => {
    const own = (await create(as.TeamMember, A.id, { title: 'Own' })).body;
    await newTask({ parent_task_id: own.id });
    const res = await as.TeamMember.delete(`/api/v1/tasks/${own.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted_subtasks: 1 });
    expect((await as.PM.get(`/api/v1/tasks/${own.id}`)).status).toBe(404);

    const pmTask = await newTask({ assignee_ids: [W.users.member.id] });
    expect((await as.TeamMember.delete(`/api/v1/tasks/${pmTask.id}`)).status).toBe(403);

    const billed = await newTask();
    await db.timeEntry.create({ data: { workspace_id: W.workspace.id, user_id: W.users.pm.id, project_id: A.id, task_id: billed.id, date: new Date('2026-10-02'), duration_minutes: 60, is_billable: true, status: 'Invoiced' } });
    expect((await as.Admin.delete(`/api/v1/tasks/${billed.id}`)).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
describe('checklist (FR-TSK-05) and bulk actions (FR-TSK-11)', () => {
  it('assignees tick checklist items; it does not change progress', async () => {
    const p = await ownProject();
    const t = await newTask({ assignee_ids: [W.users.member.id] }, { projectId: p.id });
    const item = (await as.TeamMember.post(`/api/v1/tasks/${t.id}/checklist`, { text: 'Check copy' })).body;
    const done = await as.TeamMember.patch(`/api/v1/tasks/${t.id}/checklist/${item.id}`, { is_done: true, version: item.version });
    expect(done.body.is_done).toBe(true);
    const detail = await fresh(t.id);
    expect(detail).toMatchObject({ checklist_total: 1, checklist_done: 1 });
    expect((await as.PM.get(`/api/v1/projects/${p.id}`)).body.progress_pct).toBe(0);
    expect((await as.Finance.post(`/api/v1/tasks/${t.id}/checklist`, { text: 'x' })).status).toBe(403);
    expect((await as.TeamMember.delete(`/api/v1/tasks/${t.id}/checklist/${item.id}`)).status).toBe(204);
  });

  it('bulk status reports partial failures per task', async () => {
    const ok1 = await newTask();
    const ok2 = await newTask();
    const parent = await newTask();
    await newTask({ parent_task_id: parent.id });
    const res = await as.PM.post('/api/v1/tasks/bulk', { task_ids: [ok1.id, ok2.id, parent.id], action: 'status', status: 'Done' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ succeeded: 2, failed: 1 });
    expect(res.body.results.find((r) => r.id === parent.id)).toMatchObject({ ok: false, code: 'CONFLICT' });
  });

  it('bulk delete by a Team Member only deletes their own tasks', async () => {
    const own = (await create(as.TeamMember, A.id, { title: 'Own' })).body;
    const notOwn = await newTask();
    const res = await as.TeamMember.post('/api/v1/tasks/bulk', { task_ids: [own.id, notOwn.id], action: 'delete' });
    expect(res.body).toMatchObject({ succeeded: 1, failed: 1 });
    expect((await as.PM.get(`/api/v1/tasks/${notOwn.id}`)).status).toBe(200);
  });

  it('bulk assign and due date', async () => {
    const t = await newTask();
    const res = await as.PM.post('/api/v1/tasks/bulk', { task_ids: [t.id], action: 'assign', user_id: W.users.member.id });
    expect(res.body.succeeded).toBe(1);
    await as.PM.post('/api/v1/tasks/bulk', { task_ids: [t.id], action: 'due_date', due_date: '2026-12-24' });
    expect(await fresh(t.id)).toMatchObject({ due_date: '2026-12-24', assignees: [expect.objectContaining({ id: W.users.member.id })] });
  });
});

// ---------------------------------------------------------------------------
describe('list, read and filters (FR-TSK-09, BR-TSK-03, BR-TSK-06)', () => {
  it('filters by status, assignee, milestone, label, search, overdue; top-level by default', async () => {
    const p = await ownProject({ start_date: '2026-01-01' });
    const yesterday = addDays(todayInTimeZone('Asia/Amman'), -1);
    const late = await newTask({ title: 'Late one', due_date: yesterday, labels: ['ux'], assignee_ids: [W.users.member.id] }, { projectId: p.id });
    await newTask({ title: 'Other' }, { projectId: p.id });
    await newTask({ parent_task_id: late.id, title: 'Sub' }, { projectId: p.id });
    const get = async (qs) => (await as.PM.get(`/api/v1/projects/${p.id}/tasks?${qs}`)).body.data.map((t) => t.title).sort();
    expect(await get('')).toEqual(['Late one', 'Other']);
    expect(await get('overdue=true')).toEqual(['Late one']);
    expect(await get('label=ux')).toEqual(['Late one']);
    expect(await get(`assignee=${W.users.member.id}`)).toEqual(['Late one']);
    expect(await get('assignee=none')).toEqual(['Other']);
    expect(await get('q=oth')).toEqual(['Other']);
    expect(await get(`parent_task_id=${late.id}`)).toEqual(['Sub']);
    expect(await get('all_levels=true')).toEqual(['Late one', 'Other', 'Sub']);
    expect((await as.PM.get(`/api/v1/projects/${p.id}/tasks`)).body.data.find((t) => t.title === 'Late one')).toMatchObject({ is_overdue: true, subtask_count: 1, open_subtask_count: 1 });
    expect((await as.PM.get(`/api/v1/projects/${p.id}/labels`)).body.data).toEqual(['ux']);
  });

  it('contacts see Client-visible tasks only, with limited fields (BR-TSK-06)', async () => {
    const shown = await newTask({ visibility: 'Client', estimate_minutes: 60, title: 'Shown to client' });
    const hidden = await newTask({ title: 'Internal only' });
    // D-40: the internal API answers 404; the portal shows Client tasks with portal fields only
    expect((await as.Contact.get(`/api/v1/projects/${A.id}/tasks`)).status).toBe(404);
    const list = (await as.Contact.get(`/api/v1/portal/projects/${A.id}/tasks?page_size=100`)).body.data;
    expect(list.map((t) => t.title)).toContain('Shown to client');
    expect(list.map((t) => t.title)).not.toContain('Internal only');
    const item = list.find((t) => t.id === shown.id);
    expect(item).not.toHaveProperty('estimate_minutes');
    expect(item).not.toHaveProperty('is_billable');
    expect((await as.Contact.get(`/api/v1/portal/tasks/${hidden.id}`)).status).toBe(404);
    const detail = (await as.Contact.get(`/api/v1/portal/tasks/${shown.id}`)).body;
    expect(detail).not.toHaveProperty('checklist');
    expect(detail).not.toHaveProperty('estimate_minutes');
  });

  it('non-members cannot read tasks; Finance reads everything', async () => {
    const t = await newTask({}, { projectId: W.projects.B.id });
    expect((await as.TeamMember.get(`/api/v1/tasks/${t.id}`)).status).toBe(403);
    expect((await as.Finance.get(`/api/v1/tasks/${t.id}`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('My Tasks (FR-TSK-10)', () => {
  it('groups my open tasks into overdue / today / this week / later', async () => {
    const p = await ownProject({ start_date: '2026-01-01' });
    const today = todayInTimeZone('Asia/Amman');
    const mine = { assignee_ids: [W.users.member.id] };
    await newTask({ ...mine, title: 'MT overdue', due_date: addDays(today, -2) }, { projectId: p.id });
    await newTask({ ...mine, title: 'MT today', due_date: today }, { projectId: p.id });
    await newTask({ ...mine, title: 'MT later', due_date: addDays(today, 30) }, { projectId: p.id });
    await newTask({ ...mine, title: 'MT no date' }, { projectId: p.id });
    const done = await newTask({ ...mine, title: 'MT done' }, { projectId: p.id });
    await setStatus(as.PM, (await setStatus(as.PM, done, 'InProgress')).body, 'Done');

    const res = await as.TeamMember.get('/api/v1/me/tasks');
    expect(res.status).toBe(200);
    const titles = (g) => res.body[g].data.map((t) => t.title).filter((x) => x.startsWith('MT'));
    expect(titles('overdue')).toEqual(['MT overdue']);
    expect(titles('today')).toEqual(['MT today']);
    expect(titles('later')).toEqual(expect.arrayContaining(['MT later', 'MT no date']));
    expect(JSON.stringify(res.body)).not.toContain('MT done');
    expect(res.body.overdue.data[0].project).toMatchObject({ id: p.id, code: p.code });
    expect((await as.Contact.get('/api/v1/me/tasks')).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('closed and archived projects', () => {
  it('tasks of a completed project cannot change', async () => {
    let p = await ownProject();
    p = (await as.PM.post(`/api/v1/projects/${p.id}/status`, { status: 'InProgress', version: p.version })).body;
    p = (await as.PM.post(`/api/v1/projects/${p.id}/status`, { status: 'Completed', version: p.version })).body;
    const res = await create(as.PM, p.id, { title: 'Late addition' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Reopen the project first/);
  });
});
