// List scoping: which rows a principal may see in list endpoints. Lives next to
// can() so all access decisions stay in the authorization layer (rule 1).
// Single-record access is still checked with can() on the loaded record.
import { ROLES } from '@cpm/shared';
import { can } from './can.js';

const SEES_ALL_PROJECTS = [ROLES.OWNER, ROLES.ADMIN, ROLES.FINANCE];

/** Prisma `where` for projects the principal may list (FR-PRJ-09, §4.2 Projects row). */
export function projectScope(principal) {
  if (principal.kind === 'contact') {
    // BR-CLI-01: own client, portal-enabled, and a member
    return { client_id: principal.client_id, portal_enabled: true, members: { some: { contact_id: principal.id } } };
  }
  if (SEES_ALL_PROJECTS.includes(principal.role)) return {};
  return { members: { some: { user_id: principal.id } } }; // PM, Team Member: member projects
}

/** Prisma `where` for clients the principal may list (§4.2 Clients row). */
export function clientScope(principal) {
  if (principal.kind === 'contact') return { id: principal.client_id };
  if (principal.role === ROLES.TEAM_MEMBER) {
    // Name only, for clients of projects they work on
    return { projects: { some: { deleted_at: null, members: { some: { user_id: principal.id } } } } };
  }
  return {};
}

/** Entity types whose activity counts as finance events (§4.2 Activity row). */
export const FINANCE_ENTITY_TYPES = Object.freeze(['Invoice', 'InvoiceLine', 'Payment', 'Proposal', 'Contract', 'Expense']);

/**
 * Prisma `where` (added to project_id / client_id filters) for the activity a
 * principal may read, or null when they may read none of it.
 * @param {object} membership  the principal's membership on the project (project feed)
 * @param {string[]} [memberProjectIds]  projects they belong to (client feed)
 */
export function activityScope(principal, { membership = null, memberProjectIds = null } = {}) {
  const allows = (isFinance, m = membership) => can(principal, 'activity.read', { membership: m, record: { is_finance_event: isFinance } });
  const finance = { entity_type: { in: FINANCE_ENTITY_TYPES } };
  const nonFinance = { entity_type: { notIn: FINANCE_ENTITY_TYPES } };

  if (memberProjectIds) {
    // Client feed: Owner/Admin see everything; Finance finance events; others
    // client-level events plus events of projects they belong to.
    if (can(principal, 'audit.readAll')) return {};
    if (allows(true, null)) return finance; // Finance
    if (principal.kind === 'contact') return null;
    const fakeMember = { user_id: principal.id };
    const types = [allows(false, fakeMember) && nonFinance, allows(true, fakeMember) && finance].filter(Boolean);
    if (!types.length) return null;
    return {
      AND: [{ OR: [{ project_id: null }, { project_id: { in: memberProjectIds } }] }, types.length === 2 ? {} : types[0]],
    };
  }

  const canFinance = allows(true);
  const canOther = allows(false);
  if (canFinance && canOther) return {};
  if (canFinance) return finance;
  if (canOther) return nonFinance;
  return null;
}
