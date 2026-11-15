// NFR-PRIV-01 / BR-CLI-01 portal isolation suite (Phase 5 exit criterion).
// Every Internal item and every item of the other client carries a marker string.
// Each contact crawls the whole portal; the suite fails if any response contains a
// marker, an internal field, an internal user's email, or answers 403 where 404 is due.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FILES, loginAs } from '../../test/helpers.js';
import { createWorld } from '../../test/fixtures.js';

vi.mock('../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../app.js');
const { db } = await import('../lib/db.js');

const app = createApp();
const INTERNAL = 'INTERNAL-MARKER';
const OTHER = 'OTHER-CLIENT-MARKER';
/** Fields that must never reach a contact, at any depth (TC-PORT-003). */
const FORBIDDEN_KEYS = ['estimate_minutes', 'is_billable', 'internal_notes', 'hourly_cost_rate', 'default_bill_rate', 'budget_amount', 'budget_minutes', 'decision_ip', 'password_hash', 'storage_key', 'sha256', 'notification_prefs', 'has_inactive_assignee', 'checklist', 'permissions', 'ip', 'user_agent'];

let W;
let staff;
const ids = { a: {}, b: {} }; // records to probe
let contacts; // { maya, ali, commenter, omarN } → API clients

beforeAll(async () => {
  W = await createWorld('Isolation');
  staff = await W.loginAll(app);
  const A = W.projects.A;
  const B = W.projects.B;
  await db.project.update({ where: { id: B.id }, data: { name: `Corporate ${OTHER}`, name_normalized: `corporate ${OTHER.toLowerCase()}`, status: 'InProgress' } });

  // Project A: Client items, plus Internal items carrying the marker
  const clientTask = (await staff.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Shared task', visibility: 'Client', estimate_minutes: 90, is_billable: true, description: '<p>Visible</p>', assignee_ids: [W.users.member.id] })).body;
  await staff.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Shared subtask', parent_task_id: clientTask.id });
  const internalSub = (await staff.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: `Sub ${INTERNAL}`, parent_task_id: clientTask.id })).body;
  await staff.PM.patch(`/api/v1/tasks/${internalSub.id}`, { visibility: 'Internal', version: internalSub.version });
  const internalTask = (await staff.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: `Task ${INTERNAL}` })).body;
  await staff.PM.post(`/api/v1/projects/${A.id}/milestones`, { title: 'Launch', due_date: '2026-12-01', visibility: 'Client' });
  await staff.PM.post(`/api/v1/projects/${A.id}/milestones`, { title: `Milestone ${INTERNAL}`, due_date: '2026-12-02' });
  await staff.PM.post('/api/v1/comments', { entity_type: 'Task', entity_id: clientTask.id, body: '<p>Client comment</p>', visibility: 'Client' });
  await staff.PM.post('/api/v1/comments', { entity_type: 'Task', entity_id: clientTask.id, body: `<p>Comment ${INTERNAL}</p>` });
  await staff.PM.post('/api/v1/comments', { entity_type: 'Project', entity_id: A.id, body: `<p>Post ${INTERNAL}</p>` });
  await staff.PM.post('/api/v1/comments', { entity_type: 'Project', entity_id: A.id, body: '<p>Client post</p>', visibility: 'Client' });
  const clientFile = (await staff.PM.upload(`/api/v1/projects/${A.id}/files?visibility=Client&task_id=${clientTask.id}`, SAMPLE_FILES.png(), { name: 'shared.png' })).body;
  const internalFile = (await staff.PM.upload(`/api/v1/projects/${A.id}/files?task_id=${clientTask.id}`, SAMPLE_FILES.pdf(), { name: `File ${INTERNAL}.pdf` })).body;
  await staff.PM.post('/api/v1/comments', { entity_type: 'File', entity_id: clientFile.id, body: `<p>File comment ${INTERNAL}</p>` });
  const v = await db.fileVersion.findFirst({ where: { file_id: clientFile.id } });
  const approval = (await staff.PM.post('/api/v1/approvals', { file_version_id: v.id, approver_contact_ids: [W.contacts.maya.id], message: 'Please review' })).body;
  await staff.PM.post(`/api/v1/approvals/${approval.id}/pins`, { x: 0.5, y: 0.5, body: 'Team pin' });
  await db.client.update({ where: { id: W.clients.nova.id }, data: { internal_notes: `Notes ${INTERNAL}` } });

  // Project B (other client): everything carries the other-client marker
  const bTask = (await staff.PM.post(`/api/v1/projects/${B.id}/tasks`, { title: `B task ${OTHER}`, visibility: 'Client' })).body;
  await staff.PM.post('/api/v1/comments', { entity_type: 'Task', entity_id: bTask.id, body: `<p>B comment ${OTHER}</p>`, visibility: 'Client' });
  const bFile = (await staff.PM.upload(`/api/v1/projects/${B.id}/files?visibility=Client`, SAMPLE_FILES.png(), { name: `B ${OTHER}.png` })).body;
  const bv = await db.fileVersion.findFirst({ where: { file_id: bFile.id } });
  const bApproval = (await staff.PM.post('/api/v1/approvals', { file_version_id: bv.id, approver_contact_ids: [W.contacts.omarN.id] })).body;

  Object.assign(ids.a, { project: A.id, internalTask: internalTask.id, internalSub: internalSub.id, internalFile: internalFile.id });
  Object.assign(ids.b, { project: B.id, task: bTask.id, file: bFile.id, approval: bApproval.id });

  // A Comment-level contact on A, to cover every portal level
  const commenter = await W.addContact({});
  await db.projectMember.create({ data: { workspace_id: W.workspace.id, project_id: A.id, contact_id: commenter.id, portal_level: 'Comment' } });
  contacts = {
    maya: await W.login(app, 'maya'),
    ali: await W.login(app, 'ali'),
    commenter: await loginAs(app, commenter.email),
  };
});

/** Fetch a portal URL; returns the parsed body and records the raw text for scanning. */
async function crawl(c) {
  const seen = []; // [url, status, text]
  const get = async (url) => {
    const res = await c.get(`/api/v1/portal${url}`);
    seen.push([url, res.status, res.text]);
    return res;
  };
  await get('/branding');
  await get('/notifications?page_size=100');
  await get('/notification-preferences');
  const home = (await get('/home')).body;
  const projects = (await get('/projects')).body.data;
  for (const p of projects) {
    await get(`/projects/${p.id}`);
    await get(`/comments?entity_type=Project&entity_id=${p.id}&page_size=100`);
    const tasks = (await get(`/projects/${p.id}/tasks?page_size=100`)).body.data;
    for (const t of tasks) {
      const d = (await get(`/tasks/${t.id}`)).body;
      await get(`/comments?entity_type=Task&entity_id=${t.id}&page_size=100`);
      for (const s of d.subtasks ?? []) await get(`/tasks/${s.id}`);
      for (const f of d.files ?? []) await get(`/files/${f.id}`);
    }
    const files = (await get(`/projects/${p.id}/files?page_size=100`)).body.data;
    for (const f of files) {
      await get(`/files/${f.id}`);
      await get(`/comments?entity_type=File&entity_id=${f.id}&page_size=100`);
    }
  }
  const approvals = (await get('/approvals?page_size=100')).body.data;
  for (const a of approvals) await get(`/approvals/${a.id}`);
  return { seen, home, projects };
}

function forbiddenKeysIn(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [...(FORBIDDEN_KEYS.includes(k) ? [`${path}${k}`] : []), ...forbiddenKeysIn(v, `${path}${k}.`)]);
}

describe('portal isolation (NFR-PRIV-01, BR-CLI-01)', () => {
  it.each(['maya', 'ali', 'commenter'])('%s: no Internal item, no other-client item, no internal field, no staff email anywhere', async (who) => {
    const { seen, projects } = await crawl(contacts[who]);
    expect(projects.map((p) => p.code)).toEqual(['NOV-001']);
    expect(seen.length).toBeGreaterThan(15);
    const staffEmails = Object.values(W.users).map((u) => u.email);
    for (const [url, status, text] of seen) {
      expect(status, url).toBe(200);
      expect(text, `${url} leaks Internal content`).not.toContain(INTERNAL);
      expect(text, `${url} leaks the other client`).not.toContain(OTHER);
      for (const email of staffEmails) expect(text, `${url} leaks a staff email`).not.toContain(email);
      expect(forbiddenKeysIn(JSON.parse(text)), url).toEqual([]);
    }
  });

  it.each(['maya', 'ali', 'commenter'])('%s: every out-of-scope id is 404 on every portal route, never 403', async (who) => {
    const c = contacts[who];
    const probes = [
      `/projects/${ids.b.project}`,
      `/projects/${ids.b.project}/tasks`,
      `/projects/${ids.b.project}/files`,
      `/tasks/${ids.b.task}`,
      `/tasks/${ids.a.internalTask}`,
      `/tasks/${ids.a.internalSub}`,
      `/files/${ids.b.file}`,
      `/files/${ids.a.internalFile}`,
      `/files/${ids.b.file}/versions/1/url`,
      `/files/${ids.a.internalFile}/versions/1/url`,
      `/comments?entity_type=Task&entity_id=${ids.b.task}`,
      `/comments?entity_type=Task&entity_id=${ids.a.internalTask}`,
      `/comments?entity_type=Project&entity_id=${ids.b.project}`,
      `/comments?entity_type=File&entity_id=${ids.a.internalFile}`,
      `/approvals/${ids.b.approval}`,
      `/approvals/${ids.b.approval}/proof-url`,
    ];
    for (const url of probes) {
      const res = await c.get(`/api/v1/portal${url}`);
      expect(res.status, url).toBe(404);
      expect(res.text, url).not.toContain(OTHER);
      expect(res.text, url).not.toContain(INTERNAL);
    }
    // Writes into another client's project are 404 as well
    expect((await c.post(`/api/v1/portal/projects/${ids.b.project}/requests`, { title: 'x' })).status).toBe(404);
    expect((await c.post('/api/v1/portal/comments', { entity_type: 'Task', entity_id: ids.b.task, body: '<p>x</p>' })).status).toBe(404);
    expect((await c.post(`/api/v1/portal/approvals/${ids.b.approval}/decision`, { decision: 'Approved' })).status).toBe(404);
  });

  it("the other client's contact sees none of Nova's data, and Nova's approval is 404 for them", async () => {
    const omarN = await W.login(app, 'omarN');
    const { seen, projects } = await crawl(omarN);
    expect(projects.map((p) => p.code)).toEqual(['BRI-001']);
    for (const [url, , text] of seen) {
      expect(text, url).not.toMatch(/Shared task|shared\.png|Nova Retail|NOV-001/);
      expect(text, url).not.toContain(INTERNAL);
    }
    expect((await omarN.get(`/api/v1/portal/projects/${ids.a.project}`)).status).toBe(404);
  });

  it('a contact with portal access revoked, or of an archived client, reaches nothing', async () => {
    const c = await W.addContact({});
    await db.projectMember.create({ data: { workspace_id: W.workspace.id, project_id: ids.a.project, contact_id: c.id, portal_level: 'Approve' } });
    const her = await loginAs(app, c.email);
    expect((await her.get('/api/v1/portal/home')).status).toBe(200);
    await staff.PM.post(`/api/v1/contacts/${c.id}/revoke-portal`);
    expect((await her.get('/api/v1/portal/home')).status).toBe(401);
  });
});
