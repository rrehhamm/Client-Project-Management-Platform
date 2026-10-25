// Client contacts: FR-CON-01/02, BR-ROLE-05/06, D-16 commercial authority,
// D-22 delete rule. Portal invitations and access (FR-CON-03…05) come in Phase 5.
import { CLIENT_STATUS } from '@cpm/shared';
import { pick, writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { conflict, staleUpdate } from '../../lib/errors.js';

const AUDITED = ['full_name', 'email', 'phone', 'job_title', 'is_primary', 'commercial_authority'];

export function toContactDto(c) {
  return {
    id: c.id,
    client_id: c.client_id,
    full_name: c.full_name,
    email: c.email,
    phone: c.phone,
    job_title: c.job_title,
    is_primary: c.is_primary,
    commercial_authority: c.commercial_authority,
    portal_access: c.portal_access,
    status: c.status,
    last_login_at: c.last_login_at,
    created_at: c.created_at,
    version: c.version,
  };
}

export function findContactInWorkspace(workspaceId, id) {
  return db.clientContact.findFirst({ where: { id, workspace_id: workspaceId }, include: { client: true } });
}

export async function listContacts(client) {
  const rows = await db.clientContact.findMany({
    where: { client_id: client.id },
    orderBy: [{ is_primary: 'desc' }, { full_name: 'asc' }, { id: 'asc' }],
  });
  return { data: rows.map(toContactDto) };
}

/** FR-CON-01, BR-ROLE-05: unique across contacts and internal users. */
async function assertEmailFree(email, exceptContactId) {
  const [user, contact] = await Promise.all([
    db.user.findUnique({ where: { email }, select: { id: true } }),
    db.clientContact.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (user || (contact && contact.id !== exceptContactId)) {
    throw conflict('This email is already used by a contact or a team member', [{ field: 'email', message: 'Already in use' }]);
  }
}

export async function createContact(viewer, client, body, req) {
  if (client.status === CLIENT_STATUS.ARCHIVED) throw conflict('Restore the client before adding contacts');
  await assertEmailFree(body.email);
  const created = await db.$transaction(async (tx) => {
    const existing = await tx.clientContact.count({ where: { client_id: client.id } });
    // FR-CON-02: the first contact becomes primary; a new primary replaces the old one.
    const isPrimary = existing === 0 ? true : Boolean(body.is_primary);
    if (isPrimary && existing > 0) await tx.clientContact.updateMany({ where: { client_id: client.id, is_primary: true }, data: { is_primary: false } });
    const contact = await tx.clientContact.create({
      data: {
        workspace_id: client.workspace_id,
        client_id: client.id,
        full_name: body.full_name,
        email: body.email,
        phone: body.phone ?? null,
        job_title: body.job_title ?? null,
        is_primary: isPrimary,
        // D-16: the primary contact holds commercial authority unless told otherwise
        commercial_authority: body.commercial_authority ?? isPrimary,
        created_by: viewer.id,
        updated_by: viewer.id,
      },
    });
    await writeAudit({ req, action: 'contact.created', entityType: 'ClientContact', entityId: contact.id, clientId: client.id, after: pick(contact, AUDITED) }, tx);
    return contact;
  });
  return toContactDto(created);
}

export async function updateContact(viewer, contact, { version, ...changes }, req) {
  if (changes.email !== undefined && changes.email !== contact.email) await assertEmailFree(changes.email, contact.id);
  if (changes.is_primary === false && contact.is_primary) {
    throw conflict('A client needs a primary contact. Make another contact primary instead.', [
      { field: 'is_primary', message: 'Choose another primary contact' },
    ]);
  }
  const becomesPrimary = changes.is_primary === true && !contact.is_primary;
  if (becomesPrimary && changes.commercial_authority === undefined) changes.commercial_authority = true; // D-16

  const after = await db.$transaction(async (tx) => {
    if (becomesPrimary) {
      await tx.clientContact.updateMany({ where: { client_id: contact.client_id, is_primary: true }, data: { is_primary: false } });
    }
    const res = await tx.clientContact.updateMany({
      where: { id: contact.id, version },
      data: { ...changes, version: { increment: 1 }, updated_by: viewer.id },
    });
    if (res.count !== 1) throw staleUpdate();
    const updated = await tx.clientContact.findUniqueOrThrow({ where: { id: contact.id } });
    const changed = AUDITED.filter((k) => k in changes && String(contact[k]) !== String(updated[k]));
    if (changed.length) {
      await writeAudit(
        { req, action: 'contact.updated', entityType: 'ClientContact', entityId: contact.id, clientId: contact.client_id, before: pick(contact, changed), after: pick(updated, changed) },
        tx,
      );
    }
    return updated;
  });
  return toContactDto(after);
}

/** D-22: only contacts without any history can be deleted. */
async function contactHistory(contactId) {
  const [memberships, comments, uploads, approvals, proposals, signatures, requests, notifications] = await Promise.all([
    db.projectMember.count({ where: { contact_id: contactId } }),
    db.comment.count({ where: { author_contact_id: contactId } }),
    db.fileVersion.count({ where: { uploaded_by_contact_id: contactId } }),
    db.approvalApprover.count({ where: { contact_id: contactId } }),
    db.proposal.count({ where: { accepted_by_contact_id: contactId } }),
    db.contractSignature.count({ where: { signer_contact_id: contactId } }),
    db.task.count({ where: { requested_by_contact_id: contactId } }),
    db.notification.count({ where: { contact_id: contactId } }),
  ]);
  return memberships + comments + uploads + approvals + proposals + signatures + requests + notifications;
}

export async function deleteContact(_viewer, contact, req) {
  if (contact.last_login_at || (await contactHistory(contact.id)) > 0) {
    throw conflict('This contact has history and cannot be deleted. Turn off their portal access instead.');
  }
  if (contact.is_primary && (await db.clientContact.count({ where: { client_id: contact.client_id } })) > 1) {
    throw conflict('Make another contact primary before deleting this one');
  }
  await db.$transaction(async (tx) => {
    await tx.clientContact.delete({ where: { id: contact.id } });
    await writeAudit(
      { req, action: 'contact.deleted', entityType: 'ClientContact', entityId: contact.id, clientId: contact.client_id, before: pick(contact, AUDITED) },
      tx,
    );
  });
}
