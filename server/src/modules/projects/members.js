// Project members: FR-PRJ-05, BR-ROLE-07, D-14. Portal invitations come in Phase 5;
// contacts can already be added with a portal level.
import { PORTAL_LEVELS, PROJECT_ROLE, USER_STATUS } from '@cpm/shared';
import { writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { conflict, fieldError, notFound } from '../../lib/errors.js';
import { isUuid } from '../../lib/validate.js';
import { assertWritable } from './common.js';

const memberInclude = {
  user: { select: { id: true, full_name: true, email: true, role: true, status: true } },
  contact: { select: { id: true, full_name: true, email: true, client_id: true } },
};

/** Contacts see names only (§4.2 Project members row). */
export function toMemberDto(m, project, viewer) {
  if (viewer.kind === 'contact') {
    return { id: m.id, kind: m.user_id ? 'user' : 'contact', full_name: (m.user ?? m.contact).full_name };
  }
  if (m.user) {
    return {
      id: m.id,
      kind: 'user',
      user_id: m.user.id,
      full_name: m.user.full_name,
      email: m.user.email,
      role: m.user.role,
      status: m.user.status, // "Assignee inactive" flags build on this (FR-USER-05)
      project_role: m.project_role,
      is_pm: m.user.id === project.pm_user_id,
      created_at: m.created_at,
    };
  }
  return {
    id: m.id,
    kind: 'contact',
    contact_id: m.contact.id,
    full_name: m.contact.full_name,
    email: m.contact.email,
    portal_level: m.portal_level,
    created_at: m.created_at,
  };
}

export async function listMembers(viewer, project) {
  const rows = await db.projectMember.findMany({ where: { project_id: project.id }, include: memberInclude, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
  return { data: rows.map((m) => toMemberDto(m, project, viewer)) };
}

export async function findMember(project, memberId) {
  const m = isUuid(memberId) ? await db.projectMember.findFirst({ where: { id: memberId, project_id: project.id }, include: memberInclude }) : null;
  if (!m) throw notFound('Member not found');
  return m;
}

const memberAudit = (m) => (m.user ? { user_id: m.user_id, project_role: m.project_role } : { contact_id: m.contact_id, portal_level: m.portal_level });

/** Duplicates are ignored and the existing membership is returned (FR-PRJ-05, TC-PRJ-008). */
export async function addMember(viewer, project, { user_id: userId, contact_id: contactId, portal_level: portalLevel }, req) {
  assertWritable(project);
  if (userId) {
    const user = await db.user.findFirst({ where: { id: userId, workspace_id: project.workspace_id }, select: { status: true } });
    if (!user || user.status !== USER_STATUS.ACTIVE) throw fieldError('user_id', 'Choose an active team member');
  } else {
    const contact = await db.clientContact.findFirst({ where: { id: contactId, workspace_id: project.workspace_id }, select: { client_id: true } });
    if (!contact || contact.client_id !== project.client_id) {
      throw fieldError('contact_id', "Choose a contact of this project's client"); // BR-CLI-01
    }
  }
  const where = userId ? { project_id_user_id: { project_id: project.id, user_id: userId } } : { project_id_contact_id: { project_id: project.id, contact_id: contactId } };
  const existing = await db.projectMember.findUnique({ where, include: memberInclude });
  if (existing) return { member: toMemberDto(existing, project, viewer), created: false };

  const member = await db.$transaction(async (tx) => {
    const m = await tx.projectMember.create({
      data: {
        workspace_id: project.workspace_id,
        project_id: project.id,
        user_id: userId ?? null,
        contact_id: contactId ?? null,
        project_role: userId ? PROJECT_ROLE.MEMBER : null,
        portal_level: contactId ? (portalLevel ?? PORTAL_LEVELS.VIEW) : null, // FR-CON-04 default View
        created_by: viewer.id,
        updated_by: viewer.id,
      },
      include: memberInclude,
    });
    await writeAudit(
      { req, action: 'project.member_added', entityType: 'ProjectMember', entityId: m.id, projectId: project.id, clientId: project.client_id, after: memberAudit(m) },
      tx,
    );
    return m;
  });
  return { member: toMemberDto(member, project, viewer), created: true };
}

export async function updateMember(viewer, project, member, { portal_level: portalLevel }, req) {
  assertWritable(project);
  if (!member.contact_id) throw fieldError('portal_level', 'Portal level is only for client contacts');
  const after = await db.$transaction(async (tx) => {
    const m = await tx.projectMember.update({ where: { id: member.id }, data: { portal_level: portalLevel, updated_by: viewer.id }, include: memberInclude });
    await writeAudit(
      { req, action: 'project.member_updated', entityType: 'ProjectMember', entityId: m.id, projectId: project.id, clientId: project.client_id, before: memberAudit(member), after: memberAudit(m) },
      tx,
    );
    return m;
  });
  return toMemberDto(after, project, viewer);
}

/** BR-ROLE-07: access ends on the next request; past work stays attributed. */
export async function removeMember(viewer, project, member, req) {
  assertWritable(project);
  if (member.user_id && member.user_id === project.pm_user_id) {
    throw conflict('Choose a new PM for the project before removing the current one'); // FR-PRJ-05
  }
  await db.$transaction(async (tx) => {
    await tx.projectMember.delete({ where: { id: member.id } });
    await writeAudit(
      { req, action: 'project.member_removed', entityType: 'ProjectMember', entityId: member.id, projectId: project.id, clientId: project.client_id, before: memberAudit(member) },
      tx,
    );
  });
}
