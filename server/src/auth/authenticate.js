// Request authentication. `authenticate` runs on every API request and sets
// req.principal (or null). `requireAuth` turns a missing principal into 401.
import { unauthenticated } from '../lib/errors.js';
import { ACCESS_COOKIE } from './cookies.js';
import { principalFromAccessToken } from './sessions.js';

export async function authenticate(req, _res, next) {
  req.principal = null;
  const token = req.cookies?.[ACCESS_COOKIE];
  if (token) req.principal = await principalFromAccessToken(token);
  next();
}

export function requireAuth(req, _res, next) {
  next(req.principal ? undefined : unauthenticated());
}
