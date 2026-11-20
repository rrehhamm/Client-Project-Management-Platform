// Client portal data (FR-PORT-01…05/07) and internal approvals (FR-APP-01…06).
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { commentsKey, filesKey } from './comms';
import { clientsKey } from './clients';
import { toQueryString } from './query';
import { tasksKey } from './tasks';

const portalKey = ['portal'];

export const usePortalBranding = () => useQuery({ queryKey: [...portalKey, 'branding'], queryFn: () => apiFetch('/portal/branding'), staleTime: 5 * 60_000 });
export const usePortalHome = () => useQuery({ queryKey: [...portalKey, 'home'], queryFn: () => apiFetch('/portal/home') });
export const usePortalProjects = () => useQuery({ queryKey: [...portalKey, 'projects'], queryFn: () => apiFetch('/portal/projects') });
export const usePortalProject = (id) => useQuery({ queryKey: [...portalKey, 'project', id], queryFn: () => apiFetch(`/portal/projects/${id}`), enabled: Boolean(id) });
export const usePortalTasks = (projectId, page = 1) =>
  useQuery({ queryKey: [...portalKey, 'tasks', projectId, page], queryFn: () => apiFetch(`/portal/projects/${projectId}/tasks${toQueryString({ page, page_size: 100 })}`), placeholderData: keepPreviousData });
export const usePortalTask = (id) => useQuery({ queryKey: [...portalKey, 'task', id], queryFn: () => apiFetch(`/portal/tasks/${id}`), enabled: Boolean(id) });
export const usePortalFiles = (projectId) => useQuery({ queryKey: [...portalKey, 'files', projectId], queryFn: () => apiFetch(`/portal/projects/${projectId}/files?page_size=100`) });
export const usePortalFile = (id) => useQuery({ queryKey: [...portalKey, 'file', id], queryFn: () => apiFetch(`/portal/files/${id}`), enabled: Boolean(id) });

function usePortalMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portalKey });
      qc.invalidateQueries({ queryKey: commentsKey });
    },
  });
}
export const useClientRequest = () => usePortalMutation(({ projectId, ...body }) => apiFetch(`/portal/projects/${projectId}/requests`, { method: 'POST', body }));

// Approvals, as the contact sees them
export const usePortalApprovals = (status) =>
  useQuery({ queryKey: [...portalKey, 'approvals', status ?? 'all'], queryFn: () => apiFetch(`/portal/approvals${toQueryString({ status, page_size: 100 })}`) });
export const usePortalApproval = (id) => useQuery({ queryKey: [...portalKey, 'approval', id], queryFn: () => apiFetch(`/portal/approvals/${id}`), enabled: Boolean(id), refetchInterval: 15_000 });
export const useDecide = () => usePortalMutation(({ id, ...body }) => apiFetch(`/portal/approvals/${id}/decision`, { method: 'POST', body }));

// ---------------------------------------------------------------------------
// Internal approvals
// ---------------------------------------------------------------------------

export const approvalsKey = ['approvals'];
export const useApprovals = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: [...approvalsKey, 'list', params], queryFn: () => apiFetch(`/approvals${toQueryString(params)}`), placeholderData: keepPreviousData, enabled });
export const useApproval = (id) => useQuery({ queryKey: [...approvalsKey, 'detail', id], queryFn: () => apiFetch(`/approvals/${id}`), enabled: Boolean(id), refetchInterval: 15_000 });

function useApprovalMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: approvalsKey });
      qc.invalidateQueries({ queryKey: filesKey });
      qc.invalidateQueries({ queryKey: tasksKey });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
export const useRequestApproval = () => useApprovalMutation((body) => apiFetch('/approvals', { method: 'POST', body }));
export const useCancelApproval = () => useApprovalMutation((id) => apiFetch(`/approvals/${id}/cancel`, { method: 'POST' }));

/** Pins: the same call shape inside and outside the portal (FR-APP-02). */
export function useAddPin(base = '') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => apiFetch(`${base}/approvals/${id}/pins`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: approvalsKey });
      qc.invalidateQueries({ queryKey: portalKey });
    },
  });
}
export const proofUrl = (id, base = '') => apiFetch(`${base}/approvals/${id}/proof-url`);

// ---------------------------------------------------------------------------
// Contacts: portal access and privacy (FR-CON-03/05, NFR-PRIV-02)
// ---------------------------------------------------------------------------

function useContactMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey: clientsKey }) });
}
export const useInviteContact = () => useContactMutation((id) => apiFetch(`/contacts/${id}/invite`, { method: 'POST' }));
export const useRevokePortal = () => useContactMutation((id) => apiFetch(`/contacts/${id}/revoke-portal`, { method: 'POST' }));
export const useRestorePortal = () => useContactMutation((id) => apiFetch(`/contacts/${id}/restore-portal`, { method: 'POST' }));
export const useAnonymiseContact = () => useContactMutation(({ id, confirm_name }) => apiFetch(`/contacts/${id}/anonymise`, { method: 'POST', body: { confirm_name } }));
export const exportContact = (id) => apiFetch(`/contacts/${id}/export`);
