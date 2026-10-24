import { describe, expect, it } from 'vitest';
import { assertPasswordPolicy, hashPassword, passwordProblems, verifyPassword } from './passwords.js';

describe('password policy (BR-AUTH-01)', () => {
  it('accepts a long password with a letter and a number', () => {
    expect(passwordProblems('Correct-horse-42', 'lina@nexa.test')).toEqual([]);
  });

  it('TC-AUTH-010: rejects "abc12" (too short)', () => {
    expect(passwordProblems('abc12')).toContain('Use at least 10 characters');
  });

  it('requires a letter and a number', () => {
    expect(passwordProblems('1234567890123')).toContain('Include at least one letter');
    expect(passwordProblems('abcdefghijkl')).toContain('Include at least one number');
  });

  it('rejects the email itself, ignoring case', () => {
    expect(passwordProblems('Lina1@Nexa.test', 'lina1@nexa.test')).toContain('Password must not be your email address');
  });

  it('rejects passwords on the common-passwords list', () => {
    expect(passwordProblems('1q2w3e4r5t')).toContain('This password is too common. Choose a less predictable one');
    expect(passwordProblems('1Q2W3E4R5T')).toContain('This password is too common. Choose a less predictable one');
  });

  it('throws a 422 listing every problem on the given field', () => {
    try {
      assertPasswordPolicy('abc', 'x@nexa.test', 'new_password');
      expect.unreachable();
    } catch (err) {
      expect(err.status).toBe(422);
      expect(err.fields.every((f) => f.field === 'new_password')).toBe(true);
      expect(err.fields.length).toBeGreaterThan(1);
    }
  });
});

describe('hashing (BR-AUTH-02)', () => {
  it('never stores the password itself and verifies correctly', async () => {
    const hash = await hashPassword('Correct-horse-42');
    expect(hash).not.toContain('Correct-horse-42');
    expect(hash).toMatch(/^\$2b\$/);
    expect(await verifyPassword('Correct-horse-42', hash)).toBe(true);
    expect(await verifyPassword('wrong-password-1', hash)).toBe(false);
  });

  it('returns false (after a dummy comparison) when there is no hash', async () => {
    expect(await verifyPassword('anything-1', null)).toBe(false);
  });
});
