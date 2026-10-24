// Password hashing (BR-AUTH-02) and policy (BR-AUTH-01).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bcrypt from 'bcrypt';
import { passwordIsNotEmail, passwordSchema } from '@cpm/shared';
import { config } from '../config.js';
import { validationError } from '../lib/errors.js';

// 10,000 most common passwords, lowercased (SecLists, MIT licence).
const COMMON_PASSWORDS = new Set(
  readFileSync(resolve(import.meta.dirname, 'data/common-passwords.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean),
);

// Compared against when an account does not exist, so a missing account takes as
// long to reject as a wrong password (no account enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', config.bcryptCost);

export function hashPassword(password) {
  return bcrypt.hash(password, config.bcryptCost);
}

/** True when the password matches. Always spends one bcrypt comparison. */
export async function verifyPassword(password, hash) {
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, hash);
}

/** BR-AUTH-01. Returns a list of problems (empty when the password is acceptable). */
export function passwordProblems(password, email) {
  const problems = [];
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) problems.push(...parsed.error.issues.map((i) => i.message));
  if (typeof password === 'string') {
    if (!passwordIsNotEmail(password, email)) problems.push('Password must not be your email address');
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      problems.push('This password is too common. Choose a less predictable one');
    }
  }
  return problems;
}

/** Throws a 422 with the problems attached to `field`. */
export function assertPasswordPolicy(password, email, field = 'password') {
  const problems = passwordProblems(password, email);
  if (problems.length) {
    throw validationError(problems.map((message) => ({ field, message })), 'Password does not meet the policy');
  }
}
