import { describe, expect, it } from 'vitest';
import { issueCsrfToken, isValidCsrfToken } from './csrf.js';

describe('CSRF tokens (BR-AUTH-03)', () => {
  it('accepts tokens we issued', () => {
    expect(isValidCsrfToken(issueCsrfToken())).toBe(true);
  });

  it('rejects forged, tampered or malformed tokens', () => {
    const [value, sig] = issueCsrfToken().split('.');
    expect(isValidCsrfToken(`${value}x.${sig}`)).toBe(false);
    expect(isValidCsrfToken(`${value}.${sig}x`)).toBe(false);
    expect(isValidCsrfToken(value)).toBe(false);
    expect(isValidCsrfToken(`${value}.${sig}.extra`)).toBe(false);
    expect(isValidCsrfToken(undefined)).toBe(false);
  });
});
