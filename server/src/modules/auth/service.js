// Sign-in, sessions, invitations, passwords and the signed-in user's own profile.
// FR-AUTH-01…11, FR-AUTH-13, BR-AUTH-01…06.
import { ACTOR_TYPES, ERROR_CODES, ROLES, USER_STATUS, CONTACT_STATUS } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { createLinkToken, consumeLinkToken, findLinkToken, linkExpired } from '../../auth/linkTokens.js';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../../auth/passwords.js';
import {
  createSession,
  inactiveReason,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  sessionIdFromRefreshToken,
} from '../../auth/sessions.js';
import { clearFailures, lockedUntil, recordFailure } from '../../auth/throttle.js';
import { pick, writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import {
  sendEmailChangeNotice,
  sendEmailChangeVerification,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} from '../../lib/emails.js';
import { AppError, conflict, fieldError, staleUpdate, unauthenticated } from '../../lib/errors.js';
import { getDefaultWorkspaceId, getWorkspace } from '../../lib/workspace.js';

const SYSTEM = { type: ACTOR_TYPES.SYSTEM, id: null };
const actorFor = (user, contact) =>
  user ? { type: ACTOR_TYPES.USER, id: user.id } : contact ? { type: ACTOR_TYPES.CONTACT, id: contact.id } : SYSTEM;
const entityTypeFor = (user, contact) => (user ? 'User' : contact ? 'ClientContact' : 'Auth');

const invalidCredentials = () =>
  new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Email or password is incorrect'); // FR-AUTH-02
const accountDeactivated = () => new AppError(403, ERROR_CODES.ACCOUNT_DEACTIVATED, 'Your account is deactivated'); // FR-AUTH-06
const portalDisabled = () => new AppError(403, ERROR_CODES.PORTAL_ACCESS_DISABLED, 'Portal access is disabled'); // BR-AUTH-05
function accountLocked(until) {
  const seconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
  const minutes = Math.ceil(seconds / 60);
  return new AppError(
    423,
    ERROR_CODES.ACCOUNT_LOCKED,
    `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    [],
    { 'Retry-After': String(seconds) },
  );
}

/** Where each kind of principal lands after signing in (FR-AUTH-01). */
export const homeFor = (principal) => (principal.kind === 'contact' ? '/portal' : '/');

/** Logs errors from emails we do not wait for (forgot password, notices). */
function fireAndForget(promise, req, what) {
  promise.catch((err) => req.log?.error({ err }, `Could not send ${what} email`));
}

async function findAccountByEmail(email) {
  const user = await db.user.findUnique({ where: { email } });
  if (user) return { user, contact: null };
  const contact = await db.clientContact.findUnique({
    where: { email },
    include: { client: { select: { id: true, name: true, status: true } } },
  });
  return { user: null, contact };
}

// ---------------------------------------------------------------------------
// Sign in / out
// ---------------------------------------------------------------------------

export async function login({ email, password, remember_me: rememberMe }, req) {
  const defaultWorkspaceId = await getDefaultWorkspaceId();

  const until = await lockedUntil(email);
  if (until) {
    await writeAudit({ req, actor: SYSTEM, action: 'auth.login_blocked', entityType: 'Auth', after: { email } });
    throw accountLocked(until);
  }

  const { user, contact } = await findAccountByEmail(email);
  const account = user ?? contact;
  const passwordOk = await verifyPassword(password, account?.password_hash);

  if (!passwordOk) {
    const workspaceId = account?.workspace_id ?? defaultWorkspaceId;
    const result = await recordFailure(email, workspaceId);
    const auditBase = { req, workspaceId, actor: actorFor(user, contact), entityType: entityTypeFor(user, contact), entityId: account?.id };
    await writeAudit({ ...auditBase, action: 'auth.login_failed', after: { email, failed_count: result.failedCount } });
    if (result.justLocked) {
      await writeAudit({ ...auditBase, action: 'auth.account_locked', after: { email, locked_until: result.lockedUntil } });
    }
    throw invalidCredentials();
  }

  await clearFailures(email);
  const reason = inactiveReason({ user, contact });
  if (reason) {
    await writeAudit({
      req,
      workspaceId: account.workspace_id,
      actor: actorFor(user, contact),
      action: 'auth.login_denied',
      entityType: entityTypeFor(user, contact),
      entityId: account.id,
      after: { reason },
    });
    throw reason === 'deactivated' ? accountDeactivated() : portalDisabled();
  }

  const session = await createSession({ user, contact, rememberMe, req });
  const now = new Date();
  if (user) await db.user.update({ where: { id: user.id }, data: { last_login_at: now } });
  else await db.clientContact.update({ where: { id: contact.id }, data: { last_login_at: now } });

  await writeAudit({
    req,
    workspaceId: account.workspace_id,
    actor: actorFor(user, contact),
    action: 'auth.login',
    entityType: entityTypeFor(user, contact),
    entityId: account.id,
    after: { remember_me: session.session.remember_me },
  });
  return session;
}

export async function refresh(refreshToken) {
  if (!refreshToken) throw unauthenticated();
  return rotateSession(refreshToken);
}

export async function logout(req, refreshToken) {
  const sessionId = req.principal?.session_id ?? (refreshToken ? await sessionIdFromRefreshToken(refreshToken) : null);
  if (!sessionId) return;
  await revokeSession(sessionId, 'logout');
  if (req.principal) {
    await writeAudit({
      req,
      action: 'auth.logout',
      entityType: req.principal.kind === 'user' ? 'User' : 'ClientContact',
      entityId: req.principal.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Current principal and profile (FR-AUTH-13)
// ---------------------------------------------------------------------------

/** UI hints only; the server checks every action again. */
function capabilitiesFor(principal) {
  const teamMemberTarget = { target: { role: ROLES.TEAM_MEMBER } };
  return {
    internal_app: can(principal, 'self.internalApp'),
    portal: can(principal, 'self.portal'),
    manage_team: can(principal, 'user.list'),
    invite_users: can(principal, 'user.invite', teamMemberTarget),
    invite_any_role: can(principal, 'user.invite', { target: { role: ROLES.ADMIN } }),
    change_roles: can(principal, 'user.changeRole', teamMemberTarget),
    deactivate_users: can(principal, 'user.deactivate', teamMemberTarget),
    view_rates: can(principal, 'user.viewRates'),
    edit_rates: can(principal, 'user.updateRates', teamMemberTarget),
    transfer_ownership: can(principal, 'workspace.transferOwnership'),
    manage_workspace: can(principal, 'workspace.update'),
    view_clients: can(principal, 'client.readDetails'),
    create_clients: can(principal, 'client.create'),
    edit_clients: can(principal, 'client.update'),
    delete_clients: can(principal, 'client.delete'),
    manage_contacts: can(principal, 'contact.create'),
    list_projects: can(principal, 'project.list'),
    create_projects: can(principal, 'project.create'),
    delete_projects: can(principal, 'project.delete'),
    view_financials: can(principal, 'project.viewFinancials'),
    my_tasks: can(principal, 'self.internalApp'),
    list_templates: can(principal, 'template.list'),
    manage_templates: can(principal, 'template.manage'),
    view_audit: can(principal, 'audit.readAll'), // FR-ACT-02
    search: can(principal, 'self.internalApp'), // FR-SRCH-01
  };
}

export async function getMe(principal) {
  const workspace = await getWorkspace(principal.workspace_id);
  const record =
    principal.kind === 'user'
      ? await db.user.findUniqueOrThrow({ where: { id: principal.id } })
      : await db.clientContact.findUniqueOrThrow({
          where: { id: principal.id },
          include: { client: { select: { id: true, name: true } } },
        });
  return {
    principal: {
      kind: principal.kind,
      id: record.id,
      email: record.email,
      full_name: record.full_name,
      role: principal.kind === 'user' ? record.role : null,
      phone: record.phone,
      timezone: record.timezone,
      version: record.version,
      has_avatar: Boolean(record.avatar_key), // FR-AUTH-13
      client: principal.kind === 'contact' ? record.client : null,
    },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      brand_color: workspace.brand_color,
      timezone: workspace.timezone,
      currency: workspace.currency,
      date_format: workspace.date_format,
      week_start_day: workspace.week_start_day,
    },
    capabilities: capabilitiesFor(principal),
    home: homeFor(principal),
  };
}

const PROFILE_FIELDS = ['full_name', 'phone', 'timezone'];

export async function updateProfile(principal, { version, ...changes }, req) {
  const model = principal.kind === 'user' ? db.user : db.clientContact;
  const before = await model.findUniqueOrThrow({ where: { id: principal.id } });
  const res = await model.updateMany({
    where: { id: principal.id, version },
    data: { ...changes, version: { increment: 1 }, updated_by: principal.id },
  });
  if (res.count !== 1) throw staleUpdate(); // NFR-CONC-01
  const after = await model.findUniqueOrThrow({ where: { id: principal.id } });
  await writeAudit({
    req,
    action: 'profile.updated',
    entityType: principal.kind === 'user' ? 'User' : 'ClientContact',
    entityId: principal.id,
    before: pick(before, PROFILE_FIELDS),
    after: pick(after, PROFILE_FIELDS),
  });
  return getMe(principal);
}

async function emailInUse(email) {
  const [u, c] = await Promise.all([
    db.user.findUnique({ where: { email }, select: { id: true } }),
    db.clientContact.findUnique({ where: { email }, select: { id: true } }),
  ]);
  return Boolean(u || c);
}

export async function requestEmailChange(principal, { new_email: newEmail, current_password: currentPassword }, req) {
  const isUser = principal.kind === 'user';
  const model = isUser ? db.user : db.clientContact;
  const account = await model.findUniqueOrThrow({ where: { id: principal.id } });
  if (!(await verifyPassword(currentPassword, account.password_hash))) {
    throw fieldError('current_password', 'Current password is incorrect');
  }
  if (newEmail === account.email) throw fieldError('new_email', 'This is already your email address');
  if (await emailInUse(newEmail)) throw conflict('This email address is already in use', [{ field: 'new_email', message: 'Already in use' }]);

  const token = await createLinkToken({
    purpose: 'EmailChange',
    userId: isUser ? account.id : null,
    contactId: isUser ? null : account.id,
    workspaceId: account.workspace_id,
    newEmail,
    createdBy: account.id,
  });
  const workspace = await getWorkspace(account.workspace_id);
  await sendEmailChangeVerification({ to: newEmail, fullName: account.full_name, workspaceName: workspace.name, token });
  fireAndForget(
    sendEmailChangeNotice({ to: account.email, fullName: account.full_name, workspaceName: workspace.name, newEmail }),
    req,
    'email change notice',
  );
  await writeAudit({
    req,
    action: 'auth.email_change_requested',
    entityType: isUser ? 'User' : 'ClientContact',
    entityId: account.id,
    after: { new_email: newEmail },
  });
}

export async function verifyEmailChange({ token }, req) {
  const row = await findLinkToken('EmailChange', token);
  const account = row.user ?? row.contact;
  if (await emailInUse(row.new_email)) throw conflict('This email address is already in use');
  await db.$transaction(async (tx) => {
    await consumeLinkToken(row, tx);
    await (row.user ? tx.user : tx.clientContact).update({
      where: { id: account.id },
      data: { email: row.new_email, version: { increment: 1 }, updated_by: account.id },
    });
    await writeAudit(
      {
        req,
        workspaceId: account.workspace_id,
        actor: actorFor(row.user, row.contact),
        action: 'auth.email_changed',
        entityType: entityTypeFor(row.user, row.contact),
        entityId: account.id,
        before: { email: account.email },
        after: { email: row.new_email },
      },
      tx,
    );
  });
  return { email: row.new_email };
}

// ---------------------------------------------------------------------------
// Invitations (FR-AUTH-07)
// ---------------------------------------------------------------------------

async function invitationRow(token) {
  const row = await findLinkToken('Invite', token);
  const pending = row.user ? row.user.status === USER_STATUS.INVITED : row.contact?.status === CONTACT_STATUS.INVITED;
  if (!pending) throw linkExpired('Invite');
  return row;
}

export async function getInvitation(token) {
  const row = await invitationRow(token);
  const account = row.user ?? row.contact;
  const workspace = await getWorkspace(account.workspace_id);
  return { email: account.email, full_name: account.full_name, workspace_name: workspace.name };
}

export async function acceptInvitation({ token, password }, req) {
  const row = await invitationRow(token);
  const account = row.user ?? row.contact;
  assertPasswordPolicy(password, account.email);
  const passwordHash = await hashPassword(password);

  await db.$transaction(async (tx) => {
    await consumeLinkToken(row, tx);
    const data = { password_hash: passwordHash, status: 'Active', version: { increment: 1 }, updated_by: account.id };
    if (row.user) await tx.user.update({ where: { id: account.id }, data });
    else await tx.clientContact.update({ where: { id: account.id }, data });
    await writeAudit(
      {
        req,
        workspaceId: account.workspace_id,
        actor: actorFor(row.user, row.contact),
        action: 'auth.invite_accepted',
        entityType: entityTypeFor(row.user, row.contact),
        entityId: account.id,
        before: { status: account.status },
        after: { status: 'Active' },
      },
      tx,
    );
  });

  // Accepting signs the person in (approved assumption).
  const { user, contact } = await findAccountByEmail(account.email);
  if (inactiveReason({ user, contact })) throw contact ? portalDisabled() : accountDeactivated();
  return createSession({ user, contact, req });
}

// ---------------------------------------------------------------------------
// Passwords (FR-AUTH-08, FR-AUTH-09)
// ---------------------------------------------------------------------------

/** Always succeeds from the caller's point of view: no account enumeration. */
export async function forgotPassword({ email }, req) {
  const { user, contact } = await findAccountByEmail(email);
  const account = user ?? contact;
  const eligible = account && account.password_hash && !inactiveReason({ user, contact });
  if (!eligible) {
    await writeAudit({ req, actor: SYSTEM, action: 'auth.password_reset_requested', entityType: 'Auth', after: { email, sent: false } });
    return;
  }
  const token = await createLinkToken({
    purpose: 'PasswordReset',
    userId: user?.id,
    contactId: contact?.id,
    workspaceId: account.workspace_id,
  });
  const workspace = await getWorkspace(account.workspace_id);
  fireAndForget(
    sendPasswordResetEmail({ to: account.email, fullName: account.full_name, workspaceName: workspace.name, token }),
    req,
    'password reset',
  );
  await writeAudit({
    req,
    workspaceId: account.workspace_id,
    actor: actorFor(user, contact),
    action: 'auth.password_reset_requested',
    entityType: entityTypeFor(user, contact),
    entityId: account.id,
    after: { sent: true },
  });
}

export async function resetPassword({ token, password }, req) {
  const row = await findLinkToken('PasswordReset', token);
  const account = row.user ?? row.contact;
  assertPasswordPolicy(password, account.email);
  const passwordHash = await hashPassword(password);
  const owner = row.user ? { userId: account.id } : { contactId: account.id };

  await db.$transaction(async (tx) => {
    await consumeLinkToken(row, tx);
    const data = { password_hash: passwordHash, version: { increment: 1 }, updated_by: account.id };
    if (row.user) await tx.user.update({ where: { id: account.id }, data });
    else await tx.clientContact.update({ where: { id: account.id }, data });
    await revokeAllSessions(owner, 'password_reset', { client: tx }); // FR-AUTH-08
    await writeAudit(
      {
        req,
        workspaceId: account.workspace_id,
        actor: actorFor(row.user, row.contact),
        action: 'auth.password_reset',
        entityType: entityTypeFor(row.user, row.contact),
        entityId: account.id,
      },
      tx,
    );
  });
  await clearFailures(account.email);
  const workspace = await getWorkspace(account.workspace_id);
  fireAndForget(
    sendPasswordChangedEmail({ to: account.email, fullName: account.full_name, workspaceName: workspace.name }),
    req,
    'password changed',
  );
}

export async function changePassword(principal, { current_password: currentPassword, new_password: newPassword }, req) {
  const isUser = principal.kind === 'user';
  const model = isUser ? db.user : db.clientContact;
  const account = await model.findUniqueOrThrow({ where: { id: principal.id } });
  if (!(await verifyPassword(currentPassword, account.password_hash))) {
    await writeAudit({ req, action: 'auth.password_change_failed', entityType: isUser ? 'User' : 'ClientContact', entityId: account.id });
    throw fieldError('current_password', 'Current password is incorrect');
  }
  assertPasswordPolicy(newPassword, account.email, 'new_password');
  const passwordHash = await hashPassword(newPassword);

  await db.$transaction(async (tx) => {
    await (isUser ? tx.user : tx.clientContact).update({
      where: { id: account.id },
      data: { password_hash: passwordHash, version: { increment: 1 }, updated_by: account.id },
    });
    // FR-AUTH-09: other sessions are signed out, this one stays.
    await revokeAllSessions(isUser ? { userId: account.id } : { contactId: account.id }, 'password_changed', {
      exceptSessionId: principal.session_id,
      client: tx,
    });
    await writeAudit({ req, action: 'auth.password_changed', entityType: isUser ? 'User' : 'ClientContact', entityId: account.id }, tx);
  });
  const workspace = await getWorkspace(account.workspace_id);
  fireAndForget(
    sendPasswordChangedEmail({ to: account.email, fullName: account.full_name, workspaceName: workspace.name }),
    req,
    'password changed',
  );
}
