// One file (FR-FILE-02/03/04/06/07): preview, versions, sharing, filing, comments.
// Links are requested from the server each time, after its permission check (10 minutes).
import { PREVIEWABLE_TYPES } from '@cpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useMe } from '@/api/auth';
import { fileUrl, useDeleteFile, useFile, useFolders, useUpdateFile, useUpload } from '@/api/comms';
import { useTasks } from '@/api/tasks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CommentThread, InternalTag } from '@/features/comments/CommentThread';
import { FollowButton } from '@/features/notifications/FollowButton';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { formatBytes } from './format';

export function ScanBadge({ status }) {
  if (status === 'Clean') return null;
  return <Badge variant={status === 'Pending' ? 'secondary' : 'destructive'}>{t(`files.scan.${status}`)}</Badge>;
}

function Preview({ file }) {
  const latest = file.latest;
  const previewable = latest?.scan_status === 'Clean' && PREVIEWABLE_TYPES.includes(latest.mime_type);
  // Signed links last 10 minutes (FR-FILE-04); reuse one for up to 8
  const link = useQuery({
    queryKey: ['files', 'preview', file.id, latest?.version_no],
    queryFn: () => fileUrl(file.id, latest.version_no, { inline: true }),
    enabled: previewable,
    staleTime: 8 * 60_000,
    gcTime: 8 * 60_000,
  });

  if (!latest) return null;
  if (latest.scan_status !== 'Clean') return <Alert>{t(`files.scan.${latest.scan_status}`)}</Alert>;
  if (!previewable) return <p className="rounded-md border bg-muted/40 p-6 text-center text-sm text-muted-foreground">{t('files.noPreview')}</p>;
  if (link.error) return <Alert variant="destructive">{link.error.message}</Alert>;
  if (!link.data) return <LoadingState rows={2} />;
  return latest.mime_type === 'application/pdf' ? (
    <iframe title={file.name} src={link.data.url} className="h-[60vh] w-full rounded-md border" />
  ) : (
    <img src={link.data.url} alt={file.name} className="mx-auto max-h-[60vh] rounded-md border object-contain" />
  );
}

async function download(fileId, versionNo) {
  const { url } = await fileUrl(fileId, versionNo);
  window.location.assign(url); // Content-Disposition: attachment
}

function Details({ file, project, onClose }) {
  const { data: me } = useMe();
  const update = useUpdateFile();
  const remove = useDeleteFile();
  const upload = useUpload();
  const folders = useFolders(project.id);
  const tasks = useTasks(project.id, { all_levels: true }, { enabled: file.permissions.update });
  const [name, setName] = useState(file.name);
  const [progress, setProgress] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const input = useRef(null);
  const p = file.permissions;
  const tz = me.principal.timezone ?? me.workspace.timezone;
  const save = (patch) => update.mutate({ id: file.id, version: file.version, ...patch });

  const newVersion = (f) => {
    setProgress(0);
    upload.mutate({ path: `/files/${file.id}/versions`, file: f, onProgress: setProgress }, { onSettled: () => setProgress(null) });
    if (input.current) input.current.value = '';
  };

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="space-y-2">
        {update.error ? <Alert variant="destructive">{update.error.fields?.[0]?.message ?? update.error.message}</Alert> : null}
        {upload.error ? <Alert variant="destructive">{upload.error.message}</Alert> : null}
        {downloadError ? <Alert variant="destructive">{downloadError}</Alert> : null}
        {progress !== null ? <p className="text-sm">{t('files.uploading', { name: file.name, pct: progress })}</p> : null}
      </div>

      <Preview file={file} />

      <div className="flex flex-wrap items-center gap-2">
        {file.latest?.scan_status === 'Clean' ? (
          <Button onClick={() => download(file.id, file.latest.version_no).catch((e) => setDownloadError(e.message))}>{t('files.download')}</Button>
        ) : null}
        {p.upload_version ? (
          <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
            {t('files.uploadVersion')}
            <input ref={input} type="file" className="sr-only" onChange={(e) => e.target.files[0] && newVersion(e.target.files[0])} />
          </label>
        ) : null}
        <FollowButton entityType="File" entityId={file.id} />
      </div>

      {p.update ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <form
            className="space-y-1 sm:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name.trim() !== file.name) save({ name: name.trim() });
            }}
          >
            <Label htmlFor={`file-name-${file.id}`}>{t('files.name')}</Label>
            <div className="flex gap-2">
              <Input id={`file-name-${file.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
              <Button type="submit" variant="outline" disabled={update.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
          <div className="space-y-1">
            <Label htmlFor={`file-vis-${file.id}`}>{t('tasks.panel.visibility')}</Label>
            <Select id={`file-vis-${file.id}`} value={file.visibility} onChange={(e) => save({ visibility: e.target.value })}>
              <option value="Internal">{t('visibility.Internal')}</option>
              <option value="Client">{t('visibility.Client')}</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`file-folder-${file.id}`}>{t('files.moveTo')}</Label>
            <Select id={`file-folder-${file.id}`} value={file.folder?.id ?? ''} onChange={(e) => save({ folder_id: e.target.value || null })}>
              <option value="">{t('files.root')}</option>
              {(folders.data?.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`file-task-${file.id}`}>{t('files.task')}</Label>
            <Select id={`file-task-${file.id}`} value={file.task?.id ?? ''} onChange={(e) => save({ task_id: e.target.value || null })}>
              <option value="">{t('files.noTask')}</option>
              {(tasks.data?.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('files.visibilityHint')}</p>
      )}

      <section aria-label={t('files.versions')} className="space-y-2">
        <h3 className="text-sm font-semibold">{t('files.versions')}</h3>
        <ul className="divide-y rounded-md border text-sm">
          {file.versions.map((v, i) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="font-medium">{t('files.version', { n: v.version_no })}</span>
              {i === 0 ? <Badge variant="secondary">{t('files.latest')}</Badge> : null}
              <span className="text-muted-foreground">
                {v.original_name} · {formatBytes(v.size_bytes)} · {v.uploaded_by?.full_name} · {formatDateTime(v.created_at, tz)}
              </span>
              <ScanBadge status={v.scan_status} />
              {v.scan_status === 'Clean' ? (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => download(file.id, v.version_no).catch((e) => setDownloadError(e.message))}>
                  {t('files.download')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <CommentThread entityType="File" entityId={file.id} project={project} targetVisibility={file.visibility} />

      {p.delete ? (
        <div className="border-t pt-4">
          <Button variant="destructive" onClick={() => setDeleting(true)}>
            {t('files.delete')}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('files.deleteTitle', { name: file.name })}
        description={t('files.deleteBody')}
        confirmLabel={t('files.delete')}
        destructive
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          remove.mutate(file.id, {
            onSuccess: () => {
              setDeleting(false);
              onClose();
            },
          })
        }
      />
    </div>
  );
}

export function FileDialog({ fileId, project, onClose }) {
  const query = useFile(fileId);
  const file = query.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 break-all">
            {file?.name ?? t('states.loading')}
            {file?.visibility === 'Internal' ? <InternalTag /> : file ? <Badge variant="outline">{t('visibility.Client')}</Badge> : null}
          </DialogTitle>
          <DialogDescription>
            {project.code} · {project.name}
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? <LoadingState rows={4} /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : <Details key={file.id} file={file} project={project} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
