// FR-FILE-01/05: project files with one level of folders. Drag-and-drop or picker,
// with a progress bar per file. ?file=<id> opens a file, so files can be linked.
import { FILE_MAX_BYTES_DEFAULT } from '@cpm/shared';
import { FolderPlus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '@/api/auth';
import { useCreateFolder, useDeleteFolder, useFiles, useFolders, useRenameFolder, useUpload } from '@/api/comms';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InternalTag } from '@/features/comments/CommentThread';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FileDialog, ScanBadge } from './FileDialog';
import { formatBytes } from './format';

const MAX_MB = Math.round(FILE_MAX_BYTES_DEFAULT / 1_048_576);

function Folders({ project, folder, onSelect, canManage }) {
  const folders = useFolders(project.id);
  const create = useCreateFolder();
  const rename = useRenameFolder();
  const remove = useDeleteFolder();
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(null);
  const button = (id, label, count) => (
    <button
        type="button"
        aria-current={folder === id ? 'true' : undefined}
        onClick={() => onSelect(id)}
        className={cn('flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent', folder === id && 'bg-accent font-medium')}
      >
        <span className="truncate">{label}</span>
        {count !== undefined ? <span className="text-xs text-muted-foreground">{count}</span> : null}
    </button>
  );
  const error = create.error ?? rename.error ?? remove.error;
  return (
    <nav aria-label={t('files.folders')} className="space-y-3">
      <ul className="space-y-0.5">
        <li>{button('', t('files.allFiles'))}</li>
        <li>{button('root', t('files.root'))}</li>
        {(folders.data?.data ?? []).map((f) => (
          <li key={f.id} className="group flex items-center gap-1">
            <div className="min-w-0 flex-1">{button(f.id, f.name, f.file_count)}</div>
            {canManage ? (
              <span className="hidden gap-1 group-focus-within:flex group-hover:flex">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => {
                    const next = window.prompt(t('files.renameFolder'), f.name);
                    if (next?.trim()) rename.mutate({ projectId: project.id, id: f.id, name: next.trim(), version: f.version });
                  }}
                >
                  {t('files.renameFolder')}
                </button>
                <button type="button" className="text-xs text-destructive hover:underline" onClick={() => setDeleting(f)}>
                  {t('files.deleteFolder')}
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate({ projectId: project.id, name: name.trim() }, { onSuccess: () => setName('') });
          }}
        >
          <Input aria-label={t('files.folderName')} placeholder={t('files.newFolder')} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="h-8" />
          <Button type="submit" size="icon" variant="outline" aria-label={t('files.newFolder')} disabled={!name.trim() || create.isPending}>
            <FolderPlus aria-hidden="true" />
          </Button>
        </form>
      ) : null}
      {error ? <Alert variant="destructive">{error.fields?.[0]?.message ?? error.message}</Alert> : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('files.deleteFolderTitle', { name: deleting?.name ?? '' })}
        description={t('files.deleteFolderBody')}
        confirmLabel={t('files.deleteFolder')}
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(
            { projectId: project.id, id: deleting.id },
            {
              onSuccess: () => {
                if (folder === deleting.id) onSelect('');
                setDeleting(null);
              },
            },
          )
        }
      />
    </nav>
  );
}

export function FilesTab({ project }) {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const [folder, setFolder] = useState('');
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState([]); // { key, name, pct, error, done }
  const upload = useUpload();
  const input = useRef(null);
  const files = useFiles(project.id, { folder: folder || undefined });
  const openId = params.get('file');
  const tz = me.principal.timezone ?? me.workspace.timezone;
  const writable = !project.archived_at;
  const canUpload = writable && project.permissions.upload_file;
  const canManage = writable && project.permissions.manage_files;

  const setOpen = (id) =>
    setParams((p) => {
      const copy = new URLSearchParams(p);
      if (id) copy.set('file', id);
      else copy.delete('file');
      return copy;
    });

  const patch = (key, change) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...change } : x)));
  const start = async (list) => {
    const query = folder && folder !== 'root' ? `?folder_id=${folder}` : '';
    for (const file of [...list]) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setQueue((q) => [...q, { key, name: file.name, pct: 0 }]);
      // FR-FILE-01: refuse too-large files before sending them
      if (file.size > FILE_MAX_BYTES_DEFAULT) {
        patch(key, { error: t('files.tooBig', { size: MAX_MB }) });
        continue;
      }
      try {
        await upload.mutateAsync({ path: `/projects/${project.id}/files${query}`, file, onProgress: (pct) => patch(key, { pct }) });
        patch(key, { done: true });
      } catch (err) {
        patch(key, { error: err.message });
      }
    }
    if (input.current) input.current.value = '';
  };

  let body;
  if (files.isPending) body = <LoadingState rows={4} />;
  else if (files.error) body = <ErrorState error={files.error} onRetry={() => files.refetch()} />;
  else if (files.data.data.length === 0) body = <EmptyState body={folder ? t('files.emptyFolder') : t('files.empty')} />;
  else
    body = (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              {['name', 'size', 'uploader', 'date', 'visibility'].map((c) => (
                <th key={c} scope="col" className="px-3 py-2 font-medium">
                  {t(`files.columns.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {files.data.data.map((f) => (
              <tr key={f.id} data-testid={`file-row-${f.name}`}>
                <td className="px-3 py-2">
                  <button type="button" className="text-left font-medium hover:underline" onClick={() => setOpen(f.id)} aria-label={t('files.open', { name: f.name })}>
                    {f.name}
                  </button>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {f.version_count > 1 ? <Badge variant="secondary">{t('files.version', { n: f.latest.version_no })}</Badge> : null}
                    <ScanBadge status={f.latest?.scan_status} />
                    {f.folder && !folder ? <Badge variant="outline">{f.folder.name}</Badge> : null}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatBytes(f.latest?.size_bytes)}</td>
                <td className="px-3 py-2">{f.latest?.uploaded_by?.full_name}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(f.latest?.created_at ?? f.created_at, tz)}</td>
                <td className="px-3 py-2">{f.visibility === 'Internal' ? <InternalTag /> : <Badge variant="outline">{t('visibility.Client')}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className="grid gap-6 md:grid-cols-[13rem_1fr]">
      <Folders project={project} folder={folder} onSelect={setFolder} canManage={canManage} />
      <div className="space-y-4">
        {canUpload ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              start(e.dataTransfer.files);
            }}
            className={cn('flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center', dragging && 'border-brand-text bg-brand-soft')}
          >
            <Upload aria-hidden="true" className="size-6 text-muted-foreground" />
            <p className="text-sm">{t('files.drop')}</p>
            <p className="text-xs text-muted-foreground">{t('files.dropHint', { size: MAX_MB })}</p>
            <label className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
              {t('files.upload')}
              <input ref={input} type="file" multiple className="sr-only" onChange={(e) => start(e.target.files)} />
            </label>
          </div>
        ) : null}
        {queue.length ? (
          <ul className="space-y-2" aria-live="polite">
            {queue.map((q) => (
              <li key={q.key} className="text-sm">
                {q.error ? (
                  <Alert variant="destructive">{t('files.failed', { name: q.name, reason: q.error })}</Alert>
                ) : q.done ? (
                  <span className="text-muted-foreground">{t('files.uploaded', { name: q.name })}</span>
                ) : (
                  <div className="space-y-1">
                    <span>{t('files.uploading', { name: q.name, pct: q.pct })}</span>
                    <div className="h-1.5 rounded bg-muted" role="progressbar" aria-label={q.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={q.pct}>
                      <div className="h-1.5 rounded bg-primary transition-all" style={{ width: `${q.pct}%` }} />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {body}
      </div>
      {openId ? <FileDialog fileId={openId} project={project} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
