// API tests for notifications: FR-NOT-01/02/03/05, BR-NOT-01, FR-TSK-02, FR-PRJ-06.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiCreateProject } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');
const { sendMail } = await import('../../lib/mailer.js');
const { sendPendingEmails, MAX_ATTEMPTS } = await import('../../jobs/outbox.js');
const { notifyDueTomorrow } = await import('../../jobs/dueTomorrow.js');
const { addDays, workspaceToday } = await import('../../lib/dates.js');

const app = createApp();
let W;
let as;
let A;

beforeAll(async () => {
  W = await createWorld('Notify');
  as = await W.loginAll(app);
  A = W.projects.A;
});
beforeEach(() => sendMail.mockClear());

const inApp = (userId, where = {}) => db.notification.findMany({ where: { user_id: userId, channel: 'InApp', ...where }, orderBy: { created_at: 'asc' } });

describe('task events (FR-TSK-02, FR-NOT-02/05)', () => {
  it('assigning someone notifies them and makes them a follower; assigning yourself does not notify you', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Wireframes', assignee_ids: [W.users.member.id, W.users.pm.id] })).body;
    const omar = await inApp(W.users.member.id, { entity_id: t.id, type: 'task_assigned' });
    expect(omar).toHaveLength(1);
    expect(omar[0].payload).toMatchObject({ title: 'Lina assigned you "Wireframes"', link: `/projects/${A.id}?tab=tasks&task=${t.id}` });
    expect(await inApp(W.users.pm.id, { entity_id: t.id })).toHaveLength(0); // BR-NOT-01
    expect(await db.follower.count({ where: { entity_type: 'Task', entity_id: t.id } })).toBe(2); // creator + assignee
  });

  it('followers hear about status changes, except the person who made the change', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Checkout', assignee_ids: [W.users.member.id] })).body;
    await as.TeamMember.post(`/api/v1/tasks/${t.id}/status`, { status: 'InProgress', version: t.version });
    const lina = await inApp(W.users.pm.id, { entity_id: t.id, type: 'followed_task_status' });
    expect(lina.map((n) => n.payload.title)).toEqual(['Omar moved "Checkout" to In progress']);
    expect(await inApp(W.users.member.id, { entity_id: t.id, type: 'followed_task_status' })).toHaveLength(0);
  });

  it('unfollowing stops status notifications (FR-NOT-05)', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Footer', assignee_ids: [W.users.member.id] })).body;
    expect((await as.PM.get(`/api/v1/follows?entity_type=Task&entity_id=${t.id}`)).body.following).toBe(true);
    expect((await as.PM.delete(`/api/v1/follows?entity_type=Task&entity_id=${t.id}`)).body.following).toBe(false);
    await as.TeamMember.post(`/api/v1/tasks/${t.id}/status`, { status: 'InProgress', version: t.version });
    expect(await inApp(W.users.pm.id, { entity_id: t.id, type: 'followed_task_status' })).toHaveLength(0);
    // Following again works; following a project you cannot read is 404
    expect((await as.PM.post('/api/v1/follows', { entity_type: 'Task', entity_id: t.id })).body.following).toBe(true);
    expect((await as.TeamMember2.post('/api/v1/follows', { entity_type: 'Task', entity_id: t.id })).status).toBe(404);
  });

  it('FR-PRJ-06: a project status change notifies the internal members', async () => {
    const p = await apiCreateProject(as.PM, { clientId: W.clients.nova.id, pmId: W.users.pm.id });
    await as.PM.post(`/api/v1/projects/${p.id}/members`, { user_id: W.users.member.id });
    const res = await as.PM.post(`/api/v1/projects/${p.id}/status`, { status: 'InProgress', version: p.version });
    expect(res.status).toBe(200);
    const omar = await inApp(W.users.member.id, { entity_id: p.id, type: 'project_status' });
    expect(omar[0].payload.title).toMatch(/changed .* to In progress$/);
    expect(await inApp(W.users.pm.id, { entity_id: p.id, type: 'project_status' })).toHaveLength(0);
  });
});

describe('the bell (FR-NOT-01)', () => {
  it('lists my notifications newest first with an unread count; marks one and all read', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Bell 1', assignee_ids: [W.users.member.id] })).body;
    await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Bell 2', assignee_ids: [W.users.member.id] });
    const list = await as.TeamMember.get('/api/v1/me/notifications?page_size=5');
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({ title: 'Lina assigned you "Bell 2"', read: false, link: expect.stringContaining('task=') });
    expect(list.body.unread).toBeGreaterThanOrEqual(2);
    const one = list.body.data.find((n) => n.entity_id === t.id);
    expect((await as.TeamMember.post(`/api/v1/me/notifications/${one.id}/read`)).status).toBe(204);
    const count = (await as.TeamMember.get('/api/v1/me/notifications/unread-count')).body.unread;
    expect(count).toBe(list.body.unread - 1);
    expect((await as.TeamMember.post('/api/v1/me/notifications/read-all')).body.marked).toBe(count);
    expect((await as.TeamMember.get('/api/v1/me/notifications/unread-count')).body.unread).toBe(0);
    // Email rows are not part of the bell
    expect(list.body.data.every((n) => n.type)).toBe(true);
  });

  it("someone else's notification answers 404 and stays unread", async () => {
    await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Private', assignee_ids: [W.users.member.id] });
    const [n] = await inApp(W.users.member.id, { read_at: null });
    expect((await as.PM.post(`/api/v1/me/notifications/${n.id}/read`)).status).toBe(404);
    expect((await db.notification.findUnique({ where: { id: n.id } })).read_at).toBeNull();
  });
});

describe('preferences (FR-NOT-03)', () => {
  it('returns every event with its channel; accepts only known events and channels', async () => {
    const res = await as.Finance.get('/api/v1/me/notification-preferences');
    // D-35: email only for assignment, mentions and due tomorrow; the rest in-app
    expect(res.body.preferences).toEqual({ task_assigned: 'email', mentioned: 'email', comment_on_followed: 'in_app', followed_task_status: 'in_app', task_due_tomorrow: 'email', project_status: 'in_app' });
    expect((await as.Finance.put('/api/v1/me/notification-preferences', { task_assigned: 'loud' })).status).toBe(422);
    expect((await as.Finance.put('/api/v1/me/notification-preferences', { password_reset: 'off' })).status).toBe(422); // security emails cannot be turned off
    const saved = await as.Finance.put('/api/v1/me/notification-preferences', { project_status: 'off' });
    expect(saved.body.preferences.project_status).toBe('off');
    expect((await as.Contact.get('/api/v1/me/notification-preferences')).status).toBe(404); // contacts: portal, Phase 5
  });

  it('D-35: only the settings a person chose are stored; the rest follow the defaults', async () => {
    await as.Admin.put('/api/v1/me/notification-preferences', { comment_on_followed: 'email' });
    const stored = (await db.user.findUnique({ where: { id: W.users.admin.id } })).notification_prefs;
    expect(stored).toEqual({ comment_on_followed: 'email' });
    const res = await as.Admin.get('/api/v1/me/notification-preferences');
    expect(res.body.preferences).toMatchObject({ comment_on_followed: 'email', followed_task_status: 'in_app', mentioned: 'email' });
  });

  it('D-35: by default followers get in-app only; assignees still get an email', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: `Defaults ${Date.now()}`, assignee_ids: [W.users.member.id] })).body;
    expect((await db.notification.findMany({ where: { entity_id: t.id, user_id: W.users.member.id, type: 'task_assigned' } })).map((n) => n.channel).sort()).toEqual(['Email', 'InApp']);
    await as.TeamMember.post(`/api/v1/tasks/${t.id}/status`, { status: 'InProgress', version: t.version });
    expect((await db.notification.findMany({ where: { entity_id: t.id, user_id: W.users.pm.id, type: 'followed_task_status' } })).map((n) => n.channel)).toEqual(['InApp']);
  });

  it('D-35 migration: stored Phase 4 settings keep only real choices', async () => {
    const sql = (await import('node:fs')).readFileSync(new URL('../../../prisma/migrations/20261101000000_notification_defaults/migration.sql', import.meta.url), 'utf8');
    const user = await W.addUser({ fullName: 'Migrated' });
    // Phase 4 stored the whole table; this person turned "project_status" off and later switched "comment_on_followed" back to email
    const full = { task_assigned: 'email', mentioned: 'email', comment_on_followed: 'email', followed_task_status: 'email', task_due_tomorrow: 'email', project_status: 'off' };
    await db.user.update({ where: { id: user.id }, data: { notification_prefs: full } });
    const log = (before, after) => db.activityLog.create({ data: { workspace_id: W.workspace.id, actor_type: 'User', actor_id: user.id, action: 'user.notification_prefs_changed', entity_type: 'User', entity_id: user.id, before, after } });
    await log({ ...full, project_status: 'email' }, { ...full, comment_on_followed: 'off' });
    await log({ ...full, comment_on_followed: 'off' }, full);
    // Run the migration for this user only (other test files run at the same time)
    await db.$executeRawUnsafe(sql.replace(/;\s*$/, ` AND u."id" = '${user.id}'::uuid;`));
    expect((await db.user.findUnique({ where: { id: user.id } })).notification_prefs).toEqual({ comment_on_followed: 'email', project_status: 'off' });
  });
});

describe('email outbox (FR-NOT-02)', () => {
  it('sends pending emails once, with the link; failures are retried up to the limit', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Outbox', assignee_ids: [W.users.member.id] })).body;
    const row = await db.notification.findFirst({ where: { entity_id: t.id, channel: 'Email', user_id: W.users.member.id } });
    expect(row.sent_at).toBeNull();
    await sendPendingEmails({ limit: 1000 });
    const mail = sendMail.mock.calls.map(([m]) => m).find((m) => m.subject === 'Assigned to you: Outbox');
    expect(mail).toMatchObject({ to: W.users.member.email });
    expect(mail.text).toContain(`/projects/${A.id}?tab=tasks&task=${t.id}`);
    expect((await db.notification.findUnique({ where: { id: row.id } })).sent_at).not.toBeNull();
    sendMail.mockClear();
    await sendPendingEmails({ limit: 1000 });
    expect(sendMail.mock.calls.some(([m]) => m.subject === 'Assigned to you: Outbox')).toBe(false);

    const t2 = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Flaky', assignee_ids: [W.users.member.id] })).body;
    sendMail.mockRejectedValue(new Error('SMTP down'));
    for (let i = 0; i < MAX_ATTEMPTS + 1; i += 1) await sendPendingEmails({ limit: 1000 });
    sendMail.mockResolvedValue({});
    const failed = await db.notification.findFirst({ where: { entity_id: t2.id, channel: 'Email' } });
    expect(failed).toMatchObject({ sent_at: null, attempts: MAX_ATTEMPTS, last_error: 'SMTP down' });
  });
});

describe('due tomorrow (FR-NOT-02)', () => {
  it('assignees of open tasks due tomorrow are told once; done tasks and other days are skipped', async () => {
    const tomorrow = addDays(workspaceToday({ timezone: 'Asia/Amman' }), 1);
    const due = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Due soon', due_date: tomorrow, assignee_ids: [W.users.member.id] })).body;
    const later = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Due later', due_date: addDays(tomorrow, 3), assignee_ids: [W.users.member.id] })).body;
    await notifyDueTomorrow(new Date(), { force: true });
    await notifyDueTomorrow(new Date(), { force: true }); // safe to run twice
    expect(await inApp(W.users.member.id, { entity_id: due.id, type: 'task_due_tomorrow' })).toHaveLength(1);
    expect(await inApp(W.users.member.id, { entity_id: later.id, type: 'task_due_tomorrow' })).toHaveLength(0);
  });
});
