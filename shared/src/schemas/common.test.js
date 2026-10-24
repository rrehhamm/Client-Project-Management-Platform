import { describe, expect, it } from 'vitest';
import { emailSchema, paginationSchema } from './common.js';

describe('emailSchema (BR-AUTH-04)', () => {
  it('trims and lowercases', () => {
    expect(emailSchema.parse('  Maya@Nova.test ')).toBe('maya@nova.test');
  });
  it('rejects invalid emails', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('paginationSchema (NFR-PERF-03)', () => {
  it('defaults to page 1, 25 per page', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, page_size: 25 });
  });
  it('caps page size at 100', () => {
    expect(paginationSchema.safeParse({ page_size: '101' }).success).toBe(false);
    expect(paginationSchema.parse({ page_size: '100' }).page_size).toBe(100);
  });
});
