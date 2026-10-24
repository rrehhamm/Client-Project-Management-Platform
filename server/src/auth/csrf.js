// CSRF protection (BR-AUTH-03): signed double-submit token.
// The token lives in a readable cookie; every state-changing request must echo
// it in the X-CSRF-Token header. A cross-site page can neither read the cookie
// nor forge the signature.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ERROR_CODES } from '@cpm/shared';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { CSRF_COOKIE, setCsrfCookie } from './cookies.js';

export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const sign = (value) => createHmac('sha256', config.auth.csrfSecret).update(value).digest('base64url');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function issueCsrfToken() {
  const value = randomBytes(24).toString('base64url');
  return `${value}.${sign(value)}`;
}

export function isValidCsrfToken(token) {
  if (typeof token !== 'string') return false;
  const [value, signature, extra] = token.split('.');
  if (!value || !signature || extra !== undefined) return false;
  return safeEqual(signature, sign(value));
}

/** Rejects unsafe methods unless header token === cookie token and is signed by us. */
export function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const header = req.get(CSRF_HEADER);
  const cookie = req.cookies?.[CSRF_COOKIE];
  if (header && cookie && safeEqual(header, cookie) && isValidCsrfToken(header)) return next();
  return next(new AppError(403, ERROR_CODES.CSRF_INVALID, 'Your session token is missing or out of date. Reload the page and try again.'));
}

/** GET /auth/csrf: returns the current token, issuing a new one if needed. */
export function csrfTokenHandler(req, res) {
  const existing = req.cookies?.[CSRF_COOKIE];
  const token = isValidCsrfToken(existing) ? existing : issueCsrfToken();
  setCsrfCookie(res, token);
  res.json({ csrf_token: token });
}
