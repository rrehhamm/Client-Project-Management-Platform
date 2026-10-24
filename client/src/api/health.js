import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from './client';

export const healthKeys = { ready: ['health', 'ready'] };

/**
 * Readiness of the API and its services. A 503 still carries per-service
 * results, so it is returned as data (status "degraded") rather than an error.
 */
export async function fetchReadiness() {
  try {
    const data = await apiFetch('/health/ready');
    return { status: 'ok', checks: data.checks };
  } catch (err) {
    if (err instanceof ApiError && err.status === 503 && err.body?.checks) {
      return { status: 'degraded', checks: err.body.checks };
    }
    throw err;
  }
}

export function useReadiness() {
  return useQuery({ queryKey: healthKeys.ready, queryFn: fetchReadiness, retry: false });
}
