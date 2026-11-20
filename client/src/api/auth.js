import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyAppearance } from '@/lib/appearance';
import { ApiError, apiFetch } from './client';

export const meKey = ['me'];

/** The signed-in principal, or null when signed out (never throws on 401). */
export async function fetchMe() {
  try {
    return await apiFetch('/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: 60_000, retry: false });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiFetch('/auth/login', { method: 'POST', body }),
    onSuccess: async () => {
      qc.removeQueries();
      await qc.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(meKey, null);
    },
  });
}

export const useForgotPassword = () =>
  useMutation({ mutationFn: (body) => apiFetch('/auth/password/forgot', { method: 'POST', body }) });

export const useResetPassword = () =>
  useMutation({ mutationFn: (body) => apiFetch('/auth/password/reset', { method: 'POST', body }) });

export function useInvitation(token) {
  return useQuery({
    queryKey: ['invitation', token],
    queryFn: () => apiFetch(`/auth/invitations/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiFetch('/auth/invitations/accept', { method: 'POST', body }),
    onSuccess: async () => {
      qc.removeQueries();
      await qc.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
    },
  });
}

export const useChangePassword = () =>
  useMutation({ mutationFn: (body) => apiFetch('/auth/password/change', { method: 'POST', body }) });

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiFetch('/auth/me', { method: 'PATCH', body }),
    onSuccess: (data) => qc.setQueryData(meKey, data),
  });
}

/** D-45: applies the theme at once, then saves it for the user (last write wins). */
export function useUpdateAppearance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appearance) => apiFetch('/auth/me/appearance', { method: 'PUT', body: { appearance } }),
    onMutate: (appearance) => {
      applyAppearance(appearance);
      const prev = qc.getQueryData(meKey);
      if (prev) qc.setQueryData(meKey, { ...prev, principal: { ...prev.principal, appearance } });
      return { prev };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(meKey, ctx.prev);
        applyAppearance(ctx.prev.principal.appearance);
      }
    },
  });
}

export const useRequestEmailChange = () =>
  useMutation({ mutationFn: (body) => apiFetch('/auth/me/email-change', { method: 'POST', body }) });

export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiFetch('/auth/email/verify', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}
