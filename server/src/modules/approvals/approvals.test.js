// API tests for approvals: FR-APP-01…07, BR-APP-01…03, TC-APP-001…003, TC-FILE-004, D-33, D-41, D-42.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FILES, auditEntries } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');
const { addDays, workspaceToday } = await import('../../lib/dates.js');
const { outcome, sendApprovalReminders } = await import('./service.js');

const app = createApp();
let W;
let as;
let A;
let ali; // View level
let second; // a second Approve-level contact on A

beforeAll(async () => {
  W = await createWorld('Approvals');
  as = await W.loginAll(app);
  A = W.projects.A;
  ali = await W.login(app, 'ali');
  const c = await W.addContact({});
  await db.projectMember.create({ data: { workspace_id: W.workspace.id, project_id: A.id, contact_id: c.id, portal_level: 'Approve' } });
  const { loginAs } = await import('../../../test/helpers.js');
  second = { contact: c, client: await loginAs(app, c.email) };
});

/** A Client-visible, scanned file on A; returns { file, version } */
async function clientFile(name = `design-${Date.now()}.png`, extra = '') {
  const f = (await as.PM.upload(`/api/v1/projects/${A.id}/files?visibility=Client${extra}`, SAMPLE_FILES.png(), { name })).body;
  const v = await db.fileVersion.findFirst({ where: { file_id: f.id }, orderBy: { version_no: 'desc' } });
  return { file: f, version: v };
}
const request = (c, body) => c.post('/api/v1/approvals', body);
const decide = (c, id, body) => c.post(`/api/v1/portal/approvals/${id}/decision`, body);

describe('request (FR-APP-01)', () => {
  it('a member asks Approve-level contacts to approve a Client file version; approvers get email and portal notices', async () => {
    const { version } = await clientFile();
    const res = await request(as.TeamMember, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id], due_date: addDays(workspaceToday({ timezone: 'Asia/Amman' }), 3), message: 'Final colours' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'Pending', rule: 'Any', subject: { type: 'file', version_no: 1, proofable: true }, approvers: [{ full_name: 'Maya', decision: null }] });
    const n = await db.notification.findMany({ where: { contact_id: W.contacts.maya.id, entity_id: res.body.id, type: 'approval_requested' } });
    expect(n.map((x) => x.channel).sort()).toEqual(['Email', 'InApp']);
    expect(n[0].payload).toMatchObject({ link: `/portal/approvals/${res.body.id}`, reply_to: W.users.pm.email });
    expect((await auditEntries('approval.requested', { entity_id: res.body.id }))[0].after).toMatchObject({ subject: 'file', approvers: 1 });
  });

  it('refuses Internal files, unscanned or older versions, non-approvers, View-level approvers, and a second pending request', async () => {
    const internal = (await as.PM.upload(`/api/v1/projects/${A.id}/files`, SAMPLE_FILES.png(), { name: 'internal.png' })).body;
    const iv = await db.fileVersion.findFirst({ where: { file_id: internal.id } });
    expect((await request(as.PM, { file_version_id: iv.id, approver_contact_ids: [W.contacts.maya.id] })).status).toBe(422);
    const { version } = await clientFile();
    expect((await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.ali.id] })).status).toBe(422); // View level
    expect((await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.omarN.id] })).status).toBe(422); // other client
    expect((await request(as.PM, { file_version_id: version.id, task_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).status).toBe(422);
    expect((await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).status).toBe(201);
    expect((await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).status).toBe(409);
    await db.fileVersion.update({ where: { id: version.id }, data: { scan_status: 'Pending' } });
    const other = await clientFile();
    await db.fileVersion.update({ where: { id: other.version.id }, data: { scan_status: 'Pending' } });
    expect((await request(as.PM, { file_version_id: other.version.id, approver_contact_ids: [W.contacts.maya.id] })).status).toBe(422);
  });

  it('roles: Finance and non-members cannot request; contacts never reach the internal endpoint', async () => {
    const { version } = await clientFile();
    expect((await request(as.Finance, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).status).toBe(403);
    expect((await request(as.TeamMember2, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).status).toBe(403);
    expect((await request(as.Contact, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).status).toBe(404);
  });
});

describe('decide (FR-APP-03/04, BR-APP-01/02, TC-APP-001…003)', () => {
  it('TC-APP-001: "Request changes" needs a note', async () => {
    const { version } = await clientFile();
    const a = (await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).body;
    const res = await decide(as.Contact, a.id, { decision: 'ChangesRequested' });
    expect(res.status).toBe(422);
    expect(res.body.fields[0]).toMatchObject({ field: 'note' });
    expect((await db.approvalRequest.findUnique({ where: { id: a.id } })).status).toBe('Pending');
  });

  it('TC-APP-002: rule "All" with two approvers — Ali (View) gets 403 and the status stays Pending until both approve', async () => {
    const { version } = await clientFile();
    const a = (await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id, second.contact.id], rule: 'All' })).body;
    expect((await decide(ali, a.id, { decision: 'Approved' })).status).toBe(403);
    const first = await decide(as.Contact, a.id, { decision: 'Approved' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'Pending', my_decision: 'Approved', can_decide: false });
    expect((await decide(as.Contact, a.id, { decision: 'Approved' })).status).toBe(409); // already decided
    const last = await decide(second.client, a.id, { decision: 'Approved' });
    expect(last.body.status).toBe('Approved');
    // Name, time and IP are stored with each decision (FR-APP-03)
    const rows = await db.approvalApprover.findMany({ where: { approval_request_id: a.id } });
    expect(rows.every((r) => r.decided_at && r.decision_ip)).toBe(true);
    // The requester and the PM are told
    expect(await db.notification.count({ where: { user_id: W.users.pm.id, entity_id: a.id, type: 'approval_decided' } })).toBeGreaterThan(0);
  });

  it('rule "Any": the first approval approves; any "Request changes" ends the round', async () => {
    expect(outcome('Any', ['Approved'], 2)).toBe('Approved');
    expect(outcome('All', ['Approved'], 2)).toBeNull();
    expect(outcome('All', ['Approved', 'ChangesRequested'], 2)).toBe('ChangesRequested');
    const { version } = await clientFile();
    const a = (await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id, second.contact.id], rule: 'Any' })).body;
    const r = await decide(second.client, a.id, { decision: 'ChangesRequested', note: 'Logo too small' });
    expect(r.body.status).toBe('ChangesRequested');
    expect((await decide(as.Contact, a.id, { decision: 'Approved' })).status).toBe(409); // the round is over
  });

  it('TC-APP-003: a decided approval cannot change (409), and internal users never decide (BR-APP-02)', async () => {
    const { version } = await clientFile();
    const a = (await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).body;
    await decide(as.Contact, a.id, { decision: 'Approved' });
    expect((await as.Contact.patch(`/api/v1/portal/approvals/${a.id}/decision`, { decision: 'ChangesRequested', note: 'x' })).status).toBe(409);
    expect((await decide(as.Contact, a.id, { decision: 'ChangesRequested', note: 'x' })).status).toBe(409);
    for (const role of ['Owner', 'Admin', 'PM']) expect((await decide(as[role], a.id, { decision: 'Approved' })).status, role).toBe(403);
    expect((await as.PM.post(`/api/v1/approvals/${a.id}/cancel`)).status).toBe(409);
  });

  it('BR-APP-03: approving a file linked to an In Review task closes the task when the PM turned it on', async () => {
    await db.project.update({ where: { id: A.id }, data: { close_task_on_approval: true } });
    try {
      const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: `Hero ${Date.now()}`, visibility: 'Client' })).body;
      const moved = (await as.PM.post(`/api/v1/tasks/${t.id}/status`, { status: 'InReview', version: t.version })).body;
      const { version } = await clientFile(`hero-${Date.now()}.png`, `&task_id=${t.id}`);
      const a = (await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).body;
      await decide(as.Contact, a.id, { decision: 'Approved' });
      expect((await db.task.findUnique({ where: { id: moved.id } })).status).toBe('Done');
      const [entry] = await auditEntries('task.status_changed', { entity_id: t.id });
      expect(entry.after).toMatchObject({ status: 'Done', reason: 'approval' });
    } finally {
      await db.project.update({ where: { id: A.id }, data: { close_task_on_approval: false } });
    }
  });

  it('a Client task can be approved too', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: `Copy ${Date.now()}`, visibility: 'Client' })).body;
    const a = (await request(as.PM, { task_id: t.id, approver_contact_ids: [W.contacts.maya.id] })).body;
    expect(a.subject).toMatchObject({ type: 'task', task: { id: t.id } });
    expect((await decide(as.Contact, a.id, { decision: 'Approved' })).body.status).toBe('Approved');
  });
});

describe('pins, cancel, supersede, history (FR-APP-02/05/06, TC-FILE-004)', () => {
  it('approvers and internal users pin numbered comments while pending; View contacts cannot', async () => {
    const { version } = await clientFile();
    const a = (await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).body;
    const p1 = await as.Contact.post(`/api/v1/portal/approvals/${a.id}/pins`, { page: 1, x: 0.25, y: 0.5, body: 'Make this bigger' });
    expect(p1.status).toBe(201);
    expect(p1.body).toMatchObject({ number: 1, page: 1, x: 0.25, y: 0.5, author: { kind: 'contact', full_name: 'Maya' } });
    const p2 = await as.TeamMember.post(`/api/v1/approvals/${a.id}/pins`, { x: 0.9, y: 0.1, body: 'Noted' });
    expect(p2.body.number).toBe(2);
    expect((await ali.post(`/api/v1/portal/approvals/${a.id}/pins`, { x: 0.1, y: 0.1, body: 'x' })).status).toBe(403);
    expect((await as.Contact.post(`/api/v1/portal/approvals/${a.id}/pins`, { x: 1.5, y: 0.1, body: 'x' })).status).toBe(422);
    const seen = (await ali.get(`/api/v1/portal/approvals/${a.id}`)).body;
    expect(seen.pins.map((p) => p.number)).toEqual([1, 2]);
    expect(seen).not.toHaveProperty('approvers.0.decision_ip');
    expect((await as.Contact.get(`/api/v1/portal/approvals/${a.id}/proof-url`)).body).toMatchObject({ inline: true, mime_type: 'image/png' });
  });

  it('FR-APP-06: the requester or the PM cancels; approvers are told; others get 403', async () => {
    const { version } = await clientFile();
    const a = (await request(as.TeamMember, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).body;
    expect((await as.Finance.post(`/api/v1/approvals/${a.id}/cancel`)).status).toBe(403);
    const res = await as.TeamMember.post(`/api/v1/approvals/${a.id}/cancel`);
    expect(res.body.status).toBe('Cancelled');
    expect(await db.notification.count({ where: { contact_id: W.contacts.maya.id, entity_id: a.id, type: 'approval_cancelled' } })).toBe(1);
    expect((await decide(as.Contact, a.id, { decision: 'Approved' })).status).toBe(409);
  });

  it('TC-FILE-004 / FR-APP-05: a new version supersedes the pending round; the history lists every round', async () => {
    const { file, version } = await clientFile();
    const a1 = (await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).body;
    await decide(as.Contact, a1.id, { decision: 'ChangesRequested', note: 'Darker blue' });
    await as.PM.upload(`/api/v1/files/${file.id}/versions`, SAMPLE_FILES.png(), { name: 'v2.png' });
    const v2 = await db.fileVersion.findFirst({ where: { file_id: file.id, version_no: 2 } });
    const a2 = (await request(as.PM, { file_version_id: v2.id, approver_contact_ids: [W.contacts.maya.id] })).body;
    await as.PM.upload(`/api/v1/files/${file.id}/versions`, SAMPLE_FILES.png(), { name: 'v3.png' });
    expect((await db.approvalRequest.findUnique({ where: { id: a2.id } })).status).toBe('Superseded');
    const history = (await as.PM.get(`/api/v1/approvals?file_id=${file.id}`)).body.data;
    expect(history.map((h) => [h.subject.version_no, h.status])).toEqual([
      [2, 'Superseded'],
      [1, 'ChangesRequested'],
    ]);
    expect(history[1].approvers[0]).toMatchObject({ decision: 'ChangesRequested', decision_note: 'Darker blue' });
    // Only the latest version can be sent; v1 now is refused
    expect((await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id] })).status).toBe(422);
  });
});

describe('reminders and dashboard (FR-APP-07, D-33)', () => {
  it('reminds approvers who have not decided, one day before and on the due date, once each', async () => {
    const today = workspaceToday({ timezone: 'Asia/Amman' });
    const { version } = await clientFile();
    const a = (await request(as.PM, { file_version_id: version.id, approver_contact_ids: [W.contacts.maya.id, second.contact.id], rule: 'All', due_date: addDays(today, 1) })).body;
    await decide(second.client, a.id, { decision: 'Approved' });
    await sendApprovalReminders();
    await sendApprovalReminders();
    const count = (contactId) => db.notification.count({ where: { contact_id: contactId, entity_id: a.id, type: 'approval_reminder', channel: 'InApp' } });
    expect(await count(W.contacts.maya.id)).toBe(1);
    expect(await count(second.contact.id)).toBe(0); // already decided
    await db.approvalRequest.update({ where: { id: a.id }, data: { due_date: new Date(`${today}T00:00:00Z`) } });
    await sendApprovalReminders();
    expect(await count(W.contacts.maya.id)).toBe(2);
  });

  it('the approval cards count pending approvals and open the same list', async () => {
    const admin = (await as.Admin.get('/api/v1/dashboard')).body.cards.find((c) => c.key === 'awaiting_client_approval');
    expect(admin.link).toBe('/approvals?status=Pending');
    expect((await as.Admin.get('/api/v1/approvals?status=Pending')).body.total).toBe(admin.count);
    expect(admin.count).toBeGreaterThan(0);
    const pm = (await as.PM.get('/api/v1/dashboard')).body.cards.find((c) => c.key === 'approvals_pending');
    expect((await as.PM.get('/api/v1/approvals?status=Pending&mine=true')).body.total).toBe(pm.count);
    // A Team Member not on the project sees none of them
    expect((await as.TeamMember2.get('/api/v1/approvals?status=Pending')).body.data.every((x) => x.project.id !== A.id)).toBe(true);
  });
});
