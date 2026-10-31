// Shared helpers for API tests.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { db } from '../src/lib/db.js';

export const SEED_PASSWORD = process.env.SEED_PASSWORD;

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
  put(url, body) {
    return this.#with(this.agent.put(url)).send(body ?? {});
  }
  delete(url) {
    return this.#with(this.agent.delete(url));
  }
  /** Raw-body file upload, like the browser sends it (FR-FILE-01). */
  upload(url, buffer, { name, type = 'application/octet-stream', method = 'post' } = {}) {
    return this.#with(this.agent[method](url)).set('Content-Type', type).set('X-File-Name', encodeURIComponent(name)).send(buffer);
  }
}

/** Small valid files for upload tests (BR-FILE-01 checks their first bytes). */
export const SAMPLE_FILES = {
  png: () => Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a52b0000000049454e44ae426082', 'hex'),
  pdf: () => Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'),
  txt: (text = 'Meeting notes\nline two\n') => Buffer.from(text),
  // Windows executables start with "MZ"
  exe: () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]),
};

export const client = (app) => new ApiClient(app).init();

/** Signed-in client. Fails the test if login does not succeed. */
export async function loginAs(app, email, password = SEED_PASSWORD, extra = {}) {
  const c = await client(app);
  const res = await c.post('/api/v1/auth/login', { email, password, ...extra });
  expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  c.principal = res.body.principal;
  return c;
}

export const uniqueEmail = (prefix = 'user') => `${prefix}-${randomUUID().slice(0, 8)}@nexa.test`;

/** Unique client name / 3-letter prefix for tests that need their own client. */
export function uniqueClientName(prefix = 'Client') {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

/** Create an Active client through the API as `c` (an admin/PM client). Returns the body. */
export async function apiCreateClient(c, overrides = {}) {
  const res = await c.post('/api/v1/clients', { name: uniqueClientName(), ...overrides });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** Create a project through the API. `pmId` is required (a PM of the caller's workspace). */
export async function apiCreateProject(c, { clientId, pmId, ...overrides } = {}) {
  if (!pmId) throw new Error('apiCreateProject needs pmId');
  const res = await c.post('/api/v1/projects', {
    client_id: clientId,
    name: `Project ${randomUUID().slice(0, 8)}`,
    start_date: '2026-10-01',
    billing_type: 'Fixed',
    pm_user_id: pmId,
    ...overrides,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
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
