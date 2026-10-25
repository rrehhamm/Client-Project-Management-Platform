// API tests for workspace settings: FR-WS-01, D-17, D-21, D-22 (logo). Uses the
// real S3-compatible storage from docker compose.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED, client, loginAs } from '../../../test/helpers.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');

const app = createApp();
const as = {};

// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#2563eb"/></svg>');

const PUBLIC_FIELDS = ['brand_color', 'currency', 'date_format', 'id', 'logo_url', 'name', 'timezone', 'week_start_day'];

beforeAll(async () => {
  for (const [role, email] of Object.entries({ Owner: SEED.owner, Admin: SEED.admin, PM: SEED.pm, TeamMember: SEED.member, Finance: SEED.finance, Contact: SEED.contact })) {
    as[role] = await loginAs(app, email);
  }
  as.Anonymous = await client(app);
});

const upload = (c, body, type) => c.agent.put('/api/v1/workspace/logo').set('X-CSRF-Token', c.csrf).set('Content-Type', type).send(body);
const current = () => db.workspace.findFirstOrThrow({ where: { name: { not: '' } }, orderBy: { created_at: 'asc' } });

describe('GET /workspace (D-17)', () => {
  it('every signed-in principal reads the public fields; only Owner/Admin get admin fields', async () => {
    for (const role of ['PM', 'TeamMember', 'Finance', 'Contact']) {
      const res = await as[role].get('/api/v1/workspace');
      expect(res.status, role).toBe(200);
      expect(Object.keys(res.body).sort(), role).toEqual(PUBLIC_FIELDS);
    }
    const admin = await as.Admin.get('/api/v1/workspace');
    expect(admin.body).toMatchObject({ name: 'Nexa', currency: 'JOD', invoice_prefix: 'INV-', currency_locked: expect.any(Boolean), version: expect.any(Number) });
    expect((await as.Anonymous.get('/api/v1/workspace')).status).toBe(401);
  });
});

describe('PATCH /workspace (FR-WS-01, D-21)', () => {
  it('only Owner/Admin may change settings', async () => {
    const ws = await current();
    for (const role of ['PM', 'TeamMember', 'Finance']) {
      expect((await as[role].patch('/api/v1/workspace', { name: 'Hacked', version: ws.version })).status, role).toBe(403);
    }
    expect((await as.Contact.patch('/api/v1/workspace', { name: 'Hacked', version: ws.version })).status).toBe(404);
    expect((await current()).name).toBe('Nexa');
  });

  it('Admin changes brand colour, date format and week start; invalid values are 422; stale is 409', async () => {
    const ws = await current();
    const res = await as.Admin.patch('/api/v1/workspace', { brand_color: '#0F766E', date_format: 'YYYY-MM-DD', week_start_day: 1, version: ws.version });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ brand_color: '#0F766E', date_format: 'YYYY-MM-DD', week_start_day: 1 });
    expect((await as.Admin.patch('/api/v1/workspace', { brand_color: 'blue', version: res.body.version })).status).toBe(422);
    expect((await as.Admin.patch('/api/v1/workspace', { timezone: 'Mars/Base', version: res.body.version })).status).toBe(422);
    expect((await as.Admin.patch('/api/v1/workspace', { name: 'Stale', version: ws.version })).status).toBe(409);
    // put the seed values back
    await as.Admin.patch('/api/v1/workspace', { brand_color: '#2563EB', date_format: 'DD/MM/YYYY', week_start_day: 0, version: res.body.version });
  });

  it('D-21: the currency is locked once a user rate exists', async () => {
    const sami = await db.user.findUniqueOrThrow({ where: { email: SEED.finance } });
    await db.user.update({ where: { id: sami.id }, data: { hourly_cost_rate: 10_000n } });
    try {
      const ws = await current();
      const res = await as.Owner.patch('/api/v1/workspace', { currency: 'USD', version: ws.version });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/currency cannot change/);
      expect((await as.Admin.get('/api/v1/workspace')).body.currency_locked).toBe(true);
      // Sending the same currency is not a change
      expect((await as.Owner.patch('/api/v1/workspace', { currency: 'JOD', version: ws.version })).status).toBe(200);
    } finally {
      await db.user.update({ where: { id: sami.id }, data: { hourly_cost_rate: null } });
    }
  });
});

describe('logo (FR-WS-01, D-22)', () => {
  it('accepts a PNG and an SVG, returns a signed URL, and the image is served', async () => {
    const png = await upload(as.Admin, PNG, 'image/png');
    expect(png.status).toBe(200);
    expect(png.body.logo_url).toMatch(/X-Amz-Signature=/);
    expect(png.body.logo_url).toMatch(/X-Amz-Expires=600/); // FR-FILE-04: 10 minutes
    const fetched = await fetch(png.body.logo_url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PNG)).toBe(true);

    const svg = await upload(as.Admin, SVG, 'image/svg+xml');
    expect(svg.status).toBe(200);
    expect((await as.Contact.get('/api/v1/workspace')).body.logo_url).toMatch(/\.svg/);
  });

  it('refuses SVGs with scripts, event handlers or external references (415)', async () => {
    for (const bad of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/x.png"/></svg>',
    ]) {
      const res = await upload(as.Admin, Buffer.from(bad), 'image/svg+xml');
      expect(res.status, bad).toBe(415);
    }
  });

  it('checks content, not the declared type (BR-FILE-01 style)', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);
    expect((await upload(as.Admin, exe, 'image/png')).status).toBe(415);
    expect((await upload(as.Admin, SVG, 'image/png')).status).toBe(415);
    expect((await upload(as.Admin, Buffer.from('hello'), 'text/plain')).status).toBe(415);
  });

  it('refuses files over 2 MB (413) and non-admin uploads (403)', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    expect((await upload(as.Admin, big, 'image/png')).status).toBe(413);
    expect((await upload(as.PM, PNG, 'image/png')).status).toBe(403);
  });

  it('removes the logo', async () => {
    const res = await as.Admin.delete('/api/v1/workspace/logo');
    expect(res.status).toBe(200);
    expect(res.body.logo_url).toBeNull();
  });
});
