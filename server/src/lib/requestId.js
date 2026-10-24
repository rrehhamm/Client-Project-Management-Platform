// Gives every request an ID, returned in X-Request-Id and written on every log line.
// A caller-supplied ID is reused only if it is short and safe to log.
import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}
