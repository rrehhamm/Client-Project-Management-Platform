// Central authorization layer (rule 1). Every route asks can() through authorize();
// no controller makes its own permission decision. Built from BRD 4.2 (permissions.js).
import { CONTACT, RULES } from './permissions.js';

/** Role key used in RULES for a principal. */
export function roleKeyOf(principal) {
  return principal.kind === 'contact' ? CONTACT : principal.role;
}

/**
 * May `principal` perform `action` in `ctx`?
 * Unknown actions throw: a typo must never silently deny or allow.
 */
export function can(principal, action, ctx = {}) {
  const rule = RULES[action];
  if (!rule) throw new Error(`Unknown permission action: ${action}`);
  if (!principal) return false;
  const entry = rule[roleKeyOf(principal)];
  if (!entry) return false;
  if (entry === true) return true;
  return Boolean(entry(principal, ctx));
}
