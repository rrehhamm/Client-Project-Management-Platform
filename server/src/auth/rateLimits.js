// NFR-SEC-06 / FR-AUTH-11: request rate limits. Counts are kept in memory, which
// is correct for one server process; several processes would need a shared store.
import { ERROR_CODES } from '@cpm/shared';
import { rateLimit } from 'express-rate-limit';

function handler(_req, res, _next, options) {
  res.status(options.statusCode).json({
    code: ERROR_CODES.RATE_LIMITED,
    message: 'Too many requests. Please wait a moment and try again.',
    fields: [],
  });
}

/** Per IP, for sign-in style endpoints (default 20/min). */
export function authRateLimiter(limitPerMinute) {
  return rateLimit({ windowMs: 60_000, limit: limitPerMinute, standardHeaders: 'draft-8', legacyHeaders: false, handler });
}

/** Per signed-in principal (default 100/min). Unauthenticated requests are not counted here. */
export function apiRateLimiter(limitPerMinute) {
  return rateLimit({
    windowMs: 60_000,
    limit: limitPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => !req.principal,
    keyGenerator: (req) => `${req.principal.kind}:${req.principal.id}`,
    handler,
  });
}
