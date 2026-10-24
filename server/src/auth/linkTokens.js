// Single-use emailed links (invite, password reset, email change).
// Only the SHA-256 of a token is stored; the raw token exists only in the email.
import { ERROR_CODES } from '@cpm/shared';
import { db } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { randomToken, sha256 } from './tokens.js';

export const LINK_TTL_MS = {
  Invite: 7 * 24 * 60 * 60 * 1000, // FR-AUTH-07
  PasswordReset: 60 * 60 * 1000, // FR-AUTH-08
  EmailChange: 24 * 60 * 60 * 1000, // FR-AUTH-13 (DECISIONS.md D-11)
};

export const LINK_EXPIRED_MESSAGES = {
  Invite: 'Invitation expired, ask your admin to resend', // FR-AUTH-07
  PasswordReset: 'Link expired or used', // TC-AUTH-008
  EmailChange: 'Link expired or used',
};

export const linkExpired = (purpose) => new AppError(410, ERROR_CODES.LINK_EXPIRED, LINK_EXPIRED_MESSAGES[purpose]);

/** Create a token, revoking earlier unused ones of the same purpose for that person. */
export async function createLinkToken({ purpose, userId, contactId, workspaceId, newEmail = null, createdBy }, client = db) {
  const owner = userId ? { user_id: userId } : { contact_id: contactId };
  await client.authToken.updateMany({
    where: { ...owner, purpose, used_at: null, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  const token = randomToken();
  await client.authToken.create({
    data: {
      workspace_id: workspaceId,
      purpose,
      token_hash: sha256(token),
      ...owner,
      new_email: newEmail,
      expires_at: new Date(Date.now() + LINK_TTL_MS[purpose]),
      created_by: createdBy ?? null,
      updated_by: createdBy ?? null,
    },
  });
  return token;
}

/** Look up a usable token without consuming it, or throw 410. */
export async function findLinkToken(purpose, rawToken, client = db) {
  const row = await client.authToken.findUnique({
    where: { token_hash: sha256(rawToken) },
    include: { user: true, contact: { include: { client: { select: { id: true, name: true, status: true } } } } },
  });
  if (!row || row.purpose !== purpose || row.used_at || row.revoked_at || row.expires_at.getTime() <= Date.now()) {
    throw linkExpired(purpose);
  }
  return row;
}

/** Mark a token used exactly once (safe against double submission). */
export async function consumeLinkToken(row, client = db) {
  const res = await client.authToken.updateMany({
    where: { id: row.id, used_at: null, revoked_at: null },
    data: { used_at: new Date() },
  });
  if (res.count !== 1) throw linkExpired(row.purpose);
}
