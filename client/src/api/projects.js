import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsKey } from './clients';
import { apiFetch } from './client';
import { toQueryString } from './query';

export const projectsKey = ['projects'];
const projectKey = (id) => ['projects', 'detail', id];

export function useProjects(params, { enabled = true } = {}) {
  return useQuery({
    queryKey: [...projectsKey, 'list', params],
    queryFn: () => apiFetch(`/projects${toQueryString(params)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useProject(id) {
  return useQuery({ queryKey: projectKey(id), queryFn: () => apiFetch(`/projects/${id}`), enabled: Boolean(id) });
}

export const useMilestones = (id) =>
  useQuery({ queryKey: ['projects', 'milestones', id], queryFn: () => apiFetch(`/projects/${id}/milestones`) });

export const useMembers = (id) => useQuery({ queryKey: ['projects', 'members', id], queryFn: () => apiFetch(`/projects/${id}/members`) });

export function useProjectActivity(id, page) {
  return useQuery({
    queryKey: ['projects', 'activity', id, page],
    queryFn: () => apiFetch(`/projects/${id}/activity${toQueryString({ page, page_size: 25 })}`),
    placeholderData: keepPreviousData,
  });
}

/** Project changes also touch client screens (active projects, Projects tab). */
function useProjectMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectsKey });
      qc.invalidateQueries({ queryKey: clientsKey });
    },
  });
}

export const useCreateProject = () => useProjectMutation((body) => apiFetch('/projects', { method: 'POST', body }));
export const useUpdateProject = () => useProjectMutation(({ id, ...body }) => apiFetch(`/projects/${id}`, { method: 'PATCH', body }));
export const useChangeProjectStatus = () =>
  useProjectMutation(({ id, ...body }) => apiFetch(`/projects/${id}/status`, { method: 'POST', body }));
export const useArchiveProject = () =>
  useProjectMutation(({ id, archive }) => apiFetch(`/projects/${id}/${archive ? 'archive' : 'unarchive'}`, { method: 'POST' }));
export const useDeleteProject = () =>
  useProjectMutation(({ id, confirm_name }) => apiFetch(`/projects/${id}`, { method: 'DELETE', body: { confirm_name } }));
export const useRestoreProject = () => useProjectMutation((id) => apiFetch(`/projects/${id}/restore`, { method: 'POST' }));

export const useAddMember = () => useProjectMutation(({ projectId, ...body }) => apiFetch(`/projects/${projectId}/members`, { method: 'POST', body }));
export const useUpdateMember = () =>
  useProjectMutation(({ projectId, memberId, ...body }) => apiFetch(`/projects/${projectId}/members/${memberId}`, { method: 'PATCH', body }));
export const useRemoveMember = () =>
  useProjectMutation(({ projectId, memberId }) => apiFetch(`/projects/${projectId}/members/${memberId}`, { method: 'DELETE' }));

export const useCreateMilestone = () =>
  useProjectMutation(({ projectId, ...body }) => apiFetch(`/projects/${projectId}/milestones`, { method: 'POST', body }));
export const useUpdateMilestone = () => useProjectMutation(({ id, ...body }) => apiFetch(`/milestones/${id}`, { method: 'PATCH', body }));
export const useCompleteMilestone = () => useProjectMutation((id) => apiFetch(`/milestones/${id}/complete`, { method: 'POST' }));
export const useDeleteMilestone = () => useProjectMutation((id) => apiFetch(`/milestones/${id}`, { method: 'DELETE' }));
export const useReorderMilestones = () =>
  useProjectMutation(({ projectId, ids }) => apiFetch(`/projects/${projectId}/milestones/order`, { method: 'PUT', body: { ids } }));
