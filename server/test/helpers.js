// Shared helpers for API tests.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { hashPassword } from '../src/auth/passwords.js';
import { db } from '../src/lib/db.js';

export const SEED_PASSWORD = process.env.SEED_PASSWORD;

export const SEED = {
  owner: 'owner@nexa.test',
  admin: 'admin@nexa.test',
  pm: 'lina.pm@nexa.test',
  member: 'omar@nexa.test',
  member2: 'rana@nexa.test',
  finance: 'sami.fin@nexa.test',
  contact: 'maya@novaretail.test',
  contactView: 'ali@novaretail.test',
};

/**
 * A cookie-keeping client that sends the CSRF header on every request.
 * Call `await c.init()` (done by `client()` and `loginAs()`).
 */
export class ApiClient {
  constructor(app) {
    this.agent = request.agent(app);
    this.agent.set('User-Agent', 'cpm-api-tests'); // like a browser would send
    this.csrf = null;
  }

  async init() {
    const res = await this.agent.get('/api/v1/auth/csrf');
    this.csrf = res.body.csrf_token;
    return this;
  }

  #with(req) {
    return this.csrf ? req.set('X-CSRF-Token', this.csrf) : req;
  }

  get(url) {
    return this.agent.get(url);
  }
  post(url, body) {
    return this.#with(this.agent.post(url)).send(body ?? {});
  }
  patch(url, body) {
    return this.#with(this.agent.patch(url)).send(body ?? {});
  }
  delete(url) {
    return this.#with(this.agent.delete(url));
  }
}

export const client = (app) => new ApiClient(app).init();

/** Signed-in client. Fails the test if login does not succeed. */
export async function loginAs(app, email, password = SEED_PASSWORD, extra = {}) {
  const c = await client(app);
  const res = await c.post('/api/v1/auth/login', { email, password, ...extra });
  expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  c.principal = res.body.principal;
  return c;
}

let workspaceId;
export async function workspaceIdForTests() {
  workspaceId ??= (await db.workspace.findFirstOrThrow({ where: { name: 'Nexa' } })).id;
  return workspaceId;
}

export const uniqueEmail = (prefix = 'user') => `${prefix}-${randomUUID().slice(0, 8)}@nexa.test`;

/** Create an internal user directly in the database. */
export async function createUser({ role = 'TeamMember', status = 'Active', password = SEED_PASSWORD, email, fullName } = {}) {
  return db.user.create({
    data: {
      workspace_id: await workspaceIdForTests(),
      email: email ?? uniqueEmail(role.toLowerCase()),
      full_name: fullName ?? `Test ${role}`,
      role,
      status,
      password_hash: status === 'Invited' ? null : await hashPassword(password),
    },
  });
}

/** Create a client contact (on Nova Retail unless clientId is given). */
export async function createContact({ clientId, portalAccess = true, status = 'Active', password = SEED_PASSWORD } = {}) {
  const client =
    clientId ?? (await db.client.findFirstOrThrow({ where: { name_normalized: 'nova retail' } })).id;
  return db.clientContact.create({
    data: {
      workspace_id: await workspaceIdForTests(),
      client_id: client,
      full_name: 'Test Contact',
      email: `contact-${randomUUID().slice(0, 8)}@novaretail.test`,
      portal_access: portalAccess,
      status,
      password_hash: await hashPassword(password),
    },
  });
}

/** Token from the most recent email sent by the mocked sendMail containing `path`. */
export function tokenFromLastMail(sendMail, path) {
  const calls = sendMail.mock.calls.filter(([msg]) => msg.text?.includes(path));
  expect(calls.length, `an email linking to ${path}`).toBeGreaterThan(0);
  const [msg] = calls.at(-1);
  const match = msg.text.match(new RegExp(`${path.replace('/', '\\/')}\\?token=([A-Za-z0-9_-]+)`));
  return { token: match[1], to: msg.to, msg };
}

/** Latest activity log entries for an action (newest first). */
export function auditEntries(action, where = {}) {
  return db.activityLog.findMany({ where: { action, ...where }, orderBy: { created_at: 'desc' }, take: 5 });
}

export const STANDARD_ERROR = { code: expect.any(String), message: expect.any(String), fields: expect.any(Array) };
