import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { clientsKey } from './clients';
import { projectsKey } from './projects';

export const templatesKey = ['templates'];

export const useTemplates = ({ enabled = true } = {}) =>
  useQuery({ queryKey: templatesKey, queryFn: () => apiFetch('/templates'), enabled });

function useTemplateMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey: templatesKey }) });
}

export const useSaveTemplate = () => useTemplateMutation((body) => apiFetch('/templates', { method: 'POST', body }));
export const useUpdateTemplate = () => useTemplateMutation(({ id, ...body }) => apiFetch(`/templates/${id}`, { method: 'PATCH', body }));
export const useDeleteTemplate = () => useTemplateMutation((id) => apiFetch(`/templates/${id}`, { method: 'DELETE' }));

/** FR-PRJ-12 */
export function useDuplicateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => apiFetch(`/projects/${id}/duplicate`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectsKey });
      qc.invalidateQueries({ queryKey: clientsKey });
    },
  });
}
