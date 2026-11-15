// D-40, BR-CLI-01: the one place that decides what a Client Contact can reach.
// Lists use portalProjectWhere(); single records go through portalCtx(), which loads
// the record, then checks can() for contacts. Anything out of scope is 404, never 403,
// so its existence is not revealed; the attempt is recorded (E2E-05).
import { recordDenial } from '../../auth/authorize.js';
import { can } from '../../auth/can.js';
import { db } from '../../lib/db.js';
import { forbidden, notFound } from '../../lib/errors.js';

/** Projects a contact may see: own client, portal on (FR-PORT-08), a member, not deleted. */
export const portalProjectWhere = (contact) => ({
  workspace_id: contact.workspace_id,
  client_id: contact.client_id,
  portal_enabled: true,
  deleted_at: null,
  members: { some: { contact_id: contact.id } },
});

/**
 * Load a record with an internal loader and check the contact may read it.
 * @param {Function} load  (req) => ctx with { project, membership, record }
 * @param {string} readAction  e.g. 'task.read'; failing it means 404
 */
export async function portalCtx(req, load, readAction) {
  let ctx;
  try {
    ctx = await load(req);
  } catch (err) {
    if (err.status === 404) await recordDenial(req, readAction, { reason: 'not_found_or_other_client' });
    throw err;
  }
  if (!can(req.principal, readAction, ctx)) {
    await recordDenial(req, readAction, { reason: 'out_of_portal_scope' });
    throw notFound();
  }
  return ctx;
}

/** The contact can see the record; this checks the stronger action (e.g. comment) → 403 (TC-PORT-004). */
export async function requirePortal(req, action, ctx) {
  if (can(req.principal, action, ctx)) return;
  await recordDenial(req, action, { reason: 'portal_level' });
  throw forbidden(action === 'approval.decide' ? 'Only the approvers named on this request can decide' : 'Your portal access for this project is view only');
}

/** The contact's membership row on a project (portal level). */
export const contactMembership = (contact, projectId) => db.projectMember.findFirst({ where: { project_id: projectId, contact_id: contact.id } });
