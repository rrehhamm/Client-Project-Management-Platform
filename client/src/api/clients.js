import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { toQueryString } from './query';

export const clientsKey = ['clients'];
const clientKey = (id) => ['clients', 'detail', id];
const contactsKey = (id) => ['clients', 'contacts', id];

export function useClients(params, { enabled = true } = {}) {
  return useQuery({
    queryKey: [...clientsKey, 'list', params],
    queryFn: () => apiFetch(`/clients${toQueryString(params)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useClient(id) {
  return useQuery({ queryKey: clientKey(id), queryFn: () => apiFetch(`/clients/${id}`), enabled: Boolean(id) });
}

export function usePrefixSuggestion(name, { enabled }) {
  return useQuery({
    queryKey: ['clients', 'prefix', name],
    queryFn: () => apiFetch(`/clients/prefix-suggestion${toQueryString({ name })}`),
    enabled: enabled && name.trim().length >= 1,
    staleTime: 30_000,
  });
}

export function useClientActivity(id, page) {
  return useQuery({
    queryKey: ['clients', 'activity', id, page],
    queryFn: () => apiFetch(`/clients/${id}/activity${toQueryString({ page, page_size: 25 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useContacts(clientId) {
  return useQuery({ queryKey: contactsKey(clientId), queryFn: () => apiFetch(`/clients/${clientId}/contacts`) });
}

/** Any client change refreshes every client query (lists, detail, contacts). */
function useClientMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey: clientsKey }) });
}

export const useCreateClient = () => useClientMutation((body) => apiFetch('/clients', { method: 'POST', body }));
export const useUpdateClient = () => useClientMutation(({ id, ...body }) => apiFetch(`/clients/${id}`, { method: 'PATCH', body }));
export const useArchiveClient = () => useClientMutation((id) => apiFetch(`/clients/${id}/archive`, { method: 'POST' }));
export const useRestoreClient = () => useClientMutation((id) => apiFetch(`/clients/${id}/restore`, { method: 'POST' }));
export const useDeleteClient = () => useClientMutation((id) => apiFetch(`/clients/${id}`, { method: 'DELETE' }));

export const useCreateContact = () =>
  useClientMutation(({ clientId, ...body }) => apiFetch(`/clients/${clientId}/contacts`, { method: 'POST', body }));
export const useUpdateContact = () => useClientMutation(({ id, ...body }) => apiFetch(`/contacts/${id}`, { method: 'PATCH', body }));
export const useDeleteContact = () => useClientMutation((id) => apiFetch(`/contacts/${id}`, { method: 'DELETE' }));
