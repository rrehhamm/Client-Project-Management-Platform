// API tests for the audit log: FR-ACT-02, BR-ACT-01, E2E-05, D-34 (b).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { client } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');
const { csvCell } = await import('./routes.js');

const app = createApp();
let W;
let as;

beforeAll(async () => {
  W = await createWorld('Audit');
  as = await W.loginAll(app);
});

describe('audit log view (FR-ACT-02)', () => {
  it('Owner and Admin see entries with actor, before/after, IP and user agent; others get 403/404', async () => {
    const t = (await as.PM.post(`/api/v1/projects/${W.projects.A.id}/tasks`, { title: 'Audited' })).body;
    await as.PM.patch(`/api/v1/tasks/${t.id}`, { priority: 'High', version: t.version });
    const res = await as.Admin.get(`/api/v1/audit?entity_type=Task&action=task.&actor_id=${W.users.pm.id}`);
    expect(res.status).toBe(200);
    const entry = res.body.data.find((e) => e.action === 'task.updated' && e.entity_id === t.id);
    expect(entry).toMatchObject({ actor: { type: 'User', name: 'Lina' }, before: { priority: 'Normal' }, after: { priority: 'High' }, user_agent: 'cpm-api-tests' });
    expect(entry.ip).toBeTruthy();
    expect(res.body.data.every((e) => e.action.startsWith('task.') && e.actor.id === W.users.pm.id)).toBe(true);
    expect((await as.Owner.get('/api/v1/audit')).status).toBe(200);
    for (const role of ['PM', 'TeamMember', 'Finance']) expect((await as[role].get('/api/v1/audit')).status).toBe(403);
    expect((await as.Contact.get('/api/v1/audit')).status).toBe(404);
  });

  it('filters by date in the workspace timezone; entries of other workspaces never show', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(new Date());
    const res = await as.Admin.get(`/api/v1/audit?from=${today}&to=${today}&page_size=100`);
    expect(res.body.total).toBeGreaterThan(0);
    expect((await as.Admin.get('/api/v1/audit?to=2020-01-01')).body.total).toBe(0);
    const other = await createWorld('Audit other');
    const otherOwner = await other.login(app, 'owner');
    const theirs = await otherOwner.get('/api/v1/audit?page_size=100');
    expect(theirs.body.data.every((e) => e.actor.id !== W.users.pm.id)).toBe(true);
  });

  it('exports CSV with every column; formula-like cells are neutralised', async () => {
    const res = await as.Admin.get('/api/v1/audit/export.csv?action=task.');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-log-/);
    expect(res.text.split('\r\n')[0]).toBe('﻿created_at,actor_type,actor_name,actor_email,action,entity_type,entity_id,project_id,client_id,before,after,ip,user_agent,request_id');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell({ a: 'b,c' })).toBe('"{""a"":""b,c""}"');
    expect((await as.PM.get('/api/v1/audit/export.csv')).status).toBe(403);
  });

  it('BR-ACT-01: there is no route that changes or removes entries', async () => {
    const [entry] = (await as.Owner.get('/api/v1/audit?page_size=1')).body.data;
    expect((await as.Owner.patch(`/api/v1/audit/${entry.id}`, { action: 'x' })).status).toBe(404);
    expect((await as.Owner.delete(`/api/v1/audit/${entry.id}`)).status).toBe(404);
    await expect(db.activityLog.delete({ where: { id: entry.id } })).rejects.toThrow();
  });
});

describe('denied attempts are recorded (E2E-05, D-34 b)', () => {
  it('a signed-out API call (401), a Team Member delete (403) and a contact on another client\'s project (404) are all logged', async () => {
    const anon = await client(app);
    const marker = `/api/v1/projects/${W.projects.A.id}?probe=${Date.now()}`;
    expect((await anon.get(marker)).status).toBe(401);
    expect((await as.TeamMember.delete(`/api/v1/projects/${W.projects.A.id}`)).status).toBe(403);
    expect((await as.Contact.get(`/api/v1/projects/${W.projects.B.id}`)).status).toBe(404);

    const denied = await db.activityLog.findMany({ where: { action: 'access.denied', created_at: { gte: new Date(Date.now() - 60_000) } } });
    const paths = denied.map((d) => d.after);
    expect(paths).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: marker, reason: 'signed_out', method: 'GET' }),
    ]));
    expect(denied.some((d) => d.actor_id === W.users.member.id && d.after.method === 'DELETE')).toBe(true);
    expect(denied.some((d) => d.actor_id === W.contacts.maya.id && d.after.path === `/api/v1/projects/${W.projects.B.id}`)).toBe(true);
    // Nothing changed
    expect((await db.project.findUnique({ where: { id: W.projects.A.id } })).deleted_at).toBeNull();
  });
});
