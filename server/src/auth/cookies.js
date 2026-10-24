// Auth cookies (BR-AUTH-03): HttpOnly, Secure, SameSite=Lax.
import { config } from '../config.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './tokens.js';

export const ACCESS_COOKIE = 'cpm_at';
export const REFRESH_COOKIE = 'cpm_rt';
export const CSRF_COOKIE = 'cpm_csrf';

const base = () => ({ httpOnly: true, secure: config.auth.cookieSecure, sameSite: 'lax' });

// The access token goes to every API call; the refresh token only to /auth endpoints.
const ACCESS_PATH = '/api';
const REFRESH_PATH = '/api/v1/auth';

export function setAuthCookies(res, { accessToken, refreshToken, refreshExpiresAt }) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...base(), path: ACCESS_PATH, maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base(),
    path: REFRESH_PATH,
    maxAge: Math.max(0, refreshExpiresAt.getTime() - Date.now()),
  });
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: ACCESS_PATH });
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: REFRESH_PATH });
}

/** Readable by the app's JavaScript on purpose: it echoes it in a header. */
export function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure: config.auth.cookieSecure, sameSite: 'lax', path: '/' });
}
