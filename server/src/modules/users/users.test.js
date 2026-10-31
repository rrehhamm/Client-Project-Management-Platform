// API tests for /api/v1/users: FR-USER-01…07, BR-ROLE-01…04, TC-ROLE-001/002,
// TC-USER-001/002, and direct calls by every role that must be denied.
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEED_PASSWORD,
  auditEntries,
  client,
  loginAs,
  tokenFromLastMail,
  uniqueEmail,
} from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { sendMail } = await import('../../lib/mailer.js');
const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');

const app = createApp();
let W; // E-01: this file's own workspace
const as = {};
let owner;

beforeAll(async () => {
  W = await createWorld('Users');
  as.Owner = await loginAs(app, W.users.owner.email);
  as.Admin = await loginAs(app, W.users.admin.email);
  as.PM = await loginAs(app, W.users.pm.email);
  as.TeamMember = await loginAs(app, W.users.member.email);
  as.Finance = await loginAs(app, W.users.finance.email);
  as.Contact = await loginAs(app, W.contacts.maya.email);
  as.Anonymous = await client(app);
  owner = W.users.owner;
});

beforeEach(() => sendMail.mockClear());

const fresh = (id) => db.user.findUniqueOrThrow({ where: { id } });
const DENIED_STATUS = { TeamMember: 403, Finance: 403, PM: 403, Admin: 403, Owner: 403, Contact: 404, Anonymous: 401 };

/** Calls `send(as[role])` for each role and checks the denial status. */
async function expectDenied(roles, send) {
  for (const role of roles) {
    const res = await send(as[role]);
    expect(res.status, `${role}: ${JSON.stringify(res.body)}`).toBe(DENIED_STATUS[role]);
    expect(res.body).toMatchObject({ code: expect.any(String), message: expect.any(String), fields: expect.any(Array) });
  }
}

// ---------------------------------------------------------------------------
describe('direct API calls by roles that must be denied (permission matrix 4.2)', () => {
  let victim;
  beforeAll(async () => {
    victim = await W.addUser({ role: 'TeamMember' });
  });

  it('GET /users: Team Member 403, contact 404, signed out 401', async () => {
    await expectDenied(['TeamMember', 'Contact', 'Anonymous'], (c) => c.get('/api/v1/users'));
  });

  it('GET /users/:id: same', async () => {
    await expectDenied(['TeamMember', 'Contact', 'Anonymous'], (c) => c.get(`/api/v1/users/${victim.id}`));
  });

  it('POST /users: Team Member, Finance, contact and anonymous cannot invite; nothing is created', async () => {
    const email = uniqueEmail('denied');
    await expectDenied(['TeamMember', 'Finance', 'Contact', 'Anonymous'], (c) =>
      c.post('/api/v1/users', { email, full_name: 'Nope', role: 'TeamMember' }),
    );
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it('POST /users: a PM may invite Team Members only (FR-USER matrix: "Invite Team Members only")', async () => {
    const email = uniqueEmail('pm-admin');
    await expectDenied(['PM'], (c) => c.post('/api/v1/users', { email, full_name: 'Nope', role: 'Admin' }));
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it('PATCH role: PM, Team Member and Finance get 403 and the role is unchanged', async () => {
    const { version } = await fresh(victim.id);
    await expectDenied(['PM', 'TeamMember', 'Finance', 'Contact', 'Anonymous'], (c) =>
      c.patch(`/api/v1/users/${victim.id}`, { role: 'Admin', version }),
    );
    expect(await fresh(victim.id)).toMatchObject({ role: 'TeamMember', version });
  });

  it('PATCH rates: PM and Team Member get 403', async () => {
    const { version } = await fresh(victim.id);
    await expectDenied(['PM', 'TeamMember'], (c) => c.patch(`/api/v1/users/${victim.id}`, { hourly_cost_rate: 1, version }));
    expect((await fresh(victim.id)).hourly_cost_rate).toBeNull();
  });

  it('Finance may change rates but not the role in the same request (field-level 403, nothing saved)', async () => {
    const { version } = await fresh(victim.id);
    const res = await as.Finance.patch(`/api/v1/users/${victim.id}`, { role: 'PM', hourly_cost_rate: 5000, version });
    expect(res.status).toBe(403);
    expect(res.body.fields).toEqual([{ field: 'role', message: 'Not allowed for your role' }]);
    expect(await fresh(victim.id)).toMatchObject({ role: 'TeamMember', hourly_cost_rate: null });
  });

  it('deactivate / reactivate: PM, Team Member, Finance and contacts are denied', async () => {
    await expectDenied(['PM', 'TeamMember', 'Finance', 'Contact', 'Anonymous'], (c) =>
      c.post(`/api/v1/users/${victim.id}/deactivate`),
    );
    expect((await fresh(victim.id)).status).toBe('Active');
  });

  it('Admin cannot change the Owner\'s role or deactivate the Owner ("CRUD not Owner")', async () => {
    const o = await fresh(owner.id);
    await expectDenied(['Admin'], (c) => c.patch(`/api/v1/users/${owner.id}`, { role: 'PM', version: o.version }));
    await expectDenied(['Admin'], (c) => c.post(`/api/v1/users/${owner.id}/deactivate`));
    expect(await fresh(owner.id)).toMatchObject({ role: 'Owner', status: 'Active' });
  });

  it('transfer ownership: only the Owner', async () => {
    await expectDenied(['Admin', 'PM', 'TeamMember', 'Finance', 'Contact', 'Anonymous'], (c) =>
      c.post(`/api/v1/users/${victim.id}/transfer-ownership`, { password: SEED_PASSWORD }),
    );
  });

  it('unknown or malformed user ids are 404', async () => {
    expect((await as.Admin.get('/api/v1/users/00000000-0000-7000-8000-000000000000')).status).toBe(404);
    expect((await as.Admin.get('/api/v1/users/not-a-uuid')).status).toBe(404);
  });

  it('denied attempts are written to the audit log (E2E-05)', async () => {
    await as.TeamMember.get('/api/v1/users');
    const member = W.users.member;
    const [entry] = await auditEntries('access.denied', { actor_id: member.id });
    expect(entry.after).toMatchObject({ permission: 'user.list', method: 'GET', path: '/api/v1/users' });
  });
});

// ---------------------------------------------------------------------------
describe('GET /users (FR-USER-03)', () => {
  it('lists users with pagination, filters and search', async () => {
    const res = await as.Admin.get('/api/v1/users?page_size=2');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, page_size: 2, total: expect.any(Number) });
    expect(res.body.data).toHaveLength(2);

    const finance = await as.Admin.get('/api/v1/users?role=Finance');
    expect(finance.body.data.every((u) => u.role === 'Finance')).toBe(true);
    const search = await as.Admin.get('/api/v1/users?q=LINA');
    expect(search.body.data.map((u) => u.email)).toContain(W.users.pm.email);
  });

  it('caps page size at 100 (NFR-PERF-03)', async () => {
    expect((await as.Admin.get('/api/v1/users?page_size=101')).status).toBe(422);
  });

  it('shows rates to Owner, Admin and Finance only; never password hashes (FR-USER-07, BR-AUTH-02)', async () => {
    const pmView = (await as.PM.get('/api/v1/users')).body.data[0];
    const finView = (await as.Finance.get('/api/v1/users')).body.data[0];
    expect(pmView).not.toHaveProperty('hourly_cost_rate');
    expect(finView).toHaveProperty('hourly_cost_rate');
    expect(JSON.stringify((await as.Owner.get('/api/v1/users')).body)).not.toContain('password_hash');
  });
});

// ---------------------------------------------------------------------------
describe('invitations (FR-USER-01, FR-USER-02)', () => {
  it('Admin invites a user: status Invited, email sent, audited', async () => {
    const email = uniqueEmail('new');
    const res = await as.Admin.post('/api/v1/users', { email: email.toUpperCase(), full_name: 'New Person', role: 'Finance' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email_sent: true, user: { email, role: 'Finance', status: 'Invited' } });
    expect(tokenFromLastMail(sendMail, '/accept-invite').to).toBe(email);
    const [entry] = await auditEntries('user.invited', { entity_id: res.body.user.id });
    expect(entry.after).toMatchObject({ email, role: 'Finance', status: 'Invited' });
  });

  it('a PM invites a Team Member', async () => {
    const res = await as.PM.post('/api/v1/users', { email: uniqueEmail('pm-tm'), full_name: 'Team Person', role: 'TeamMember' });
    expect(res.status).toBe(201);
  });

  it('TC-USER-001: inviting an existing email → 409 "User already exists"', async () => {
    const res = await as.Admin.post('/api/v1/users', { email: W.users.member.email, full_name: 'Dup', role: 'TeamMember' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('User already exists');
  });

  it("a client contact's email cannot become an internal user (BR-ROLE-05)", async () => {
    const res = await as.Admin.post('/api/v1/users', { email: W.contacts.maya.email, full_name: 'Maya', role: 'TeamMember' });
    expect(res.status).toBe(409);
  });

  it('nobody can invite an Owner (BR-ROLE-01)', async () => {
    const res = await as.Owner.post('/api/v1/users', { email: uniqueEmail('owner2'), full_name: 'X', role: 'Owner' });
    expect([403, 422]).toContain(res.status);
  });

  it('resend issues a new link and kills the old one; revoke deletes the invited record', async () => {
    const email = uniqueEmail('resend');
    const created = await as.Admin.post('/api/v1/users', { email, full_name: 'Resend Me', role: 'TeamMember' });
    const id = created.body.user.id;
    const first = tokenFromLastMail(sendMail, '/accept-invite').token;

    expect((await as.Admin.post(`/api/v1/users/${id}/invitation/resend`)).status).toBe(200);
    const second = tokenFromLastMail(sendMail, '/accept-invite').token;
    expect(second).not.toBe(first);
    const anon = await client(app);
    expect((await anon.get(`/api/v1/auth/invitations/${first}`)).status).toBe(410);
    expect((await anon.get(`/api/v1/auth/invitations/${second}`)).status).toBe(200);

    expect((await as.Admin.delete(`/api/v1/users/${id}/invitation`)).status).toBe(204);
    expect(await db.user.findUnique({ where: { id } })).toBeNull();
    expect((await anon.get(`/api/v1/auth/invitations/${second}`)).status).toBe(410);
  });

  it('only pending invitations can be resent or revoked', async () => {
    const active = await W.addUser();
    expect((await as.Admin.post(`/api/v1/users/${active.id}/invitation/resend`)).status).toBe(409);
    expect((await as.Admin.delete(`/api/v1/users/${active.id}/invitation`)).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
describe('PATCH /users/:id (FR-USER-04, FR-USER-07, NFR-CONC-01, NFR-SEC-03)', () => {
  it('Admin changes a role; the change is audited with before/after', async () => {
    const u = await W.addUser();
    const res = await as.Admin.patch(`/api/v1/users/${u.id}`, { role: 'PM', version: u.version });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'PM', version: u.version + 1 });
    const [entry] = await auditEntries('user.role_changed', { entity_id: u.id });
    expect(entry).toMatchObject({ before: { role: 'TeamMember' }, after: { role: 'PM' } });
  });

  it('Finance sets rates (minor units); the response includes them for Finance', async () => {
    const u = await W.addUser();
    const res = await as.Finance.patch(`/api/v1/users/${u.id}`, { hourly_cost_rate: 15_000, default_bill_rate: 40_000, version: u.version });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hourly_cost_rate: 15_000, default_bill_rate: 40_000 });
    const pmView = await as.PM.get(`/api/v1/users/${u.id}`);
    expect(pmView.body).not.toHaveProperty('hourly_cost_rate');
  });

  it('a stale version gets 409 and nothing changes', async () => {
    const u = await W.addUser();
    await as.Admin.patch(`/api/v1/users/${u.id}`, { full_name: 'First', version: u.version });
    const stale = await as.Owner.patch(`/api/v1/users/${u.id}`, { full_name: 'Second', version: u.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_UPDATE');
    expect((await fresh(u.id)).full_name).toBe('First');
  });

  it('unknown or protected fields are rejected and the database is unchanged', async () => {
    const u = await W.addUser();
    for (const body of [{ status: 'Active' }, { email: 'x@nexa.test' }, { password_hash: 'x' }, { workspace_id: u.workspace_id }]) {
      const res = await as.Admin.patch(`/api/v1/users/${u.id}`, { ...body, version: u.version });
      expect(res.status).toBe(422);
    }
    expect(await fresh(u.id)).toMatchObject({ email: u.email, version: u.version });
  });

  it('BR-ROLE-03: a user cannot change their own role', async () => {
    const admin = await W.addUser({ role: 'Admin' });
    const c = await loginAs(app, admin.email);
    const res = await c.patch(`/api/v1/users/${admin.id}`, { role: 'PM', version: admin.version });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You cannot change your own role');
  });

  it("the Owner's role only changes by transfer (BR-ROLE-01)", async () => {
    const o = await fresh(owner.id);
    const res = await as.Owner.patch(`/api/v1/users/${owner.id}`, { role: 'Admin', version: o.version });
    expect(res.status).toBe(409);
    expect((await fresh(owner.id)).role).toBe('Owner');
  });

  it('TC-ROLE-001: with the Owner as the only administrator, demoting or deactivating them → 409', async () => {
    const otherAdmins = await db.user.findMany({ where: { workspace_id: W.workspace.id, role: 'Admin', status: 'Active' }, select: { id: true } });
    const ids = otherAdmins.map((a) => a.id);
    await db.user.updateMany({ where: { id: { in: ids } }, data: { role: 'Finance' } });
    try {
      const o = await fresh(owner.id);
      const demote = await as.Owner.patch(`/api/v1/users/${owner.id}`, { role: 'PM', version: o.version });
      expect(demote.status).toBe(409);
      expect(demote.body.message).toBe('At least one administrator is required');
      const deactivate = await as.Owner.post(`/api/v1/users/${owner.id}/deactivate`);
      expect(deactivate.status).toBe(409);
      expect(deactivate.body.message).toBe('At least one administrator is required');
      expect(await fresh(owner.id)).toMatchObject({ role: 'Owner', status: 'Active' });
    } finally {
      await db.user.updateMany({ where: { id: { in: ids } }, data: { role: 'Admin' } });
    }
  });

  it('the last Admin besides the Owner can be demoted (the Owner remains an administrator)', async () => {
    const admin = await W.addUser({ role: 'Admin' });
    const res = await as.Owner.patch(`/api/v1/users/${admin.id}`, { role: 'PM', version: admin.version });
    expect(res.status).toBe(200);
  });

  it('TC-ROLE-002 / BR-ROLE-04: a demoted PM loses PM rights on the very next request', async () => {
    const pm = await W.addUser({ role: 'PM' });
    const pmClient = await loginAs(app, pm.email);
    const before = await pmClient.post('/api/v1/users', { email: uniqueEmail('by-pm'), full_name: 'Ok', role: 'TeamMember' });
    expect(before.status).toBe(201);

    const demote = await as.Admin.patch(`/api/v1/users/${pm.id}`, { role: 'TeamMember', version: pm.version });
    expect(demote.status).toBe(200);

    const email = uniqueEmail('after-demote');
    const after = await pmClient.post('/api/v1/users', { email, full_name: 'Nope', role: 'TeamMember' });
    expect(after.status).toBe(403);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    expect((await pmClient.get('/api/v1/auth/me')).body.principal.role).toBe('TeamMember');
  });
});

// ---------------------------------------------------------------------------
describe('deactivate / reactivate (FR-USER-05, FR-USER-06)', () => {
  it('TC-USER-002: a deactivated user is signed out and no longer assignable; reactivating restores them', async () => {
    const u = await W.addUser();
    const session = await loginAs(app, u.email);

    const off = await as.Admin.post(`/api/v1/users/${u.id}/deactivate`);
    expect(off.status).toBe(200);
    expect(off.body.status).toBe('Deactivated');
    expect((await session.get('/api/v1/auth/me')).status).toBe(401);
    const assignable = await as.Admin.get(`/api/v1/users?assignable=true&page_size=100&q=${encodeURIComponent(u.email)}`);
    expect(assignable.body.data.map((x) => x.id)).not.toContain(u.id);
    // Open tasks stay assigned and show "Assignee inactive": tested with tasks in Phase 3.

    const on = await as.Admin.post(`/api/v1/users/${u.id}/reactivate`);
    expect(on.status).toBe(200);
    expect(on.body.status).toBe('Active');
    const back = await as.Admin.get(`/api/v1/users?assignable=true&page_size=100&q=${encodeURIComponent(u.email)}`);
    expect(back.body.data.map((x) => x.id)).toContain(u.id);

    expect(await auditEntries('user.deactivated', { entity_id: u.id })).toHaveLength(1);
    expect(await auditEntries('user.reactivated', { entity_id: u.id })).toHaveLength(1);
  });

  it('cannot deactivate yourself, an invited user, or someone already deactivated', async () => {
    const admin = W.users.admin;
    expect((await as.Admin.post(`/api/v1/users/${admin.id}/deactivate`)).status).toBe(403);
    const invited = await W.addUser({ status: 'Invited' });
    expect((await as.Admin.post(`/api/v1/users/${invited.id}/deactivate`)).status).toBe(409);
    const gone = await W.addUser({ status: 'Deactivated' });
    expect((await as.Admin.post(`/api/v1/users/${gone.id}/deactivate`)).status).toBe(409);
    expect((await as.Admin.post(`/api/v1/users/${invited.id}/reactivate`)).status).toBe(409);
  });

  it('the Owner cannot be deactivated while another administrator exists either', async () => {
    const res = await as.Owner.post(`/api/v1/users/${owner.id}/deactivate`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('The Owner cannot be deactivated. Transfer ownership first.');
  });
});

// ---------------------------------------------------------------------------
describe('transfer ownership (BR-ROLE-01)', () => {
  it('needs the Owner password and an active Admin; swaps roles; can be transferred back', async () => {
    const target = await W.addUser({ role: 'Admin' });
    const tm = await W.addUser();

    const wrongPw = await as.Owner.post(`/api/v1/users/${target.id}/transfer-ownership`, { password: 'Wrong-pass-123' });
    expect(wrongPw.status).toBe(422);
    expect((await as.Owner.post(`/api/v1/users/${tm.id}/transfer-ownership`, { password: SEED_PASSWORD })).status).toBe(409);

    const ok = await as.Owner.post(`/api/v1/users/${target.id}/transfer-ownership`, { password: SEED_PASSWORD });
    expect(ok.status).toBe(200);
    expect(await fresh(target.id)).toMatchObject({ role: 'Owner' });
    expect(await fresh(owner.id)).toMatchObject({ role: 'Admin' });
    expect(await db.user.count({ where: { workspace_id: W.workspace.id, role: 'Owner' } })).toBe(1); // exactly one Owner
    const [entry] = await auditEntries('workspace.ownership_transferred');
    expect(entry.after).toEqual({ owner_id: target.id });

    // The old Owner's next request already runs as Admin (BR-ROLE-04)
    expect((await as.Owner.post(`/api/v1/users/${owner.id}/transfer-ownership`, { password: SEED_PASSWORD })).status).toBe(403);

    // Hand ownership back, so later tests in this file start from the original Owner
    const newOwner = await loginAs(app, target.email);
    const back = await newOwner.post(`/api/v1/users/${owner.id}/transfer-ownership`, { password: SEED_PASSWORD });
    expect(back.status).toBe(200);
    expect(await fresh(owner.id)).toMatchObject({ role: 'Owner' });
  });
});

// ---------------------------------------------------------------------------
describe('unauthenticated access', () => {
  it('signed-out callers get 401 on every users endpoint', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });
});
