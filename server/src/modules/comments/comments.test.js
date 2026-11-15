// API tests for comments: FR-COM-01…04/06, BR-COM-01/02, BR-NOT-01, TC-COM-001/002, TC-NOT-001, D-34.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FILES, STANDARD_ERROR, auditEntries } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');

const app = createApp();
let W;
let as;
let A;
let task; // Internal task on Project A
let clientTask; // Client-visible task on Project A

beforeAll(async () => {
  W = await createWorld('Comments');
  as = await W.loginAll(app);
  A = W.projects.A;
  task = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Homepage design', assignee_ids: [W.users.member.id] })).body;
  clientTask = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: 'Size filter', visibility: 'Client' })).body;
});

const post = (c, body) => c.post('/api/v1/comments', body);
const onTask = (t, extra = {}) => ({ entity_type: 'Task', entity_id: t.id, body: '<p>Looks good</p>', ...extra });
const notes = (where) => db.notification.findMany({ where: { workspace_id: W.workspace.id, ...where } });

describe('post and read (FR-COM-01/02)', () => {
  it('a member comments on a task: Internal by default, cleaned rich text, shown to other members', async () => {
    const res = await post(as.TeamMember, onTask(task, { body: '<p><strong>Done</strong> with <a href="https://example.com">v1</a></p>' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ visibility: 'Internal', author: { kind: 'user', full_name: 'Omar' }, edited: false, deleted: false, permissions: { edit: true, delete: true } });
    expect(res.body.body).toBe('<p><strong>Done</strong> with <a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">v1</a></p>');
    const list = await as.PM.get(`/api/v1/comments?entity_type=Task&entity_id=${task.id}`);
    expect(list.body.data.map((c) => c.id)).toContain(res.body.id);
    const [entry] = await auditEntries('comment.created', { entity_id: res.body.id });
    expect(entry.after).toMatchObject({ on: 'Task', on_title: 'Homepage design', visibility: 'Internal' });
  });

  it('TC-COM-002: <script> is stored as harmless text, never as a script', async () => {
    const res = await post(as.PM, onTask(task, { body: '<script>alert(1)</script><p onclick="x()">Hi <img src=x onerror=alert(1)></p>' }));
    expect(res.status).toBe(201);
    expect(res.body.body).not.toMatch(/<script|onerror|onclick|<img/i);
    const raw = await db.comment.findUnique({ where: { id: res.body.id } });
    expect(raw.body).not.toMatch(/<script|onerror|onclick/i);
  });

  it('1–10,000 visible characters; attachments at most 5', async () => {
    expect((await post(as.PM, onTask(task, { body: '<p>   </p>' }))).status).toBe(422);
    expect((await post(as.PM, onTask(task, { body: `<p>${'a'.repeat(10_001)}</p>` }))).status).toBe(422);
    expect((await post(as.PM, onTask(task, { body: `<p>${'a'.repeat(10_000)}</p>` }))).status).toBe(201);
    const ids = Array.from({ length: 6 }, () => crypto.randomUUID());
    expect((await post(as.PM, onTask(task, { attachment_file_ids: ids }))).status).toBe(422);
  });

  it('attachments are files of the project; a Client comment cannot carry an Internal file (BR-COM-01)', async () => {
    const internalFile = (await as.PM.upload(`/api/v1/projects/${A.id}/files`, SAMPLE_FILES.pdf(), { name: 'internal.pdf' })).body;
    const ok = await post(as.PM, onTask(task, { attachment_file_ids: [internalFile.id] }));
    expect(ok.status).toBe(201);
    expect(ok.body.attachments).toEqual([expect.objectContaining({ file_id: internalFile.id, name: 'internal.pdf' })]);
    const leak = await post(as.PM, onTask(clientTask, { visibility: 'Client', attachment_file_ids: [internalFile.id] }));
    expect(leak.status).toBe(422);
    expect(leak.body.fields[0].field).toBe('attachment_file_ids');
  });

  it('Client comments only on Client-visible items; contacts see only Client comments (BR-COM-01)', async () => {
    expect((await post(as.PM, onTask(task, { visibility: 'Client' }))).status).toBe(422);
    const shared = await post(as.PM, onTask(clientTask, { visibility: 'Client', body: '<p>For Maya</p>' }));
    const internal = await post(as.PM, onTask(clientTask, { body: '<p>Internal note</p>' }));
    expect(shared.status).toBe(201);
    expect(internal.status).toBe(201);
    expect((await as.Contact.get(`/api/v1/comments?entity_type=Task&entity_id=${clientTask.id}`)).status).toBe(404); // D-40
    const seen = await as.Contact.get(`/api/v1/portal/comments?entity_type=Task&entity_id=${clientTask.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.data.map((c) => c.id)).toEqual([shared.body.id]);
    // An Internal task's comments: 404 for the contact
    expect((await as.Contact.get(`/api/v1/portal/comments?entity_type=Task&entity_id=${task.id}`)).status).toBe(404);
    // Contacts' own comments are always Client
    const mine = await as.Contact.post('/api/v1/portal/comments', { entity_type: 'Task', entity_id: clientTask.id, body: '<p>From the client</p>' });
    expect(mine.status).toBe(201);
    expect(mine.body.visibility).toBe('Client');
  });

  it('roles: a non-member Team Member gets 403; Finance may read and comment; another client\'s contact gets 404', async () => {
    expect((await as.TeamMember2.get(`/api/v1/comments?entity_type=Task&entity_id=${task.id}`)).status).toBe(403);
    expect((await post(as.TeamMember2, onTask(task))).status).toBe(403);
    expect((await as.Finance.get(`/api/v1/comments?entity_type=Task&entity_id=${task.id}`)).status).toBe(200);
    expect((await post(as.Finance, onTask(task))).status).toBe(201);
    const omarN = await W.login(app, 'omarN');
    expect((await omarN.get(`/api/v1/comments?entity_type=Task&entity_id=${clientTask.id}`)).status).toBe(404);
    const unknown = await as.PM.get(`/api/v1/comments?entity_type=Task&entity_id=${crypto.randomUUID()}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject(STANDARD_ERROR);
  });
});

describe('mentions and notifications (FR-COM-03, FR-NOT-02/05, BR-COM-02, BR-NOT-01)', () => {
  it('a mentioned member is notified in-app and by email; followers hear about the comment', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: `Mentions ${Date.now()}` })).body;
    // Omar follows by being assigned; Lina follows as creator
    await as.PM.patch(`/api/v1/tasks/${t.id}`, { assignee_ids: [W.users.member.id], version: t.version });
    const res = await post(as.Admin, { entity_type: 'Task', entity_id: t.id, body: '<p>@Lina please check</p>', mention_user_ids: [W.users.pm.id] });
    expect(res.status).toBe(201);
    expect(res.body.mentions).toEqual([{ id: W.users.pm.id, full_name: 'Lina' }]);
    const lina = await notes({ user_id: W.users.pm.id, entity_id: t.id, type: 'mentioned' });
    expect(lina.map((n) => n.channel).sort()).toEqual(['Email', 'InApp']);
    expect(lina[0].payload.link).toContain(`comment=${res.body.id}`);
    // Lina was mentioned, so she does not also get the follower notification
    expect(await notes({ user_id: W.users.pm.id, entity_id: t.id, type: 'comment_on_followed' })).toHaveLength(0);
    expect(await notes({ user_id: W.users.member.id, entity_id: t.id, type: 'comment_on_followed', channel: 'InApp' })).toHaveLength(1);
    // The commenter now follows the task (FR-NOT-05)
    expect(await db.follower.count({ where: { entity_type: 'Task', entity_id: t.id, user_id: W.users.admin.id } })).toBe(1);
  });

  it('BR-COM-02: mentioning someone who is not on the project is blocked with their name', async () => {
    const res = await post(as.PM, onTask(task, { mention_user_ids: [W.users.member2.id] }));
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual([expect.objectContaining({ field: 'mention_user_ids', message: 'Rana is not on this project', user_id: W.users.member2.id })]);
    // Owner, Admin and Finance can read every project, so they can be mentioned
    expect((await post(as.PM, onTask(task, { mention_user_ids: [W.users.finance.id] }))).status).toBe(201);
  });

  it('TC-NOT-001 / BR-NOT-01: Lina commenting on her own task is not notified', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: `Own ${Date.now()}` })).body;
    await post(as.PM, { entity_type: 'Task', entity_id: t.id, body: '<p>Note to self</p>', mention_user_ids: [W.users.pm.id] });
    expect(await notes({ user_id: W.users.pm.id, entity_id: t.id })).toHaveLength(0);
  });

  it('TC-COM-001 / BR-COM-01: Maya follows a task; an Internal comment never reaches her, a Client one does', async () => {
    await db.follower.createMany({ data: [{ workspace_id: W.workspace.id, entity_type: 'Task', entity_id: clientTask.id, contact_id: W.contacts.maya.id }], skipDuplicates: true });
    await db.notification.deleteMany({ where: { contact_id: W.contacts.maya.id, entity_id: clientTask.id } });
    await post(as.PM, onTask(clientTask, { body: '<p>Internal: margin is thin</p>' }));
    expect(await notes({ contact_id: W.contacts.maya.id, entity_id: clientTask.id })).toHaveLength(0);
    await post(as.PM, onTask(clientTask, { visibility: 'Client', body: '<p>Shipped</p>' }));
    const got = await notes({ contact_id: W.contacts.maya.id, entity_id: clientTask.id });
    // Contacts' default for comments on followed items is in-app only (D-35); the link opens the portal
    expect(got.map((n) => n.channel)).toEqual(['InApp']);
    expect(got[0].payload.link.startsWith('/portal/projects/')).toBe(true);
    expect(JSON.stringify(got)).not.toMatch(/margin is thin/);
  });

  it('FR-NOT-03: a person who turned an event off gets nothing; in_app gets no email', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${A.id}/tasks`, { title: `Prefs ${Date.now()}` })).body;
    expect((await as.TeamMember.put('/api/v1/me/notification-preferences', { mentioned: 'off' })).status).toBe(200);
    expect((await as.Finance.put('/api/v1/me/notification-preferences', { mentioned: 'in_app' })).status).toBe(200);
    await post(as.PM, { entity_type: 'Task', entity_id: t.id, body: '<p>Hi both</p>', mention_user_ids: [W.users.member.id, W.users.finance.id] });
    expect(await notes({ user_id: W.users.member.id, entity_id: t.id, type: 'mentioned' })).toHaveLength(0);
    expect((await notes({ user_id: W.users.finance.id, entity_id: t.id, type: 'mentioned' })).map((n) => n.channel)).toEqual(['InApp']);
    await as.TeamMember.put('/api/v1/me/notification-preferences', { mentioned: 'email' });
  });
});

describe('edit and delete (FR-COM-04, D-34 a)', () => {
  it('the author edits within 24 h ("edited"); after 24 h the edit is refused; others cannot edit', async () => {
    const c = (await post(as.TeamMember, onTask(task, { body: '<p>Frist draft</p>' }))).body;
    expect((await as.PM.patch(`/api/v1/comments/${c.id}`, { body: '<p>Hijack</p>', version: c.version })).status).toBe(403);
    const edited = await as.TeamMember.patch(`/api/v1/comments/${c.id}`, { body: '<p>First draft</p>', version: c.version });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ body: '<p>First draft</p>', edited: true });
    expect((await as.TeamMember.patch(`/api/v1/comments/${c.id}`, { body: '<p>Stale</p>', version: c.version })).status).toBe(409);
    await db.comment.update({ where: { id: c.id }, data: { created_at: new Date(Date.now() - 25 * 3_600_000) } });
    const late = await as.TeamMember.patch(`/api/v1/comments/${c.id}`, { body: '<p>Too late</p>', version: edited.body.version });
    expect(late.status).toBe(409);
    expect(late.body.message).toMatch(/24 hours/);
  });

  it('the author deletes their own; Admin deletes any; others get 403; the list shows a placeholder', async () => {
    const c1 = (await post(as.TeamMember, onTask(task, { body: '<p>Oops</p>' }))).body;
    const c2 = (await post(as.TeamMember, onTask(task, { body: '<p>Off-topic</p>' }))).body;
    expect((await as.PM.delete(`/api/v1/comments/${c1.id}`)).status).toBe(403);
    expect((await as.TeamMember.delete(`/api/v1/comments/${c1.id}`)).status).toBe(204);
    expect((await as.Admin.delete(`/api/v1/comments/${c2.id}`)).status).toBe(204);
    const list = await as.PM.get(`/api/v1/comments?entity_type=Task&entity_id=${task.id}&page_size=100`);
    const shown = list.body.data.find((c) => c.id === c1.id);
    expect(shown).toMatchObject({ deleted: true, body: null, mentions: [], attachments: [] });
    expect((await auditEntries('comment.deleted', { entity_id: c2.id }))[0].after.by_author).toBe(false);
  });
});

describe('message board (FR-COM-06, D-34 d)', () => {
  it('project posts are newest first with one level of replies; replies to Internal posts stay Internal', async () => {
    const p1 = (await post(as.PM, { entity_type: 'Project', entity_id: A.id, body: '<p>Kick-off on Monday</p>', visibility: 'Client' })).body;
    const p2 = (await post(as.PM, { entity_type: 'Project', entity_id: A.id, body: '<p>Weekly update (internal)</p>' })).body;
    const board = await as.TeamMember.get(`/api/v1/comments?entity_type=Project&entity_id=${A.id}`);
    expect(board.body.data.slice(0, 2).map((c) => c.id)).toEqual([p2.id, p1.id]);
    const reply = await post(as.TeamMember, { entity_type: 'Project', entity_id: A.id, parent_id: p2.id, body: '<p>Thanks</p>' });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ parent_id: p2.id, visibility: 'Internal' });
    expect((await post(as.TeamMember, { entity_type: 'Project', entity_id: A.id, parent_id: p2.id, body: '<p>x</p>', visibility: 'Client' })).status).toBe(422);
    expect((await post(as.TeamMember, { entity_type: 'Project', entity_id: A.id, parent_id: reply.body.id, body: '<p>nested</p>' })).status).toBe(422);
    expect((await post(as.TeamMember, onTask(task, { parent_id: p1.id }))).status).toBe(422);
    const thread = await as.PM.get(`/api/v1/comments?entity_type=Project&entity_id=${A.id}&parent_id=${p2.id}`);
    expect(thread.body.data.map((c) => c.id)).toEqual([reply.body.id]);
    expect((await as.PM.get(`/api/v1/comments?entity_type=Project&entity_id=${A.id}`)).body.data.find((c) => c.id === p2.id).reply_count).toBe(1);
    // The post's author follows the thread and hears about the reply
    expect(await notes({ user_id: W.users.pm.id, type: 'comment_on_followed', entity_id: A.id })).not.toHaveLength(0);
    // Maya sees the Client post, not the Internal one
    const maya = await as.Contact.get(`/api/v1/portal/comments?entity_type=Project&entity_id=${A.id}`);
    expect(maya.body.data.map((c) => c.id)).toContain(p1.id);
    expect(maya.body.data.map((c) => c.id)).not.toContain(p2.id);
  });

  it('the @ picker lists active internal members of the project', async () => {
    const res = await as.TeamMember.get(`/api/v1/comments/mentionable?entity_type=Task&entity_id=${task.id}`);
    expect(res.body.data.map((u) => u.full_name).sort()).toEqual(['Lina', 'Omar']);
  });
});
