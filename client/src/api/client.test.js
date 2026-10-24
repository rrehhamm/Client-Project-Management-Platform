import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/test/utils';
import { ApiError, apiFetch, authEvents } from './client';
import { shouldRetry } from './queryClient';

/** fetch mock answering by "METHOD path" with fresh Response objects. */
function routeFetch(routes) {
  return vi.fn(async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected fetch ${key}`);
    const [status, body] = typeof handler === 'function' ? handler(init) : handler;
    return jsonResponse(status, body);
  });
}

beforeEach(() => {
  document.cookie = 'cpm_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('apiFetch', () => {
  it('returns parsed JSON and sends cookies', async () => {
    const fetchMock = routeFetch({ 'GET /api/v1/health': [200, { status: 'ok' }] });
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/health', expect.objectContaining({ credentials: 'include' }));
  });

  it('turns the server error body into an ApiError', async () => {
    document.cookie = 'cpm_csrf=token-1; path=/';
    const body = { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', fields: [{ field: 'name', message: 'Required' }] };
    vi.stubGlobal('fetch', routeFetch({ 'POST /api/v1/x': [422, body] }));
    const err = await apiFetch('/x', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'VALIDATION_ERROR', message: 'Some fields are invalid', fields: body.fields });
  });

  it('reports network failures as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await apiFetch('/x').catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('copes with a non-JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })));
    const err = await apiFetch('/x').catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: 'UNKNOWN_ERROR', fields: [] });
  });
});

describe('CSRF (BR-AUTH-03)', () => {
  it('sends the token from the cookie on state-changing requests only', async () => {
    document.cookie = 'cpm_csrf=abc.def; path=/';
    const fetchMock = routeFetch({ 'POST /api/v1/thing': [200, {}], 'GET /api/v1/thing': [200, {}] });
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/thing', { method: 'POST', body: {} });
    await apiFetch('/thing');
    expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Token']).toBe('abc.def');
    expect(fetchMock.mock.calls[1][1].headers['X-CSRF-Token']).toBeUndefined();
  });

  it('fetches a token first when there is no cookie', async () => {
    const fetchMock = routeFetch({
      'GET /api/v1/auth/csrf': [200, { csrf_token: 'fresh.token' }],
      'POST /api/v1/thing': [200, {}],
    });
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/thing', { method: 'POST', body: {} });
    expect(fetchMock.mock.calls.at(-1)[1].headers['X-CSRF-Token']).toBe('fresh.token');
  });
});

describe('silent refresh (FR-AUTH-10)', () => {
  it('refreshes once on 401 and retries the request', async () => {
    document.cookie = 'cpm_csrf=t.s; path=/';
    let calls = 0;
    const fetchMock = routeFetch({
      'GET /api/v1/users': () => (++calls === 1 ? [401, { code: 'UNAUTHENTICATED' }] : [200, { data: [] }]),
      'POST /api/v1/auth/refresh': [200, {}],
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/users')).resolves.toEqual({ data: [] });
    expect(fetchMock.mock.calls.map(([u, i]) => `${i.method ?? 'GET'} ${u}`)).toEqual([
      'GET /api/v1/users',
      'POST /api/v1/auth/refresh',
      'GET /api/v1/users',
    ]);
  });

  it('announces an expired session when the refresh fails', async () => {
    document.cookie = 'cpm_csrf=t.s; path=/';
    vi.stubGlobal(
      'fetch',
      routeFetch({ 'GET /api/v1/users': [401, { code: 'UNAUTHENTICATED' }], 'POST /api/v1/auth/refresh': [401, {}] }),
    );
    const listener = vi.fn();
    authEvents.addEventListener('session-expired', listener);
    const err = await apiFetch('/users').catch((e) => e);
    authEvents.removeEventListener('session-expired', listener);
    expect(err.status).toBe(401);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('never refreshes for the login call itself', async () => {
    document.cookie = 'cpm_csrf=t.s; path=/';
    const fetchMock = routeFetch({ 'POST /api/v1/auth/login': [401, { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' }] });
    vi.stubGlobal('fetch', fetchMock);
    const err = await apiFetch('/auth/login', { method: 'POST', body: {} }).catch((e) => e);
    expect(err.message).toBe('Email or password is incorrect');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('shouldRetry', () => {
  it('never retries 4xx and retries other failures twice', () => {
    expect(shouldRetry(0, new ApiError(403, { code: 'FORBIDDEN' }))).toBe(false);
    expect(shouldRetry(0, new ApiError(500, null))).toBe(true);
    expect(shouldRetry(2, new ApiError(500, null))).toBe(false);
  });
});
