// API tests for /api/v1/auth: FR-AUTH-01…11, FR-AUTH-13, BR-AUTH-01…06,
// TC-AUTH-001…010.
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEED_PASSWORD,
  STANDARD_ERROR,
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
const NEW_PASSWORD = 'Brand-new-pass-2026';

const cookieNamed = (res, name) => (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));

beforeAll(async () => {
  W = await createWorld('Auth');
});

beforeEach(() => {
  sendMail.mockClear();
});

// ---------------------------------------------------------------------------
describe('POST /auth/login', () => {
  it('TC-AUTH-001: an active Admin signs in, lands on the dashboard, last_login_at updates', async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: W.users.admin.id } });
    const c = await client(app);
    const res = await c.post('/api/v1/auth/login', { email: W.users.admin.email, password: SEED_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ home: '/', principal: { kind: 'user', role: 'Admin', email: W.users.admin.email } });
    const after = await db.user.findUniqueOrThrow({ where: { id: W.users.admin.id } });
    expect(after.last_login_at.getTime()).toBeGreaterThan(before.last_login_at?.getTime() ?? 0);
  });

  it('sets HttpOnly, SameSite=Lax auth cookies and never returns tokens or hashes in the body (BR-AUTH-02/03)', async () => {
    const c = await client(app);
    const res = await c.post('/api/v1/auth/login', { email: W.users.admin.email, password: SEED_PASSWORD });
    for (const name of ['cpm_at', 'cpm_rt']) {
      const cookie = cookieNamed(res, name);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    }
    expect(cookieNamed(res, 'cpm_rt')).toMatch(/Path=\/api\/v1\/auth/);
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|eyJ/);
  });

  it('sends a Client Contact to the portal (FR-AUTH-01)', async () => {
    const c = await loginAs(app, W.contacts.maya.email);
    expect(c.principal).toMatchObject({ kind: 'contact', client_name: 'Nova Retail' });
    const me = await c.get('/api/v1/auth/me');
    expect(me.body.home).toBe('/portal');
  });

  it('TC-AUTH-002: unknown email and wrong password get the same generic 401 and no session', async () => {
    const c = await client(app);
    const unknown = await c.post('/api/v1/auth/login', { email: uniqueEmail('ghost'), password: 'Whatever-123' });
    const wrong = await c.post('/api/v1/auth/login', { email: W.users.finance.email, password: 'Wrong-password-1' });
    for (const res of [unknown, wrong]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect', fields: [] });
      expect(cookieNamed(res, 'cpm_at')).toBeUndefined();
    }
  });

  it('treats emails case-insensitively and trims them (BR-AUTH-04)', async () => {
    const c = await client(app);
    const res = await c.post('/api/v1/auth/login', { email: `  ${W.users.admin.email.toUpperCase()} `, password: SEED_PASSWORD });
    expect(res.status).toBe(200);
  });

  it('validates the fields (FR-AUTH-03, server side)', async () => {
    const c = await client(app);
    const res = await c.post('/api/v1/auth/login', { email: 'not-an-email', password: '' });
    expect(res.status).toBe(422);
    expect(res.body.fields.map((f) => f.field).sort()).toEqual(['email', 'password']);
  });

  it('rejects a login without the CSRF header (BR-AUTH-03)', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: W.users.admin.email, password: SEED_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('rejects an invited user who has not set a password, with the generic message', async () => {
    const invited = await W.addUser({ status: 'Invited' });
    const c = await client(app);
    const res = await c.post('/api/v1/auth/login', { email: invited.email, password: SEED_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('FR-AUTH-06: a deactivated user gets 403 "Your account is deactivated" only with the right password', async () => {
    const u = await W.addUser({ status: 'Deactivated' });
    const c = await client(app);
    const right = await c.post('/api/v1/auth/login', { email: u.email, password: SEED_PASSWORD });
    expect(right.status).toBe(403);
    expect(right.body).toMatchObject({ code: 'ACCOUNT_DEACTIVATED', message: 'Your account is deactivated' });
    const wrong = await c.post('/api/v1/auth/login', { email: u.email, password: 'Wrong-password-1' });
    expect(wrong.status).toBe(401);
  });

  it('BR-AUTH-05: contacts without portal access, or of an archived client, cannot sign in', async () => {
    const noAccess = await W.addContact({ portalAccess: false });
    const archivedClient = await db.client.create({
      data: {
        workspace_id: noAccess.workspace_id,
        name: `Archived Co ${Date.now()}`,
        name_normalized: `archived co ${Date.now()}`,
        code_prefix: `Z${String(Date.now()).slice(-2).replace(/\d/g, (d) => 'ABCDEFGHIJ'[d])}`,
        currency: 'JOD',
        status: 'Archived',
      },
    });
    const archived = await W.addContact({ clientId: archivedClient.id });
    const c = await client(app);
    for (const contact of [noAccess, archived]) {
      const res = await c.post('/api/v1/auth/login', { email: contact.email, password: SEED_PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'PORTAL_ACCESS_DISABLED', message: 'Portal access is disabled' });
    }
  });

  it('TC-AUTH-006: 5 failures in 15 minutes lock the account, even for the correct password, and are audited', async () => {
    const u = await W.addUser();
    const c = await client(app);
    for (let i = 0; i < 5; i++) {
      const res = await c.post('/api/v1/auth/login', { email: u.email, password: `Wrong-password-${i}` });
      expect(res.status).toBe(401);
    }
    const locked = await c.post('/api/v1/auth/login', { email: u.email, password: SEED_PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(14 * 60);
    const [entry] = await auditEntries('auth.account_locked', { entity_id: u.id });
    expect(entry).toMatchObject({ actor_type: 'User', actor_id: u.id });
    expect(entry.ip).toBeTruthy();
  });

  it('locks unknown emails the same way, so nobody can tell whether an account exists', async () => {
    const email = uniqueEmail('ghost');
    const c = await client(app);
    for (let i = 0; i < 5; i++) await c.post('/api/v1/auth/login', { email, password: 'Wrong-password-1' });
    const res = await c.post('/api/v1/auth/login', { email, password: 'Wrong-password-1' });
    expect(res.status).toBe(423);
  });

  it('"Remember me" gives internal users 30 days, never contacts (FR-AUTH-10, D-08)', async () => {
    const internal = await loginAs(app, W.users.finance.email, SEED_PASSWORD, { remember_me: true });
    const contact = await loginAs(app, W.contacts.ali.email, SEED_PASSWORD, { remember_me: true });
    const days = async (principalId, field) => {
      const s = await db.session.findFirstOrThrow({ where: { [field]: principalId }, orderBy: { created_at: 'desc' } });
      return { remember: s.remember_me, days: Math.round((s.expires_at - s.created_at) / 86_400_000) };
    };
    expect(await days(internal.principal.id, 'user_id')).toEqual({ remember: true, days: 30 });
    expect(await days(contact.principal.id, 'contact_id')).toEqual({ remember: false, days: 7 });
  });

  it('writes login success and failure to the audit log with IP and user agent (BR-AUTH-06)', async () => {
    const u = await W.addUser();
    const c = await client(app);
    await c.post('/api/v1/auth/login', { email: u.email, password: 'Wrong-password-1' });
    await c.post('/api/v1/auth/login', { email: u.email, password: SEED_PASSWORD });
    const [failed] = await auditEntries('auth.login_failed', { entity_id: u.id });
    const [ok] = await auditEntries('auth.login', { entity_id: u.id });
    for (const e of [failed, ok]) {
      expect(e.ip).toBeTruthy();
      expect(e.user_agent).toBeTruthy();
      expect(e.request_id).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
describe('protected routes (FR-AUTH-04)', () => {
  it('TC-AUTH-003: API calls without a session get 401 JSON', async () => {
    for (const url of ['/api/v1/auth/me', '/api/v1/users']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ ...STANDARD_ERROR, code: 'UNAUTHENTICATED' });
    }
  });

  it('rejects a forged or tampered access token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', 'cpm_at=eyJhbGciOiJIUzI1NiJ9.e30.forged');
    expect(res.status).toBe(401);
  });

  it('rejects an expired session', async () => {
    const u = await W.addUser();
    const c = await loginAs(app, u.email);
    await db.session.updateMany({ where: { user_id: u.id }, data: { expires_at: new Date(Date.now() - 1000) } });
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('POST /auth/logout and /auth/refresh', () => {
  it('TC-AUTH-004: after logout the old access token gets 401', async () => {
    const c = await client(app);
    const login = await c.post('/api/v1/auth/login', { email: W.users.member2.email, password: SEED_PASSWORD });
    const accessCookie = cookieNamed(login, 'cpm_at').split(';')[0];
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', accessCookie)).status).toBe(200);
    expect((await c.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', accessCookie)).status).toBe(401);
  });

  it('logout clears the cookies and revokes the session server-side', async () => {
    const u = await W.addUser();
    const c = await loginAs(app, u.email);
    const res = await c.post('/api/v1/auth/logout');
    expect(cookieNamed(res, 'cpm_at')).toMatch(/Expires=Thu, 01 Jan 1970/);
    const s = await db.session.findFirstOrThrow({ where: { user_id: u.id } });
    expect(s).toMatchObject({ revoke_reason: 'logout' });
    expect(s.revoked_at).not.toBeNull();
  });

  it('refresh rotates the token; reusing the old refresh token revokes the session', async () => {
    const u = await W.addUser();
    const c = await client(app);
    const login = await c.post('/api/v1/auth/login', { email: u.email, password: SEED_PASSWORD });
    const oldRefresh = cookieNamed(login, 'cpm_rt').split(';')[0];

    const refreshed = await c.post('/api/v1/auth/refresh');
    expect(refreshed.status).toBe(200);
    expect(cookieNamed(refreshed, 'cpm_rt').split(';')[0]).not.toBe(oldRefresh);

    // An attacker replays the old refresh token
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [oldRefresh, `cpm_csrf=${c.csrf}`])
      .set('X-CSRF-Token', c.csrf);
    expect(replay.status).toBe(401);
    const s = await db.session.findFirstOrThrow({ where: { user_id: u.id } });
    expect(s.revoke_reason).toBe('refresh_reuse');
    expect((await c.get('/api/v1/auth/me')).status).toBe(401); // the real user is signed out too
  });

  it('refresh without a refresh token is 401', async () => {
    const c = await client(app);
    expect((await c.post('/api/v1/auth/refresh')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('session checks on every request', () => {
  it('TC-AUTH-005: deactivating a user signed in on two devices revokes both; login then says deactivated', async () => {
    const u = await W.addUser();
    const deviceA = await loginAs(app, u.email);
    const deviceB = await loginAs(app, u.email);
    const admin = await loginAs(app, W.users.admin.email);
    expect((await admin.post(`/api/v1/users/${u.id}/deactivate`)).status).toBe(200);

    expect((await deviceA.get('/api/v1/auth/me')).status).toBe(401);
    expect((await deviceB.get('/api/v1/auth/me')).status).toBe(401);
    const again = await client(app);
    const res = await again.post('/api/v1/auth/login', { email: u.email, password: SEED_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Your account is deactivated');
  });

  it('FR-AUTH-10: a contact idle for 30 minutes must sign in again; an internal user is not timed out', async () => {
    const contact = await W.addContact();
    const c = await loginAs(app, contact.email);
    await db.session.updateMany({ where: { contact_id: contact.id }, data: { last_activity_at: new Date(Date.now() - 31 * 60_000) } });
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
    expect((await c.post('/api/v1/auth/refresh')).status).toBe(401);
    const s = await db.session.findFirstOrThrow({ where: { contact_id: contact.id } });
    expect(s.revoke_reason).toBe('idle_timeout');

    const u = await W.addUser();
    const internal = await loginAs(app, u.email);
    await db.session.updateMany({ where: { user_id: u.id }, data: { last_activity_at: new Date(Date.now() - 31 * 60_000) } });
    expect((await internal.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('revoking portal access signs the contact out on the next request', async () => {
    const contact = await W.addContact();
    const c = await loginAs(app, contact.email);
    await db.clientContact.update({ where: { id: contact.id }, data: { portal_access: false } });
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('forgot and reset password (FR-AUTH-08)', () => {
  it('TC-AUTH-007: an unknown email gets the same message and no email is sent', async () => {
    const c = await client(app);
    const res = await c.post('/api/v1/auth/password/forgot', { email: uniqueEmail('ghost') });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'If the email exists, a link was sent' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('a known email gets a link; resetting signs out every session and the new password works', async () => {
    const u = await W.addUser();
    const existing = await loginAs(app, u.email);
    const c = await client(app);
    const forgot = await c.post('/api/v1/auth/password/forgot', { email: u.email });
    expect(forgot.body).toEqual({ message: 'If the email exists, a link was sent' });
    const { token, to } = tokenFromLastMail(sendMail, '/reset-password');
    expect(to).toBe(u.email);

    const reset = await c.post('/api/v1/auth/password/reset', { token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    expect((await existing.get('/api/v1/auth/me')).status).toBe(401);
    expect((await c.post('/api/v1/auth/login', { email: u.email, password: SEED_PASSWORD })).status).toBe(401);
    expect((await c.post('/api/v1/auth/login', { email: u.email, password: NEW_PASSWORD })).status).toBe(200);
    expect(sendMail.mock.calls.some(([m]) => m.subject.includes('password was changed'))).toBe(true);
  });

  it('TC-AUTH-008: a reset link works once', async () => {
    const u = await W.addUser();
    const c = await client(app);
    await c.post('/api/v1/auth/password/forgot', { email: u.email });
    const { token } = tokenFromLastMail(sendMail, '/reset-password');
    expect((await c.post('/api/v1/auth/password/reset', { token, password: NEW_PASSWORD })).status).toBe(200);
    const again = await c.post('/api/v1/auth/password/reset', { token, password: 'Another-pass-2026' });
    expect(again.status).toBe(410);
    expect(again.body).toMatchObject({ code: 'LINK_EXPIRED', message: 'Link expired or used' });
  });

  it('a reset link expires after 60 minutes', async () => {
    const u = await W.addUser();
    const c = await client(app);
    await c.post('/api/v1/auth/password/forgot', { email: u.email });
    const { token } = tokenFromLastMail(sendMail, '/reset-password');
    await db.authToken.updateMany({ where: { user_id: u.id, purpose: 'PasswordReset' }, data: { expires_at: new Date(Date.now() - 1000) } });
    expect((await c.post('/api/v1/auth/password/reset', { token, password: NEW_PASSWORD })).status).toBe(410);
  });

  it('a weak new password is rejected without using up the link', async () => {
    const u = await W.addUser();
    const c = await client(app);
    await c.post('/api/v1/auth/password/forgot', { email: u.email });
    const { token } = tokenFromLastMail(sendMail, '/reset-password');
    expect((await c.post('/api/v1/auth/password/reset', { token, password: 'abc12' })).status).toBe(422);
    expect((await c.post('/api/v1/auth/password/reset', { token, password: NEW_PASSWORD })).status).toBe(200);
  });

  it('a new request invalidates the previous link', async () => {
    const u = await W.addUser();
    const c = await client(app);
    await c.post('/api/v1/auth/password/forgot', { email: u.email });
    const first = tokenFromLastMail(sendMail, '/reset-password').token;
    await c.post('/api/v1/auth/password/forgot', { email: u.email });
    expect((await c.post('/api/v1/auth/password/reset', { token: first, password: NEW_PASSWORD })).status).toBe(410);
  });
});

// ---------------------------------------------------------------------------
describe('invitations (FR-AUTH-07)', () => {
  async function inviteNewUser() {
    const admin = await loginAs(app, W.users.admin.email);
    const email = uniqueEmail('invitee');
    const res = await admin.post('/api/v1/users', { email, full_name: 'Rana Invitee', role: 'TeamMember' });
    expect(res.status).toBe(201);
    return { email, id: res.body.user.id, token: tokenFromLastMail(sendMail, '/accept-invite').token };
  }

  it('the link opens with the name prefilled; accepting sets the password and signs the user in', async () => {
    const { email, id, token } = await inviteNewUser();
    const c = await client(app);
    const info = await c.get(`/api/v1/auth/invitations/${token}`);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ email, full_name: 'Rana Invitee', workspace_name: W.workspace.name });

    const accept = await c.post('/api/v1/auth/invitations/accept', { token, password: NEW_PASSWORD });
    expect(accept.status).toBe(200);
    expect(accept.body).toMatchObject({ home: '/', principal: { email, role: 'TeamMember' } });
    expect((await c.get('/api/v1/auth/me')).status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'Active' });
  });

  it('the link is single use', async () => {
    const { token } = await inviteNewUser();
    const c = await client(app);
    await c.post('/api/v1/auth/invitations/accept', { token, password: NEW_PASSWORD });
    const again = await c.post('/api/v1/auth/invitations/accept', { token, password: NEW_PASSWORD });
    expect(again.status).toBe(410);
    expect(again.body.message).toBe('Invitation expired, ask your admin to resend');
  });

  it('TC-AUTH-009: an 8-day-old invitation is expired and activates nothing', async () => {
    const { id, token } = await inviteNewUser();
    await db.authToken.updateMany({
      where: { user_id: id, purpose: 'Invite' },
      data: { expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    const c = await client(app);
    const info = await c.get(`/api/v1/auth/invitations/${token}`);
    expect(info.status).toBe(410);
    expect(info.body.message).toBe('Invitation expired, ask your admin to resend');
    expect((await c.post('/api/v1/auth/invitations/accept', { token, password: NEW_PASSWORD })).status).toBe(410);
    expect(await db.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'Invited', password_hash: null });
  });

  it('TC-AUTH-010: password "abc12" is rejected by the policy and nothing is saved', async () => {
    const { id, token } = await inviteNewUser();
    const c = await client(app);
    const res = await c.post('/api/v1/auth/invitations/accept', { token, password: 'abc12' });
    expect(res.status).toBe(422);
    expect(res.body.fields.some((f) => f.field === 'password')).toBe(true);
    expect(await db.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'Invited', password_hash: null });
  });

  it('rejects a password on the common-passwords list (BR-AUTH-01, server-only rule)', async () => {
    const { token } = await inviteNewUser();
    const c = await client(app);
    const res = await c.post('/api/v1/auth/invitations/accept', { token, password: '1q2w3e4r5t' });
    expect(res.status).toBe(422);
    expect(res.body.fields).toContainEqual({ field: 'password', message: 'This password is too common. Choose a less predictable one' });
  });

  it('a malformed token gets the same expired message', async () => {
    const c = await client(app);
    expect((await c.get('/api/v1/auth/invitations/not-a-token')).status).toBe(410);
  });
});

// ---------------------------------------------------------------------------
describe('change password (FR-AUTH-09)', () => {
  it('needs the current password, applies the policy, signs out other sessions and sends a confirmation', async () => {
    const u = await W.addUser();
    const here = await loginAs(app, u.email);
    const elsewhere = await loginAs(app, u.email);

    const wrong = await here.post('/api/v1/auth/password/change', { current_password: 'Nope-1234567', new_password: NEW_PASSWORD });
    expect(wrong.status).toBe(422);
    expect(wrong.body.fields[0]).toEqual({ field: 'current_password', message: 'Current password is incorrect' });

    const weak = await here.post('/api/v1/auth/password/change', { current_password: SEED_PASSWORD, new_password: 'short1' });
    expect(weak.status).toBe(422);

    const ok = await here.post('/api/v1/auth/password/change', { current_password: SEED_PASSWORD, new_password: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect((await here.get('/api/v1/auth/me')).status).toBe(200);
    expect((await elsewhere.get('/api/v1/auth/me')).status).toBe(401);
    expect(sendMail.mock.calls.some(([m]) => m.to === u.email && m.subject.includes('password was changed'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('own profile (FR-AUTH-13)', () => {
  it('GET /auth/me returns the profile, workspace and UI capabilities for the role', async () => {
    const owner = await loginAs(app, W.users.owner.email);
    const member = await loginAs(app, W.users.member.email);
    const o = (await owner.get('/api/v1/auth/me')).body;
    const m = (await member.get('/api/v1/auth/me')).body;
    expect(o.workspace).toMatchObject({ name: W.workspace.name, currency: 'JOD', timezone: 'Asia/Amman' });
    expect(o.capabilities).toMatchObject({ manage_team: true, invite_any_role: true, transfer_ownership: true });
    expect(m.capabilities).toMatchObject({ manage_team: false, invite_users: false, view_rates: false });
    expect(JSON.stringify(o)).not.toContain('password_hash');
  });

  it('updates name, phone and timezone with optimistic locking', async () => {
    const u = await W.addUser();
    const c = await loginAs(app, u.email);
    const me = (await c.get('/api/v1/auth/me')).body.principal;
    const res = await c.patch('/api/v1/auth/me', { full_name: 'New Name', phone: '+962 7 9999 0000', timezone: 'Asia/Amman', version: me.version });
    expect(res.status).toBe(200);
    expect(res.body.principal).toMatchObject({ full_name: 'New Name', timezone: 'Asia/Amman', version: me.version + 1 });

    const stale = await c.patch('/api/v1/auth/me', { full_name: 'Stale', version: me.version });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'STALE_UPDATE', message: 'This item was changed by someone else' });
  });

  it('cannot change role, email or status through the profile (NFR-SEC-03)', async () => {
    const u = await W.addUser();
    const c = await loginAs(app, u.email);
    const me = (await c.get('/api/v1/auth/me')).body.principal;
    const res = await c.patch('/api/v1/auth/me', { full_name: 'X', role: 'Owner', email: 'x@nexa.test', version: me.version });
    expect(res.status).toBe(422);
    expect(await db.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ role: 'TeamMember', email: u.email, full_name: u.full_name });
  });

  it('rejects an unknown timezone', async () => {
    const u = await W.addUser();
    const c = await loginAs(app, u.email);
    const me = (await c.get('/api/v1/auth/me')).body.principal;
    expect((await c.patch('/api/v1/auth/me', { full_name: 'X', timezone: 'Mars/Base', version: me.version })).status).toBe(422);
  });

  it('changes the sign-in email only after the new address is verified', async () => {
    const u = await W.addUser();
    const c = await loginAs(app, u.email);
    const newEmail = uniqueEmail('moved');

    expect((await c.post('/api/v1/auth/me/email-change', { new_email: newEmail, current_password: 'Wrong-pass-123' })).status).toBe(422);
    const taken = await c.post('/api/v1/auth/me/email-change', { new_email: W.contacts.maya.email, current_password: SEED_PASSWORD });
    expect(taken.status).toBe(409);

    const req = await c.post('/api/v1/auth/me/email-change', { new_email: newEmail, current_password: SEED_PASSWORD });
    expect(req.status).toBe(202);
    expect(await db.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ email: u.email }); // not yet
    const { token, to } = tokenFromLastMail(sendMail, '/verify-email');
    expect(to).toBe(newEmail);
    expect(sendMail.mock.calls.some(([m]) => m.to === u.email && m.subject.includes('Email change requested'))).toBe(true);

    const verify = await c.post('/api/v1/auth/email/verify', { token });
    expect(verify.status).toBe(200);
    expect(verify.body).toEqual({ email: newEmail });
    expect((await (await client(app)).post('/api/v1/auth/login', { email: newEmail, password: SEED_PASSWORD })).status).toBe(200);
    expect((await c.post('/api/v1/auth/email/verify', { token })).status).toBe(410);
  });
});

// ---------------------------------------------------------------------------
describe('rate limits (NFR-SEC-06)', () => {
  it('limits sign-in attempts per IP and answers 429 with Retry-After', async () => {
    const limited = createApp({ authRateLimitPerMinute: 3 });
    const c = await client(limited);
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await c.post('/api/v1/auth/login', { email: uniqueEmail('rl'), password: 'Wrong-pass-123' })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    const last = await c.post('/api/v1/auth/login', { email: uniqueEmail('rl'), password: 'Wrong-pass-123' });
    expect(last.body).toMatchObject({ code: 'RATE_LIMITED', fields: [] });
    expect(last.headers['retry-after']).toBeDefined();
  });

  it('limits API requests per signed-in user', async () => {
    const limited = createApp({ apiRateLimitPerMinute: 2 });
    const c = await loginAs(limited, W.users.finance.email);
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await c.get('/api/v1/auth/me')).status);
    expect(statuses).toEqual([200, 200, 429]);
  });
});
