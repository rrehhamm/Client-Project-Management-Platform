import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

/** Retry network/5xx failures twice; never retry 4xx (the answer will not change). */
export function shouldRetry(failureCount, error) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
}
