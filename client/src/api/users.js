import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export const usersKey = ['users'];

function toQueryString(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function useUsers(params) {
  return useQuery({
    queryKey: [...usersKey, params],
    queryFn: () => apiFetch(`/users${toQueryString(params)}`),
    placeholderData: keepPreviousData,
  });
}

/** Mutations on users refresh every users list afterwards. */
function useUserMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }) });
}

export const useInviteUser = () => useUserMutation((body) => apiFetch('/users', { method: 'POST', body }));
export const useUpdateUser = () =>
  useUserMutation(({ id, ...body }) => apiFetch(`/users/${id}`, { method: 'PATCH', body }));
export const useResendInvitation = () =>
  useUserMutation((id) => apiFetch(`/users/${id}/invitation/resend`, { method: 'POST' }));
export const useRevokeInvitation = () =>
  useUserMutation((id) => apiFetch(`/users/${id}/invitation`, { method: 'DELETE' }));
export const useDeactivateUser = () => useUserMutation((id) => apiFetch(`/users/${id}/deactivate`, { method: 'POST' }));
export const useReactivateUser = () => useUserMutation((id) => apiFetch(`/users/${id}/reactivate`, { method: 'POST' }));

export function useTransferOwnership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, password }) => apiFetch(`/users/${id}/transfer-ownership`, { method: 'POST', body: { password } }),
    onSuccess: () => qc.invalidateQueries(), // own role and capabilities change too
  });
}
