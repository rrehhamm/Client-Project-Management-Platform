// Server-side sessions. Every request re-checks the session and the person behind
// it, so logout, deactivation and role changes apply on the next request
// (FR-AUTH-05, FR-AUTH-06, BR-ROLE-04), and the portal idle timeout can be enforced.
import { CLIENT_STATUS, CONTACT_STATUS, USER_STATUS } from '@cpm/shared';
import { db } from '../lib/db.js';
import { unauthenticated } from '../lib/errors.js';
import { randomToken, sha256, signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from './tokens.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 7 * DAY_MS; // FR-AUTH-10: refresh 7 days, sliding
export const REMEMBER_ME_TTL_MS = 30 * DAY_MS; // internal users with "Remember me"
export const PORTAL_IDLE_MS = 30 * 60 * 1000; // contacts: 30 min idle → sign in again, always
const ACTIVITY_WRITE_EVERY_MS = 60 * 1000;

const sessionInclude = {
  user: true,
  contact: { include: { client: { select: { id: true, name: true, status: true } } } },
};

/** The signed-in person as the rest of the app sees them. */
export function toPrincipal(session) {
  if (session.user) {
    const u = session.user;
    return {
      kind: 'user',
      id: u.id,
      workspace_id: u.workspace_id,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      status: u.status,
      session_id: session.id,
    };
  }
  const c = session.contact;
  return {
    kind: 'contact',
    id: c.id,
    workspace_id: c.workspace_id,
    email: c.email,
    full_name: c.full_name,
    role: null,
    status: c.status,
    client_id: c.client_id,
    client_name: c.client.name,
    session_id: session.id,
  };
}

/** Why this user/contact may not have a session right now, or null if they may. */
export function inactiveReason({ user, contact }) {
  if (user) return user.status === USER_STATUS.ACTIVE ? null : 'deactivated';
  if (!contact.portal_access || contact.client.status === CLIENT_STATUS.ARCHIVED) return 'portal_disabled';
  if (contact.status !== CONTACT_STATUS.ACTIVE) return 'portal_disabled';
  return null;
}

function lifetimeMs(session) {
  return session.remember_me ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS;
}

function isIdle(session, now) {
  return Boolean(session.contact_id) && now - session.last_activity_at.getTime() > PORTAL_IDLE_MS;
}

async function issueTokens(session, jti) {
  const principalId = session.user_id ?? session.contact_id;
  const kind = session.user_id ? 'user' : 'contact';
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ principalId, kind, sessionId: session.id }),
    signRefreshToken({ sessionId: session.id, jti, expiresAt: session.expires_at }),
  ]);
  return { accessToken, refreshToken, refreshExpiresAt: session.expires_at };
}

/** Start a session after a successful login or invitation acceptance. */
export async function createSession({ user, contact, rememberMe = false, req }) {
  const jti = randomToken();
  // "Remember me" never extends a contact's session (DECISIONS.md D-08).
  const remember = Boolean(user) && rememberMe;
  const principalId = user?.id ?? contact.id;
  const session = await db.session.create({
    data: {
      workspace_id: (user ?? contact).workspace_id,
      user_id: user?.id ?? null,
      contact_id: contact?.id ?? null,
      refresh_jti_hash: sha256(jti),
      remember_me: remember,
      expires_at: new Date(Date.now() + (remember ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS)),
      ip: req?.ip ?? null,
      user_agent: req?.get?.('user-agent')?.slice(0, 512) ?? null,
      created_by: principalId,
      updated_by: principalId,
    },
    include: sessionInclude,
  });
  return { session, principal: toPrincipal(session), ...(await issueTokens(session, jti)) };
}

export function revokeSession(id, reason) {
  return db.session.updateMany({ where: { id, revoked_at: null }, data: { revoked_at: new Date(), revoke_reason: reason } });
}

/** Revoke every open session of a user or contact, optionally keeping one. */
export function revokeAllSessions({ userId, contactId }, reason, { exceptSessionId, client = db } = {}) {
  return client.session.updateMany({
    where: {
      ...(userId ? { user_id: userId } : { contact_id: contactId }),
      revoked_at: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revoked_at: new Date(), revoke_reason: reason },
  });
}

/** Load a usable session or explain why not. */
async function loadLiveSession(sessionId, now) {
  const session = await db.session.findUnique({ where: { id: sessionId }, include: sessionInclude });
  if (!session || session.revoked_at || session.expires_at.getTime() <= now) return { session: null };
  if (isIdle(session, now)) {
    await revokeSession(session.id, 'idle_timeout');
    return { session: null };
  }
  if (inactiveReason(session)) {
    await revokeSession(session.id, inactiveReason(session));
    return { session: null };
  }
  return { session };
}

/** Access-token check run on every request. Returns a principal or null. */
export async function principalFromAccessToken(token) {
  const payload = await verifyAccessToken(token);
  if (!payload?.sid || !payload.sub) return null;
  const now = Date.now();
  const { session } = await loadLiveSession(payload.sid, now);
  if (!session || (session.user_id ?? session.contact_id) !== payload.sub) return null;
  if (now - session.last_activity_at.getTime() > ACTIVITY_WRITE_EVERY_MS) {
    await db.session.update({ where: { id: session.id }, data: { last_activity_at: new Date(now) } });
  }
  return toPrincipal(session);
}

/**
 * Exchange a refresh token for new tokens (rotation). A refresh token that was
 * already used means it was copied: the whole session is revoked.
 */
export async function rotateSession(refreshToken) {
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload?.sid || !payload.jti) throw unauthenticated();
  const now = Date.now();
  const { session } = await loadLiveSession(payload.sid, now);
  if (!session) throw unauthenticated();
  if (session.refresh_jti_hash !== sha256(payload.jti)) {
    await revokeSession(session.id, 'refresh_reuse');
    throw unauthenticated();
  }
  const jti = randomToken();
  // Rotate only if the stored jti is still the one we checked (two tabs refreshing at once).
  const updated = await db.session.updateMany({
    where: { id: session.id, refresh_jti_hash: session.refresh_jti_hash, revoked_at: null },
    data: { refresh_jti_hash: sha256(jti), expires_at: new Date(now + lifetimeMs(session)) },
  });
  if (updated.count !== 1) throw unauthenticated();
  const fresh = await db.session.findUniqueOrThrow({ where: { id: session.id }, include: sessionInclude });
  return { session: fresh, principal: toPrincipal(fresh), ...(await issueTokens(fresh, jti)) };
}

/** Session id from a refresh token, for logout when the access token has expired. */
export async function sessionIdFromRefreshToken(refreshToken) {
  const payload = await verifyRefreshToken(refreshToken);
  return payload?.sid ?? null;
}
