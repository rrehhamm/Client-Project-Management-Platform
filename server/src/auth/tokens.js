// JWTs (access + refresh) and random single-use tokens.
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // FR-AUTH-10
const ISSUER = 'cpm';
const AUDIENCE = 'cpm-api';

/** Access token: who (sub), what kind (knd) and which session (sid). */
export function signAccessToken({ principalId, kind, sessionId }) {
  return new SignJWT({ knd: kind, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(principalId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(config.auth.accessSecret);
}

/** Refresh token: session id + one-time jti, valid until the session expires. */
export function signRefreshToken({ sessionId, jti, expiresAt }) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setJti(jti)
    .setIssuer(ISSUER)
    .setAudience(`${AUDIENCE}-refresh`)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(config.auth.refreshSecret);
}

async function verify(token, secret, audience) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience, algorithms: ['HS256'] });
    return payload;
  } catch {
    return null;
  }
}

export const verifyAccessToken = (token) => verify(token, config.auth.accessSecret, AUDIENCE);
export const verifyRefreshToken = (token) => verify(token, config.auth.refreshSecret, `${AUDIENCE}-refresh`);

/** 256-bit random token, URL-safe. */
export function randomToken() {
  return randomBytes(32).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
