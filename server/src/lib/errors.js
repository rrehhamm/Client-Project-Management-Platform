// One error shape for every response: { code, message, fields[] } (NFR-API-01, rule 6).
// Stack traces, SQL, tokens and hashes never reach the client.
import { ERROR_CODES } from '@cpm/shared';
import { ZodError } from 'zod';

/** An expected error with a status code. Throw these from services and middleware. */
export class AppError extends Error {
  constructor(status, code, message, fields = []) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message = 'The request is malformed') =>
  new AppError(400, ERROR_CODES.BAD_REQUEST, message);
export const unauthenticated = (message = 'Please sign in') =>
  new AppError(401, ERROR_CODES.UNAUTHENTICATED, message);
export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError(403, ERROR_CODES.FORBIDDEN, message);
export const notFound = (message = 'Not found') => new AppError(404, ERROR_CODES.NOT_FOUND, message);
export const conflict = (message, fields = []) => new AppError(409, ERROR_CODES.CONFLICT, message, fields);
export const transitionNotAllowed = (message = 'Transition not allowed') =>
  new AppError(409, ERROR_CODES.TRANSITION_NOT_ALLOWED, message);
export const staleUpdate = (message = 'This item was changed by someone else') =>
  new AppError(409, ERROR_CODES.STALE_UPDATE, message);
export const validationError = (fields, message = 'Some fields are invalid') =>
  new AppError(422, ERROR_CODES.VALIDATION_ERROR, message, fields);

/** Zod issues → fields[] entries: { field: "a.b", message }. */
export function zodToFields(error) {
  return error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : null,
    message: issue.message,
  }));
}

/** Map errors we know how to describe; anything else becomes a generic 500. */
export function toAppError(err) {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return validationError(zodToFields(err));

  // express.json(): malformed JSON or body too large
  if (err?.type === 'entity.parse.failed') return badRequest('Request body is not valid JSON');
  if (err?.type === 'entity.too.large') {
    return new AppError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request body is too large');
  }

  // Prisma known request errors
  if (err?.code === 'P2002') return conflict('A record with these values already exists');
  if (err?.code === 'P2025') return notFound();
  // Postgres unique_violation raised by our triggers (e.g. login_email_unique)
  if (err?.code === '23505' || err?.meta?.code === '23505') {
    return conflict('A record with these values already exists');
  }
  return null;
}

/** Express error middleware. Must be registered last. */
export function errorHandler(err, req, res, _next) {
  const known = toAppError(err);
  if (known) {
    if (known.status >= 500) req.log?.error({ err }, known.message);
    return res.status(known.status).json({ code: known.code, message: known.message, fields: known.fields });
  }
  req.log?.error({ err }, 'Unhandled error');
  return res.status(500).json({
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'Something went wrong. Please try again.',
    fields: [],
  });
}

/** 404 for any route that does not exist. */
export function notFoundHandler(_req, _res, next) {
  next(notFound('This endpoint does not exist'));
}
