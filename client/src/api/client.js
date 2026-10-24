// Fetch wrapper for /api/v1.
// - Every non-2xx response becomes an ApiError carrying { code, message, fields } (NFR-API-01).
// - State-changing requests send the CSRF token (BR-AUTH-03).
// - A 401 triggers one silent token refresh and a retry (FR-AUTH-10); if that
//   fails, a "session-expired" event tells the app to show the login page.
import { t } from '@/i18n';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? (status === 0 ? t('errors.network') : t('errors.generic')));
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code ?? (status === 0 ? 'NETWORK_ERROR' : 'UNKNOWN_ERROR');
    this.fields = Array.isArray(body?.fields) ? body.fields : [];
    this.body = body ?? null;
  }
}

const BASE = '/api/v1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// These either create the session or must not loop into a refresh.
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/password/', '/auth/invitations', '/auth/email/verify'];

export const authEvents = new EventTarget();

function readCookie(name) {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

let csrfRequest = null;
async function csrfToken({ fresh = false } = {}) {
  const existing = fresh ? null : readCookie('cpm_csrf');
  if (existing) return existing;
  csrfRequest ??= fetch(`${BASE}/auth/csrf`, { credentials: 'include' })
    .then((r) => r.json())
    .then((b) => b.csrf_token)
    .finally(() => {
      csrfRequest = null;
    });
  return csrfRequest;
}

let refreshRequest = null;
function refreshSession() {
  refreshRequest ??= (async () => {
    const res = await send('/auth/refresh', { method: 'POST' });
    return res.ok;
  })()
    .catch(() => false)
    .finally(() => {
      refreshRequest = null;
    });
  return refreshRequest;
}

async function send(path, { method = 'GET', body, signal, headers, freshCsrf = false } = {}) {
  const unsafe = !SAFE_METHODS.has(method);
  return fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(unsafe ? { 'X-CSRF-Token': await csrfToken({ fresh: freshCsrf }) } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function parse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function apiFetch(path, options = {}, { retried = false } = {}) {
  let res;
  try {
    res = await send(path, options);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, null);
  }
  if (res.ok) return parse(res);

  const data = await parse(res);
  if (!retried && res.status === 403 && data?.code === 'CSRF_INVALID') {
    await csrfToken({ fresh: true });
    return apiFetch(path, { ...options, freshCsrf: true }, { retried: true });
  }
  if (!retried && res.status === 401 && !NO_REFRESH.some((p) => path.startsWith(p))) {
    if (await refreshSession()) return apiFetch(path, options, { retried: true });
    authEvents.dispatchEvent(new Event('session-expired'));
  }
  throw new ApiError(res.status, data);
}

/** Put server field errors onto a react-hook-form form. Returns true if any were set. */
export function applyFieldErrors(error, setError, fieldMap = {}) {
  if (!(error instanceof ApiError) || !error.fields.length) return false;
  let applied = false;
  for (const { field, message } of error.fields) {
    const name = fieldMap[field] ?? field;
    if (name) {
      setError(name, { type: 'server', message });
      applied = true;
    }
  }
  return applied;
}
