// Request validation middleware. Bodies are parsed with strict schemas: unknown
// fields are rejected with 422 instead of silently passed on (rule 3).
import { z } from 'zod';
import { validationError, zodToFields } from './errors.js';

function strict(schema) {
  return schema instanceof z.ZodObject ? schema.strict() : schema;
}

/** Validate req.body; the parsed value replaces req.body. */
export function validateBody(schema) {
  const s = strict(schema);
  return (req, _res, next) => {
    const result = s.safeParse(req.body ?? {});
    if (!result.success) throw validationError(zodToFields(result.error));
    req.body = result.data;
    next();
  };
}

/** Validate req.query into req.validQuery (Express 5 makes req.query read-only). */
export function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) throw validationError(zodToFields(result.error));
    req.validQuery = result.data;
    next();
  };
}

const uuid = z.uuid();
/** True for a syntactically valid UUID; routes answer 404 for anything else. */
export const isUuid = (value) => uuid.safeParse(value).success;
