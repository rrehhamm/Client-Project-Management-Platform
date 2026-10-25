import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { projectsKey } from './projects';
import { toQueryString } from './query';

export const tasksKey = ['tasks'];
const taskKey = (id) => ['tasks', 'detail', id];

export function useTasks(projectId, params, { enabled = true } = {}) {
  return useQuery({
    queryKey: [...tasksKey, 'list', projectId, params],
    queryFn: () => apiFetch(`/projects/${projectId}/tasks${toQueryString({ page_size: 100, ...params })}`),
    placeholderData: keepPreviousData,
    enabled: Boolean(projectId) && enabled,
  });
}

export const useTask = (id) => useQuery({ queryKey: taskKey(id), queryFn: () => apiFetch(`/tasks/${id}`), enabled: Boolean(id) });
export const useMyTasks = () => useQuery({ queryKey: [...tasksKey, 'mine'], queryFn: () => apiFetch('/me/tasks') });
export const useLabels = (projectId) =>
  useQuery({ queryKey: [...tasksKey, 'labels', projectId], queryFn: () => apiFetch(`/projects/${projectId}/labels`), staleTime: 60_000 });

/** Task changes also move project progress, the overview counts and the activity feed. */
function useTaskMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      // Keep the open task's version current, so a second quick edit is not "stale"
      const task = data?.task ?? data;
      if (task?.id && task.version) qc.setQueryData(taskKey(task.id), (old) => (old ? { ...old, ...task, permissions: old.permissions } : old));
      qc.invalidateQueries({ queryKey: tasksKey });
      // Progress and counts on the project page now; project lists refresh when next shown
      qc.invalidateQueries({ queryKey: [...projectsKey, 'detail'] });
      qc.invalidateQueries({ queryKey: [...projectsKey, 'activity'] });
      qc.invalidateQueries({ queryKey: [...projectsKey, 'list'], refetchType: 'none' });
    },
  });
}

export const useCreateTask = () => useTaskMutation(({ projectId, ...body }) => apiFetch(`/projects/${projectId}/tasks`, { method: 'POST', body }));
export const useUpdateTask = () => useTaskMutation(({ id, ...body }) => apiFetch(`/tasks/${id}`, { method: 'PATCH', body }));
export const useChangeTaskStatus = () => useTaskMutation(({ id, ...body }) => apiFetch(`/tasks/${id}/status`, { method: 'POST', body }));
export const useTaskPosition = () => useTaskMutation(({ id, after_id }) => apiFetch(`/tasks/${id}/position`, { method: 'PUT', body: { after_id } }));
export const useMoveTask = () => useTaskMutation(({ id, project_id }) => apiFetch(`/tasks/${id}/move`, { method: 'POST', body: { project_id } }));
export const useDeleteTask = () => useTaskMutation((id) => apiFetch(`/tasks/${id}`, { method: 'DELETE' }));
export const useBulkTasks = () => useTaskMutation((body) => apiFetch('/tasks/bulk', { method: 'POST', body }));

export const useAddChecklistItem = () => useTaskMutation(({ taskId, text }) => apiFetch(`/tasks/${taskId}/checklist`, { method: 'POST', body: { text } }));
export const useUpdateChecklistItem = () =>
  useTaskMutation(({ taskId, itemId, ...body }) => apiFetch(`/tasks/${taskId}/checklist/${itemId}`, { method: 'PATCH', body }));
export const useDeleteChecklistItem = () => useTaskMutation(({ taskId, itemId }) => apiFetch(`/tasks/${taskId}/checklist/${itemId}`, { method: 'DELETE' }));

export const useAddDependency = () =>
  useTaskMutation(({ taskId, predecessor_id }) => apiFetch(`/tasks/${taskId}/dependencies`, { method: 'POST', body: { predecessor_id } }));
export const useRemoveDependency = () =>
  useTaskMutation(({ taskId, predecessorId }) => apiFetch(`/tasks/${taskId}/dependencies/${predecessorId}`, { method: 'DELETE' }));
