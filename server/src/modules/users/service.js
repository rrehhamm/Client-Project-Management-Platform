// Internal user lifecycle: Invited → Active → Deactivated ↔ Active.
// FR-USER-01…07, BR-ROLE-01…04, BR-USER-01/03.
import { ERROR_CODES, ROLES, USER_STATUS } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { createLinkToken } from '../../auth/linkTokens.js';
import { verifyPassword } from '../../auth/passwords.js';
import { revokeAllSessions } from '../../auth/sessions.js';
import { pick, writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { sendInviteEmail } from '../../lib/emails.js';
import { AppError, conflict, fieldError, forbidden, staleUpdate } from '../../lib/errors.js';
import { getWorkspace } from '../../lib/workspace.js';

const ADMIN_ROLES = [ROLES.OWNER, ROLES.ADMIN];
const AUDITED_FIELDS = ['full_name', 'role', 'status', 'capacity_minutes_per_week', 'hourly_cost_rate', 'default_bill_rate'];

const adminRequired = () => new AppError(409, ERROR_CODES.CONFLICT, 'At least one administrator is required'); // BR-ROLE-02

/** Public shape of a user. Rates only for roles allowed to see them (FR-USER-07). */
export function toUserDto(user, viewer) {
  const dto = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    status: user.status,
    phone: user.phone,
    timezone: user.timezone,
    capacity_minutes_per_week: user.capacity_minutes_per_week,
    last_login_at: user.last_login_at,
    deactivated_at: user.deactivated_at,
    created_at: user.created_at,
    version: user.version,
  };
  if (can(viewer, 'user.viewRates')) {
    dto.hourly_cost_rate = user.hourly_cost_rate;
    dto.default_bill_rate = user.default_bill_rate;
  }
  return dto;
}

/** Loader for authorize(): the target user, in the caller's workspace. */
export async function findUserInWorkspace(workspaceId, id) {
  return db.user.findFirst({ where: { id, workspace_id: workspaceId } });
}

// ---------------------------------------------------------------------------
// List / read (FR-USER-03)
// ---------------------------------------------------------------------------

export async function listUsers(viewer, { page, page_size: pageSize, role, status, q, assignable }) {
  const where = {
    workspace_id: viewer.workspace_id,
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(assignable ? { status: USER_STATUS.ACTIVE } : {}), // FR-USER-05: deactivated users are not assignable
    ...(q
      ? {
          OR: [
            { full_name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q.toLowerCase() } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.user.findMany({ where, orderBy: [{ full_name: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    db.user.count({ where }),
  ]);
  return { data: rows.map((u) => toUserDto(u, viewer)), page, page_size: pageSize, total };
}

// ---------------------------------------------------------------------------
// Invitations (FR-USER-01, FR-USER-02)
// ---------------------------------------------------------------------------

async function sendInvite(viewer, user, token, req) {
  const workspace = await getWorkspace(user.workspace_id);
  try {
    await sendInviteEmail({ to: user.email, fullName: user.full_name, workspaceName: workspace.name, inviterName: viewer.full_name, token });
    return true;
  } catch (err) {
    req.log?.error({ err }, 'Could not send invitation email');
    return false; // the admin can use Resend
  }
}

export async function inviteUser(viewer, { email, full_name: fullName, role }, req) {
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    throw conflict('User already exists', [{ field: 'email', message: 'User already exists' }]);
  }
  if (await db.clientContact.findUnique({ where: { email }, select: { id: true } })) {
    // BR-ROLE-05
    throw conflict('This email belongs to a client contact', [{ field: 'email', message: 'Used by a client contact' }]);
  }
  const { user, token } = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        workspace_id: viewer.workspace_id,
        email,
        full_name: fullName,
        role,
        status: USER_STATUS.INVITED,
        created_by: viewer.id,
        updated_by: viewer.id,
      },
    });
    const raw = await createLinkToken(
      { purpose: 'Invite', userId: created.id, workspaceId: created.workspace_id, createdBy: viewer.id },
      tx,
    );
    await writeAudit({ req, action: 'user.invited', entityType: 'User', entityId: created.id, after: pick(created, ['email', 'full_name', 'role', 'status']) }, tx);
    return { user: created, token: raw };
  });
  const emailSent = await sendInvite(viewer, user, token, req);
  return { user: toUserDto(user, viewer), email_sent: emailSent };
}

function assertInvited(target) {
  if (target.status !== USER_STATUS.INVITED) throw conflict('Only pending invitations can be resent or revoked');
}

export async function resendInvitation(viewer, target, req) {
  assertInvited(target);
  const token = await db.$transaction(async (tx) => {
    // Issuing a new token revokes the old link (FR-USER-02).
    const raw = await createLinkToken(
      { purpose: 'Invite', userId: target.id, workspaceId: target.workspace_id, createdBy: viewer.id },
      tx,
    );
    await writeAudit({ req, action: 'user.invitation_resent', entityType: 'User', entityId: target.id }, tx);
    return raw;
  });
  return { user: toUserDto(target, viewer), email_sent: await sendInvite(viewer, target, token, req) };
}

export async function revokeInvitation(_viewer, target, req) {
  assertInvited(target);
  await db.$transaction(async (tx) => {
    // FR-USER-02: an Invited user has no history, so the record is deleted.
    await tx.user.delete({ where: { id: target.id } });
    await writeAudit(
      { req, action: 'user.invitation_revoked', entityType: 'User', entityId: target.id, before: pick(target, ['email', 'full_name', 'role', 'status']) },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Role and admin rules (BR-ROLE-01…04)
// ---------------------------------------------------------------------------

const isActiveAdministrator = (u) => ADMIN_ROLES.includes(u.role) && u.status === USER_STATUS.ACTIVE;

/** BR-ROLE-02: would removing `target` from the administrators leave none? */
async function assertAnotherAdministrator(target, client = db) {
  if (!isActiveAdministrator(target)) return;
  const others = await client.user.count({
    where: { workspace_id: target.workspace_id, id: { not: target.id }, role: { in: ADMIN_ROLES }, status: USER_STATUS.ACTIVE },
  });
  if (others === 0) throw adminRequired();
}

/**
 * Checks in a fixed order (approved): last administrator (409), then Owner
 * protection (409), then "not yourself" (403, BR-ROLE-03).
 */
async function assertRoleChangeAllowed(viewer, target, newRole) {
  if (ADMIN_ROLES.includes(target.role) && !ADMIN_ROLES.includes(newRole)) await assertAnotherAdministrator(target);
  if (target.role === ROLES.OWNER) {
    throw conflict("The Owner's role can only change by transferring ownership"); // BR-ROLE-01
  }
  if (target.id === viewer.id) throw forbidden('You cannot change your own role'); // BR-ROLE-03
}

// ---------------------------------------------------------------------------
// Update (FR-USER-04, FR-USER-07)
// ---------------------------------------------------------------------------

export async function updateUser(viewer, target, { version, ...changes }, req) {
  if (Object.keys(changes).length === 0) throw fieldError(null, 'Nothing to update');
  if (changes.role !== undefined && changes.role !== target.role) {
    await assertRoleChangeAllowed(viewer, target, changes.role);
  }
  const updated = await db.$transaction(async (tx) => {
    const res = await tx.user.updateMany({
      where: { id: target.id, version },
      data: { ...changes, version: { increment: 1 }, updated_by: viewer.id },
    });
    if (res.count !== 1) throw staleUpdate(); // NFR-CONC-01
    const after = await tx.user.findUniqueOrThrow({ where: { id: target.id } });
    const changedKeys = AUDITED_FIELDS.filter((k) => k in changes && String(target[k]) !== String(after[k]));
    if (changedKeys.length) {
      await writeAudit(
        {
          req,
          action: changedKeys.includes('role') ? 'user.role_changed' : 'user.updated',
          entityType: 'User',
          entityId: target.id,
          before: pick(target, changedKeys),
          after: pick(after, changedKeys),
        },
        tx,
      );
    }
    return after;
  });
  // A role change applies on the target's next request (BR-ROLE-04): every request reloads the role.
  return toUserDto(updated, viewer);
}

// ---------------------------------------------------------------------------
// Deactivate / reactivate (FR-USER-05, FR-USER-06)
// ---------------------------------------------------------------------------

export async function deactivateUser(viewer, target, req) {
  if (target.status === USER_STATUS.DEACTIVATED) throw conflict('User is already deactivated');
  if (target.status === USER_STATUS.INVITED) throw conflict('This user has not accepted the invitation. Revoke it instead.');
  await assertAnotherAdministrator(target);
  if (target.role === ROLES.OWNER) throw conflict('The Owner cannot be deactivated. Transfer ownership first.');
  if (target.id === viewer.id) throw forbidden('You cannot deactivate your own account');

  const updated = await db.$transaction(async (tx) => {
    const after = await tx.user.update({
      where: { id: target.id },
      data: { status: USER_STATUS.DEACTIVATED, deactivated_at: new Date(), version: { increment: 1 }, updated_by: viewer.id },
    });
    await revokeAllSessions({ userId: target.id }, 'deactivated', { client: tx }); // FR-AUTH-06
    await writeAudit(
      { req, action: 'user.deactivated', entityType: 'User', entityId: target.id, before: { status: target.status }, after: { status: after.status } },
      tx,
    );
    return after;
  });
  // Open tasks stay assigned and are flagged "Assignee inactive" (Phase 3); a running
  // timer is stopped and saved (Phase 6, E2E-07).
  return toUserDto(updated, viewer);
}

export async function reactivateUser(viewer, target, req) {
  if (target.status !== USER_STATUS.DEACTIVATED) throw conflict('Only deactivated users can be reactivated');
  const updated = await db.$transaction(async (tx) => {
    // Memberships were never removed, so they come back with the user (FR-USER-06).
    const after = await tx.user.update({
      where: { id: target.id },
      data: { status: USER_STATUS.ACTIVE, deactivated_at: null, version: { increment: 1 }, updated_by: viewer.id },
    });
    await writeAudit(
      { req, action: 'user.reactivated', entityType: 'User', entityId: target.id, before: { status: target.status }, after: { status: after.status } },
      tx,
    );
    return after;
  });
  return toUserDto(updated, viewer);
}

// ---------------------------------------------------------------------------
// Ownership transfer (BR-ROLE-01)
// ---------------------------------------------------------------------------

export async function transferOwnership(viewer, target, { password }, req) {
  const owner = await db.user.findUniqueOrThrow({ where: { id: viewer.id } });
  if (!(await verifyPassword(password, owner.password_hash))) throw fieldError('password', 'Password is incorrect');
  if (target.id === owner.id) throw conflict('You already own this workspace');
  if (target.role !== ROLES.ADMIN || target.status !== USER_STATUS.ACTIVE) {
    throw conflict('Ownership can only be transferred to an active Admin');
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: owner.id }, data: { role: ROLES.ADMIN, version: { increment: 1 }, updated_by: owner.id } });
    await tx.user.update({ where: { id: target.id }, data: { role: ROLES.OWNER, version: { increment: 1 }, updated_by: owner.id } });
    await writeAudit(
      {
        req,
        action: 'workspace.ownership_transferred',
        entityType: 'Workspace',
        entityId: owner.workspace_id,
        before: { owner_id: owner.id },
        after: { owner_id: target.id },
      },
      tx,
    );
  });
  return toUserDto(await db.user.findUniqueOrThrow({ where: { id: target.id } }), { ...viewer, role: ROLES.ADMIN });
}
