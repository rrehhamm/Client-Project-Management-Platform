// Route middleware around can(). Usage:
//   router.patch('/users/:id', authorize('user.read', { load: loadTargetUser }),
//                authorizeFields(USER_FIELD_ACTIONS), controller.update)
import { writeAudit } from '../lib/audit.js';
import { forbidden, notFound, unauthenticated, validationError } from '../lib/errors.js';
import { can } from './can.js';

export async function recordDenial(req, action, extra = {}) {
  // E2E-05: denied attempts are recorded. A logging failure must not change the response.
  try {
    await writeAudit({
      req,
      action: 'access.denied',
      entityType: 'Permission',
      after: { permission: action, method: req.method, path: req.originalUrl, ...extra },
    });
  } catch (err) {
    req.log?.warn({ err }, 'Could not record access denial');
  }
}

// D-34 (b): signed-out calls to private APIs are recorded too, at most
// SIGNED_OUT_PER_MINUTE per IP, so a scanner cannot flood the log.
export const SIGNED_OUT_PER_MINUTE = 10;
const signedOutSeen = new Map(); // ip → { minute, count }

async function recordSignedOut(req, action) {
  const minute = Math.floor(Date.now() / 60_000);
  const key = req.ip ?? 'unknown';
  const seen = signedOutSeen.get(key);
  const count = seen?.minute === minute ? seen.count + 1 : 1;
  signedOutSeen.set(key, { minute, count });
  if (signedOutSeen.size > 10_000) signedOutSeen.clear(); // bounded memory
  if (count > SIGNED_OUT_PER_MINUTE) return;
  await recordDenial(req, action, { reason: 'signed_out' });
}

/**
 * Allow the request only if can(principal, action, ctx).
 * @param {string} action
 * @param {object} [options]
 * @param {(req) => Promise<object>} [options.load]  builds ctx (and throws 404 if the record is missing)
 * @param {string} [options.readAction]  for contacts: if they cannot even read the record, answer 404
 *   instead of 403 so its existence is not revealed (BR-CLI-01)
 */
export function authorize(action, { load, readAction } = {}) {
  return async (req, _res, next) => {
    if (!req.principal) {
      await recordSignedOut(req, action);
      throw unauthenticated();
    }
    const ctx = load ? await load(req) : {};
    req.ctx = ctx;
    if (can(req.principal, action, ctx)) return next();
    await recordDenial(req, action);
    if (req.principal.kind === 'contact' && !(readAction && can(req.principal, readAction, ctx))) {
      throw notFound();
    }
    throw forbidden();
  };
}

/**
 * Field-level write control (rule 3, NFR-SEC-03). `fieldActions` maps every field
 * the endpoint understands to the permission needed to set it (null = always
 * allowed, e.g. `version`). Unknown fields → 422; known fields the caller may not
 * set → 403. Either way nothing is written.
 */
export function authorizeFields(fieldActions) {
  return async (req, _res, next) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const keys = Object.keys(body);
    // Forbidden known fields first (403), so a request mixing them with unknown
    // fields is still reported as a permission problem (TC-ROLE-005).
    const denied = keys.filter((k) => Object.hasOwn(fieldActions, k) && fieldActions[k] && !can(req.principal, fieldActions[k], req.ctx ?? {}));
    if (denied.length) {
      await recordDenial(req, 'fields', { fields: denied });
      const err = forbidden('You are not allowed to change some of these fields');
      err.fields = denied.map((field) => ({ field, message: 'Not allowed for your role' }));
      throw err;
    }
    const unknown = keys.filter((k) => !Object.hasOwn(fieldActions, k));
    if (unknown.length) {
      throw validationError(unknown.map((field) => ({ field, message: 'Unknown field' })), 'Request contains unknown fields');
    }
    next();
  };
}

/**
 * D-40: Client Contacts may use only the sign-in routes and the portal API. Any other
 * endpoint answers 404 to them (as if it did not exist) and the attempt is recorded.
 */
const CONTACT_ALLOWED = [/^\/auth(\/|$)/, /^\/portal(\/|$)/, /^\/health(\/|$)/];
export async function portalOnlyForContacts(req, _res, next) {
  if (req.principal?.kind !== 'contact' || CONTACT_ALLOWED.some((re) => re.test(req.path))) return next();
  await recordDenial(req, 'portal.only', { reason: 'internal_endpoint' });
  throw notFound();
}
