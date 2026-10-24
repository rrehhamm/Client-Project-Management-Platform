import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, conflict, errorHandler, staleUpdate, transitionNotAllowed } from './errors.js';
import { bigIntReplacer } from './json.js';

/** Tiny app whose only route throws the given error. */
function appThrowing(err) {
  const app = express();
  app.get('/boom', () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('passes AppError status, code, message and fields through', async () => {
    const err = conflict('A client with this name already exists', [{ field: 'name', message: 'Duplicate' }]);
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: 'CONFLICT',
      message: 'A client with this name already exists',
      fields: [{ field: 'name', message: 'Duplicate' }],
    });
  });

  it('has helpers for BRD 409 cases', () => {
    expect(staleUpdate()).toMatchObject({ status: 409, code: 'STALE_UPDATE', message: 'This item was changed by someone else' });
    expect(transitionNotAllowed()).toMatchObject({ status: 409, code: 'TRANSITION_NOT_ALLOWED', message: 'Transition not allowed' });
  });

  it('turns a Zod error into 422 with one entry per field', async () => {
    const schema = z.object({ name: z.string().min(2), dates: z.object({ start: z.string() }) });
    const parsed = schema.safeParse({ name: 'x', dates: {} });
    const res = await request(appThrowing(parsed.error)).get('/boom');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.fields.map((f) => f.field).sort()).toEqual(['dates.start', 'name']);
  });

  it('maps Prisma unique violations to 409 and missing records to 404', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), { code: 'P2002' });
    const p2025 = Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
    expect((await request(appThrowing(p2002)).get('/boom')).status).toBe(409);
    expect((await request(appThrowing(p2025)).get('/boom')).status).toBe(404);
  });

  it('hides unexpected errors behind a generic 500 (no stack, SQL or message)', async () => {
    const err = new Error('SELECT password_hash FROM users WHERE id = 1');
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: expect.any(String), fields: [] });
    expect(res.text).not.toContain('password_hash');
    expect(res.text).not.toContain('at ');
  });

  it('treats AppError as the only source of non-500 statuses', async () => {
    const err = Object.assign(new Error('nope'), { status: 418 });
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(500);
    expect(new AppError(403, 'FORBIDDEN', 'x').status).toBe(403);
  });
});

describe('bigIntReplacer', () => {
  it('serialises BigInt money as a number', () => {
    expect(JSON.stringify({ budget_amount: 12_000_000n }, bigIntReplacer)).toBe('{"budget_amount":12000000}');
  });
  it('fails loudly instead of losing precision', () => {
    expect(() => JSON.stringify({ v: 2n ** 60n }, bigIntReplacer)).toThrow(RangeError);
  });
});
