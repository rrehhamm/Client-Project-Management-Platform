// Portal access for client contacts (FR-CON-03/05) and their personal data (NFR-PRIV-02).
import { CLIENT_STATUS } from '@cpm/shared';
import { createLinkToken } from '../../auth/linkTokens.js';
import { revokeAllSessions } from '../../auth/sessions.js';
import { writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { sendPortalInviteEmail } from '../../lib/emails.js';
import { conflict, fieldError } from '../../lib/errors.js';
import { toContactDto } from './contacts.js';

const reload = (id) => db.clientContact.findUniqueOrThrow({ where: { id } });

function assertUsable(contact) {
  if (contact.anonymised_at) throw conflict('This contact was anonymised and cannot be used again');
  if (contact.client.status === CLIENT_STATUS.ARCHIVED || contact.client.archived_at) throw conflict("Restore the client first: contacts of an archived client can't sign in"); // BR-CLI-04
}

/** FR-CON-03: send (or resend) a portal invitation. Turns portal access on. */
export async function invite(viewer, contact, req) {
  assertUsable(contact);
  if (contact.status === 'Active' && contact.portal_access) throw conflict('This contact already uses the portal');
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: contact.workspace_id }, select: { name: true, brand_color: true } });
  const inviter = await db.user.findUniqueOrThrow({ where: { id: viewer.id }, select: { email: true, full_name: true } });
  const token = await db.$transaction(async (tx) => {
    await tx.clientContact.update({
      where: { id: contact.id },
      // An Active contact whose access was revoked keeps its password; others set one
      data: { portal_access: true, status: contact.status === 'Active' ? 'Active' : 'Invited', version: { increment: 1 }, updated_by: viewer.id },
    });
    const raw = await createLinkToken({ purpose: 'Invite', contactId: contact.id, workspaceId: contact.workspace_id, createdBy: viewer.id }, tx);
    await writeAudit({ req, action: 'contact.portal_invited', entityType: 'ClientContact', entityId: contact.id, clientId: contact.client_id, before: { portal_access: contact.portal_access, status: contact.status }, after: { portal_access: true } }, tx);
    return raw;
  });
  let emailSent = true;
  try {
    await sendPortalInviteEmail({ to: contact.email, fullName: contact.full_name, workspaceName: ws.name, clientName: contact.client.name, inviterName: inviter.full_name, replyTo: inviter.email, token, brandColor: ws.brand_color });
  } catch (err) {
    emailSent = false;
    req.log?.warn({ err }, 'Portal invitation email failed');
  }
  return { contact: toContactDto(await reload(contact.id)), email_sent: emailSent };
}

/** FR-CON-05: portal access off; every session ends at once; the record is kept. */
export async function revoke(viewer, contact, req) {
  if (!contact.portal_access) return { contact: toContactDto(contact) };
  await db.$transaction(async (tx) => {
    await tx.clientContact.update({ where: { id: contact.id }, data: { portal_access: false, version: { increment: 1 }, updated_by: viewer.id } });
    await revokeAllSessions({ contactId: contact.id }, 'portal_access_revoked', { client: tx });
    await tx.authToken.updateMany({ where: { contact_id: contact.id, used_at: null, revoked_at: null }, data: { revoked_at: new Date() } });
    await writeAudit({ req, action: 'contact.portal_revoked', entityType: 'ClientContact', entityId: contact.id, clientId: contact.client_id, before: { portal_access: true }, after: { portal_access: false } }, tx);
  });
  return { contact: toContactDto(await reload(contact.id)) };
}

/** Give access back to a contact who had activated before (no new password needed). */
export async function restore(viewer, contact, req) {
  assertUsable(contact);
  if (contact.portal_access) return { contact: toContactDto(contact) };
  if (contact.status !== 'Active') throw conflict('This contact never activated: send an invitation instead');
  await db.clientContact.update({ where: { id: contact.id }, data: { portal_access: true, version: { increment: 1 }, updated_by: viewer.id } });
  await writeAudit({ req, action: 'contact.portal_restored', entityType: 'ClientContact', entityId: contact.id, clientId: contact.client_id, before: { portal_access: false }, after: { portal_access: true } });
  return { contact: toContactDto(await reload(contact.id)) };
}

// ---------------------------------------------------------------------------
// NFR-PRIV-02: export and anonymise
// ---------------------------------------------------------------------------

/** Everything the platform holds about one contact, as JSON. */
export async function exportData(viewer, contact, req) {
  const [memberships, comments, uploads, decisions, pins, requests, notifications, sessions] = await Promise.all([
    db.projectMember.findMany({ where: { contact_id: contact.id }, include: { project: { select: { code: true, name: true } } } }),
    db.comment.findMany({ where: { author_contact_id: contact.id }, select: { id: true, entity_type: true, entity_id: true, body: true, visibility: true, created_at: true, edited_at: true, deleted_at: true } }),
    db.fileVersion.findMany({ where: { uploaded_by_contact_id: contact.id }, select: { original_name: true, mime_type: true, size_bytes: true, created_at: true, file: { select: { name: true } } } }),
    db.approvalApprover.findMany({ where: { contact_id: contact.id }, select: { decision: true, decision_note: true, decided_at: true, decision_ip: true, approval_request_id: true } }),
    db.approvalPin.findMany({ where: { author_contact_id: contact.id }, select: { approval_request_id: true, page: true, body: true, created_at: true } }),
    db.task.findMany({ where: { requested_by_contact_id: contact.id }, select: { id: true, title: true, created_at: true } }),
    db.notification.findMany({ where: { contact_id: contact.id }, select: { type: true, channel: true, created_at: true, read_at: true } }),
    db.session.findMany({ where: { contact_id: contact.id }, select: { created_at: true, last_activity_at: true, ip: true, user_agent: true, revoked_at: true } }),
  ]);
  await writeAudit({ req, action: 'contact.data_exported', entityType: 'ClientContact', entityId: contact.id, clientId: contact.client_id });
  const json = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)));
  return json({
    exported_at: new Date().toISOString(),
    contact: { ...toContactDto(contact), client: { id: contact.client.id, name: contact.client.name }, timezone: contact.timezone, anonymised_at: contact.anonymised_at },
    project_memberships: memberships.map((m) => ({ project: m.project, portal_level: m.portal_level })),
    comments,
    uploads,
    approval_decisions: decisions,
    approval_pins: pins,
    client_requests: requests,
    notifications,
    sessions,
  });
}

/**
 * Replace the contact's personal data for good. Comments, decisions and financial
 * records stay (history and BR-ACT-01) and show the anonymised name instead.
 * The append-only activity log is not rewritten (BR-ACT-01, retained ≥ 2 years).
 */
export async function anonymise(viewer, contact, { confirm_name: confirm }, req) {
  if (contact.anonymised_at) throw conflict('This contact is already anonymised');
  if (confirm !== contact.full_name) throw fieldError('confirm_name', "Type the contact's full name to confirm");
  const tag = contact.id.slice(-6);
  await db.$transaction(async (tx) => {
    await revokeAllSessions({ contactId: contact.id }, 'contact_anonymised', { client: tx });
    await tx.authToken.deleteMany({ where: { contact_id: contact.id } });
    await tx.notification.deleteMany({ where: { contact_id: contact.id } });
    await tx.follower.deleteMany({ where: { contact_id: contact.id } });
    await tx.session.updateMany({ where: { contact_id: contact.id }, data: { ip: null, user_agent: null } });
    await tx.approvalApprover.updateMany({ where: { contact_id: contact.id }, data: { decision_ip: null } });
    await tx.clientContact.update({
      where: { id: contact.id },
      data: {
        full_name: `Former contact ${tag}`,
        email: `anonymised-${contact.id}@anonymised.invalid`,
        phone: null,
        job_title: null,
        timezone: null,
        password_hash: null,
        portal_access: false,
        status: 'NotInvited',
        is_primary: false,
        commercial_authority: false,
        notification_prefs: null,
        anonymised_at: new Date(),
        version: { increment: 1 },
        updated_by: viewer.id,
      },
    });
    await writeAudit({ req, action: 'contact.anonymised', entityType: 'ClientContact', entityId: contact.id, clientId: contact.client_id, after: { tag } }, tx);
  });
  return { contact: toContactDto(await reload(contact.id)) };
}
