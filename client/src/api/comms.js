// Phase 4 data: comments, notifications, follows, files, dashboard, search, audit, avatar.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiBase } from '@/lib/apiScope';
import { ApiError, apiFetch } from './client';
import { projectsKey } from './projects';
import { toQueryString } from './query';
import { tasksKey } from './tasks';

// ---------------------------------------------------------------------------
// Comments (D-31: an open thread refreshes every 3 s)
// ---------------------------------------------------------------------------

export const COMMENT_POLL_MS = 3000;
export const commentsKey = ['comments'];

export function useComments({ entity_type, entity_id, parent_id, page_size = 100 }, { enabled = true, poll = true } = {}) {
  const base = useApiBase();
  return useQuery({
    queryKey: [...commentsKey, base, entity_type, entity_id, parent_id ?? null, page_size],
    queryFn: () => apiFetch(`${base}/comments${toQueryString({ entity_type, entity_id, parent_id, page_size })}`),
    enabled: Boolean(entity_id) && enabled,
    refetchInterval: poll ? COMMENT_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function useMentionable(entity_type, entity_id) {
  const base = useApiBase(); // contacts do not mention people (no picker in the portal)
  return useQuery({ queryKey: [...commentsKey, 'mentionable', entity_type, entity_id], queryFn: () => apiFetch(`/comments/mentionable${toQueryString({ entity_type, entity_id })}`), staleTime: 60_000, enabled: Boolean(entity_id) && !base });
}

function useCommentMutation(makeFn) {
  const qc = useQueryClient();
  const base = useApiBase();
  return useMutation({ mutationFn: makeFn(base), onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey }) });
}
export const usePostComment = () => useCommentMutation((base) => (body) => apiFetch(`${base}/comments`, { method: 'POST', body }));
export const useEditComment = () => useCommentMutation((base) => ({ id, ...body }) => apiFetch(`${base}/comments/${id}`, { method: 'PATCH', body }));
export const useDeleteComment = () => useCommentMutation((base) => (id) => apiFetch(`${base}/comments/${id}`, { method: 'DELETE' }));

// ---------------------------------------------------------------------------
// Notifications (FR-NOT-01; D-31: the bell refreshes every 30 s and on focus)
// ---------------------------------------------------------------------------

export const BELL_POLL_MS = 30_000;
const notificationsKey = ['notifications'];

const bellBase = (base) => (base ? `${base}/notifications` : '/me/notifications');

export function useUnreadCount() {
  const base = useApiBase();
  return useQuery({ queryKey: [...notificationsKey, base, 'unread'], queryFn: () => apiFetch(`${bellBase(base)}/unread-count`), refetchInterval: BELL_POLL_MS, refetchOnWindowFocus: true, staleTime: 10_000 });
}

export function useNotifications({ enabled = true, page_size = 20 } = {}) {
  const base = useApiBase();
  return useQuery({ queryKey: [...notificationsKey, base, 'list', page_size], queryFn: () => apiFetch(`${bellBase(base)}${toQueryString({ page_size })}`), enabled });
}

function useNotificationMutation(makeFn) {
  const qc = useQueryClient();
  const base = useApiBase();
  return useMutation({ mutationFn: makeFn(bellBase(base)), onSuccess: () => qc.invalidateQueries({ queryKey: notificationsKey }) });
}
export const useMarkRead = () => useNotificationMutation((path) => (id) => apiFetch(`${path}/${id}/read`, { method: 'POST' }));
export const useMarkAllRead = () => useNotificationMutation((path) => () => apiFetch(`${path}/read-all`, { method: 'POST' }));

const prefsPath = (base) => (base ? `${base}/notification-preferences` : '/me/notification-preferences');
export function usePreferences() {
  const base = useApiBase();
  return useQuery({ queryKey: [...notificationsKey, base, 'prefs'], queryFn: () => apiFetch(prefsPath(base)) });
}
export function useSavePreferences() {
  const qc = useQueryClient();
  const base = useApiBase();
  return useMutation({ mutationFn: (body) => apiFetch(prefsPath(base), { method: 'PUT', body }), onSuccess: (data) => qc.setQueryData([...notificationsKey, base, 'prefs'], data) });
}

// Follow / unfollow (FR-NOT-05)
export const useFollowing = (entity_type, entity_id) =>
  useQuery({ queryKey: ['follows', entity_type, entity_id], queryFn: () => apiFetch(`/follows${toQueryString({ entity_type, entity_id })}`), enabled: Boolean(entity_id) });
export function useSetFollowing(entity_type, entity_id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on) =>
      on ? apiFetch('/follows', { method: 'POST', body: { entity_type, entity_id } }) : apiFetch(`/follows${toQueryString({ entity_type, entity_id })}`, { method: 'DELETE' }),
    onSuccess: (data) => qc.setQueryData(['follows', entity_type, entity_id], data),
  });
}

// ---------------------------------------------------------------------------
// Files (FR-FILE-01…07)
// ---------------------------------------------------------------------------

export const filesKey = ['files'];

export const useFiles = (projectId, params) =>
  useQuery({ queryKey: [...filesKey, 'list', projectId, params], queryFn: () => apiFetch(`/projects/${projectId}/files${toQueryString({ page_size: 100, ...params })}`), placeholderData: keepPreviousData, enabled: Boolean(projectId) });
export const useFile = (id) => useQuery({ queryKey: [...filesKey, 'detail', id], queryFn: () => apiFetch(`/files/${id}`), enabled: Boolean(id) });
export const useFolders = (projectId) => useQuery({ queryKey: [...filesKey, 'folders', projectId], queryFn: () => apiFetch(`/projects/${projectId}/folders`), enabled: Boolean(projectId) });

function useFileMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: filesKey });
      qc.invalidateQueries({ queryKey: [...projectsKey, 'activity'] });
    },
  });
}
export const useUpdateFile = () => useFileMutation(({ id, ...body }) => apiFetch(`/files/${id}`, { method: 'PATCH', body }));
export const useDeleteFile = () => useFileMutation((id) => apiFetch(`/files/${id}`, { method: 'DELETE' }));
export const useCreateFolder = () => useFileMutation(({ projectId, name }) => apiFetch(`/projects/${projectId}/folders`, { method: 'POST', body: { name } }));
export const useRenameFolder = () => useFileMutation(({ projectId, id, ...body }) => apiFetch(`/projects/${projectId}/folders/${id}`, { method: 'PATCH', body }));
export const useDeleteFolder = () => useFileMutation(({ projectId, id }) => apiFetch(`/projects/${projectId}/folders/${id}`, { method: 'DELETE' }));

/** A signed download/preview link, made by the server after its permission check (FR-FILE-04). */
export const fileUrl = (fileId, versionNo, { inline = false, base = '' } = {}) => apiFetch(`${base}/files/${fileId}/versions/${versionNo}/url${toQueryString({ inline: inline || undefined })}`);

function csrfCookie() {
  const m = document.cookie.split('; ').find((c) => c.startsWith('cpm_csrf='));
  return m ? decodeURIComponent(m.slice('cpm_csrf='.length)) : null;
}

/**
 * Upload with progress (FR-FILE-01: progress bar). Raw body, like the server expects.
 * Resolves with the file, rejects with an ApiError (413, 415, 422 …).
 */
export async function uploadWithProgress(path, file, { onProgress, signal } = {}) {
  let token = csrfCookie();
  if (!token) token = (await (await fetch('/api/v1/auth/csrf', { credentials: 'include' })).json()).csrf_token;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-CSRF-Token', token);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* empty */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body));
    };
    xhr.onerror = () => reject(new ApiError(0, null));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

export function useUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, file, onProgress }) => uploadWithProgress(path, file, { onProgress }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: filesKey });
      qc.invalidateQueries({ queryKey: notificationsKey });
    },
  });
}

// ---------------------------------------------------------------------------
// Dashboard, cross-project tasks, search, audit (FR-DASH, FR-SRCH-01, FR-ACT-02)
// ---------------------------------------------------------------------------

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => apiFetch('/dashboard'), refetchOnWindowFocus: true });
export const useWorkTasks = (params) =>
  useQuery({ queryKey: [...tasksKey, 'work', params], queryFn: () => apiFetch(`/tasks${toQueryString(params)}`), placeholderData: keepPreviousData });
export const useSearch = (q) => useQuery({ queryKey: ['search', q], queryFn: () => apiFetch(`/search${toQueryString({ q })}`), enabled: q.trim().length >= 2, staleTime: 15_000, placeholderData: keepPreviousData });
export const useAudit = (params) => useQuery({ queryKey: ['audit', params], queryFn: () => apiFetch(`/audit${toQueryString(params)}`), placeholderData: keepPreviousData });
export const auditCsvUrl = (params) => `/api/v1/audit/export.csv${toQueryString(params)}`;
export const useStorage = ({ enabled = true } = {}) => useQuery({ queryKey: ['storage'], queryFn: () => apiFetch('/storage'), enabled });

// ---------------------------------------------------------------------------
// Avatar (FR-AUTH-13)
// ---------------------------------------------------------------------------

export function useAvatar() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ['me'] });
    qc.invalidateQueries({ queryKey: commentsKey });
  };
  return {
    upload: useMutation({ mutationFn: (file) => apiFetch('/me/avatar', { method: 'PUT', rawBody: file, contentType: file.type }), onSuccess: done }),
    remove: useMutation({ mutationFn: () => apiFetch('/me/avatar', { method: 'DELETE' }), onSuccess: done }),
  };
}
