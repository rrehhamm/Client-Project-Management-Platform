// Thin fetch wrapper for /api/v1. Every non-2xx response becomes an ApiError
// carrying the server's { code, message, fields } body (NFR-API-01).
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

export async function apiFetch(path, { method = 'GET', body, signal, headers } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, null);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
