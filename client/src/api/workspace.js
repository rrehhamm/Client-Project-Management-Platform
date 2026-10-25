import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meKey } from './auth';
import { apiFetch } from './client';

export const workspaceKey = ['workspace'];

/** Public workspace fields for everyone (D-17); admin fields for Owner/Admin. */
export function useWorkspace() {
  // Signed logo URLs expire after 10 minutes; refresh well before that.
  return useQuery({ queryKey: workspaceKey, queryFn: () => apiFetch('/workspace'), staleTime: 5 * 60_000, refetchInterval: 8 * 60_000 });
}

function useWorkspaceMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      qc.setQueryData(workspaceKey, data);
      qc.invalidateQueries({ queryKey: meKey }); // /auth/me carries name, timezone, currency
    },
  });
}

export const useUpdateWorkspace = () => useWorkspaceMutation((body) => apiFetch('/workspace', { method: 'PATCH', body }));

/** Uploads the raw file; the server checks its content (FR-WS-01). */
export const useUploadLogo = () =>
  useWorkspaceMutation((file) => apiFetch('/workspace/logo', { method: 'PUT', rawBody: file, contentType: file.type }));

export const useRemoveLogo = () => useWorkspaceMutation(() => apiFetch('/workspace/logo', { method: 'DELETE' }));
