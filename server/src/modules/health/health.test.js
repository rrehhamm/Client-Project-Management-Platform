import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Storage and mail are external services; the database is real (test DB).
vi.mock('../../lib/storage.js', () => ({ pingStorage: vi.fn() }));
vi.mock('../../lib/mailer.js', () => ({ pingMail: vi.fn() }));

const { pingStorage } = await import('../../lib/storage.js');
const { pingMail } = await import('../../lib/mailer.js');
const { createApp } = await import('../../app.js');

const app = createApp();

beforeEach(() => {
  pingStorage.mockResolvedValue(true);
  pingMail.mockResolvedValue(true);
});

describe('GET /api/v1/health', () => {
  it('returns 200 without touching dependencies', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('sets a request ID header (NFR-OBS-01)', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses a safe incoming request ID and replaces an unsafe one', async () => {
    const safe = await request(app).get('/api/v1/health').set('X-Request-Id', 'trace-12345678');
    expect(safe.headers['x-request-id']).toBe('trace-12345678');
    const unsafe = await request(app).get('/api/v1/health').set('X-Request-Id', 'bad id <script>');
    expect(unsafe.headers['x-request-id']).not.toBe('bad id <script>');
  });

  it('sends security headers and hides the framework (NFR-SEC-05)', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /api/v1/health/ready', () => {
  it('returns 200 when database, storage and mail are reachable', async () => {
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok', storage: 'ok', mail: 'ok' } });
  });

  it('returns 503 in the standard error shape when a dependency is down', async () => {
    pingStorage.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:9000'));
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      fields: [],
      checks: { database: 'ok', storage: 'error', mail: 'ok' },
    });
    // The underlying error text is not leaked
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });
});

describe('error responses (NFR-API-01)', () => {
  it('returns 404 { code, message, fields } for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: expect.any(String), fields: [] });
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'BAD_REQUEST', message: 'Request body is not valid JSON', fields: [] });
  });

  it('returns 413 for an oversized JSON body', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
