import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/test/utils';
import { ApiError, apiFetch } from './client';
import { shouldRetry } from './queryClient';

describe('apiFetch', () => {
  it('returns parsed JSON and sends cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/health', expect.objectContaining({ credentials: 'include' }));
  });

  it('turns the server error body into an ApiError', async () => {
    const body = { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', fields: [{ field: 'name', message: 'Required' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, body)));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
    const err = await apiFetch('/x').catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: 'UNKNOWN_ERROR', fields: [] });
  });
});

describe('shouldRetry', () => {
  it('never retries 4xx and retries other failures twice', () => {
    expect(shouldRetry(0, new ApiError(403, { code: 'FORBIDDEN' }))).toBe(false);
    expect(shouldRetry(0, new ApiError(500, null))).toBe(true);
    expect(shouldRetry(2, new ApiError(500, null))).toBe(false);
  });
});
