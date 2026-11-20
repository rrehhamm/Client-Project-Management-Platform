// FR-PORT-02/03/04 one project in the portal: milestones, Client tasks, Client files,
// Client messages. Comment-level contacts comment, upload and send requests; View-level
// contacts read only (TC-PORT-004). ?task= and ?file= open an item.
import { useQuery } from '@tanstack/react-query';
import { PREVIEWABLE_TYPES } from '@cpm/shared';
import { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMe } from '@/api/auth';
import { fileUrl, uploadWithProgress } from '@/api/comms';
import { useClientRequest, usePortalFile, usePortalFiles, usePortalProject, usePortalTask, usePortalTasks } from '@/api/portal';
import { ProgressBar } from '@/components/ProgressBar';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { MilestoneStatusBadge, ProjectStatusBadge } from '@/components/StatusBadges';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CommentThread } from '@/features/comments/CommentThread';
import { formatBytes } from '@/features/files/format';
import { TaskStatusBadge } from '@/features/tasks/TaskBadges';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';
import { safeHtml } from '@/lib/safeHtml';

const TABS = ['overview', 'tasks', 'files', 'messages'];

function useParam(key) {
  const [params, setParams] = useSearchParams();
  const set = (value) =>
    setParams((p) => {
      const c = new URLSearchParams(p);
      if (value) c.set(key, value);
      else c.delete(key);
      return c;
    });
  return [params.get(key), set];
}

function TaskDialog({ id, project, onOpen, onClose }) {
  const q = usePortalTask(id);
  const { data: me } = useMe();
  const task = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task?.title ?? t('states.loading')}</DialogTitle>
          <DialogDescription>{project.name}</DialogDescription>
        </DialogHeader>
        {q.isPending ? (
          <LoadingState rows={3} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <TaskStatusBadge status={task.status} />
              {task.is_client_request ? <Badge variant="secondary">{t('portal.yourRequest')}</Badge> : null}
              {task.due_date ? <span className="text-muted-foreground">{t('portal.due', { date: formatDate(task.due_date, me.workspace.date_format) })}</span> : null}
              {task.assignees.length ? <span className="text-muted-foreground">· {task.assignees.map((a) => a.full_name).join(', ')}</span> : null}
            </div>
            {task.parent ? (
              <button type="button" className="text-sm text-brand-text hover:underline" onClick={() => onOpen(task.parent.id)}>
                ↑ {task.parent.title}
              </button>
            ) : null}
            {task.description ? <div className="text-sm [&_a]:text-brand-text [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: safeHtml(task.description) }} /> : null}
            {task.subtasks.length ? (
              <section aria-label={t('tasks.panel.subtasks')} className="space-y-1">
                <h3 className="text-sm font-semibold">{t('tasks.panel.subtasks')}</h3>
                <ul className="divide-y rounded-md border text-sm">
                  {task.subtasks.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
                      <button type="button" className="flex-1 text-left hover:underline" onClick={() => onOpen(s.id)}>
                        {s.title}
                      </button>
                      <TaskStatusBadge status={s.status} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {task.files.length ? (
              <section aria-label={t('files.title')} className="space-y-1">
                <h3 className="text-sm font-semibold">{t('files.title')}</h3>
                <ul className="text-sm">
                  {task.files.map((f) => (
                    <li key={f.id}>
                      <Link to={`?tab=files&file=${f.id}`} className="text-brand-text hover:underline">
                        {f.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <CommentThread entityType="Task" entityId={task.id} project={project} targetVisibility="Client" canComment={project.can_comment && !project.archived} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileDialog({ id, project, onClose }) {
  const q = usePortalFile(id);
  const file = q.data;
  const previewable = file?.latest?.scan_status === 'Clean' && PREVIEWABLE_TYPES.includes(file.latest.mime_type);
  const link = useQuery({ queryKey: ['portal', 'preview', id, file?.latest?.version_no], queryFn: () => fileUrl(id, file.latest.version_no, { inline: true, base: '/portal' }), enabled: Boolean(previewable), staleTime: 8 * 60_000 });
  const download = async (n) => window.location.assign((await fileUrl(id, n, { base: '/portal' })).url);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-all">{file?.name ?? t('states.loading')}</DialogTitle>
          <DialogDescription>{project.name}</DialogDescription>
        </DialogHeader>
        {q.isPending ? (
          <LoadingState rows={3} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <div className="space-y-5">
            {previewable && link.data ? (
              file.latest.mime_type === 'application/pdf' ? (
                <iframe title={file.name} src={link.data.url} className="h-[60vh] w-full rounded-md border" />
              ) : (
                <img src={link.data.url} alt={file.name} className="mx-auto max-h-[60vh] rounded-md border object-contain" />
              )
            ) : file.latest?.scan_status === 'Pending' ? (
              <Alert>{t('files.scan.Pending')}</Alert>
            ) : (
              <p className="rounded-md border bg-muted/40 p-6 text-center text-sm text-muted-foreground">{t('files.noPreview')}</p>
            )}
            <ul className="divide-y rounded-md border text-sm">
              {file.versions.map((v) => (
                <li key={v.version_no} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-medium">{t('files.version', { n: v.version_no })}</span>
                  <span className="text-muted-foreground">
                    {formatBytes(v.size_bytes)} · {v.uploaded_by?.full_name}
                  </span>
                  {v.scan_status === 'Clean' ? (
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => download(v.version_no)}>
                      {t('files.download')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <CommentThread entityType="File" entityId={file.id} project={project} targetVisibility="Client" canComment={project.can_comment && !project.archived} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** FR-PORT-03: a request becomes a task for the team. */
function RequestDialog({ project, onOpenChange }) {
  const request = useClientRequest();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [uploadError, setUploadError] = useState(null);
  const [done, setDone] = useState(false);
  const input = useRef(null);
  const attach = async (list) => {
    setUploadError(null);
    try {
      for (const f of [...list].slice(0, 5 - files.length)) {
        const saved = await uploadWithProgress(`/portal/projects/${project.id}/files`, f);
        setFiles((x) => [...x, saved]);
      }
    } catch (err) {
      setUploadError(err.message);
    }
    if (input.current) input.current.value = '';
  };
  const escape = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const submit = (e) => {
    e.preventDefault();
    const description = text.trim() ? text.trim().split(/\n{2,}/).map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('') : null;
    request.mutate({ projectId: project.id, title: title.trim(), description, attachment_file_ids: files.map((f) => f.id) }, { onSuccess: () => setDone(true) });
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('portal.request.title')}</DialogTitle>
          <DialogDescription>{t('portal.request.body', { project: project.name })}</DialogDescription>
        </DialogHeader>
        {done ? (
          <>
            <Alert variant="success">{t('portal.request.sent')}</Alert>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-3">
            {request.error ? <Alert variant="destructive">{request.error.message}</Alert> : null}
            <label className="grid gap-1 text-sm font-medium">
              {t('portal.request.what')}
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} required />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              {t('portal.request.details')}
              <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} />
            </label>
            <label className="text-sm">
              <span className="font-medium">{t('comments.attach')}</span>
              <input ref={input} type="file" multiple className="mt-1 block text-sm" disabled={files.length >= 5} onChange={(e) => attach(e.target.files)} />
            </label>
            {files.length ? <p className="text-xs text-muted-foreground">{files.map((f) => f.name).join(', ')}</p> : null}
            {uploadError ? <Alert variant="destructive">{uploadError}</Alert> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!title.trim() || request.isPending}>
                {t('portal.request.send')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Files({ project }) {
  const q = usePortalFiles(project.id);
  const [, openFile] = useParam('file');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const upload = async (list) => {
    setError(null);
    try {
      for (const f of [...list]) {
        setProgress({ name: f.name, pct: 0 });
        await uploadWithProgress(`/portal/projects/${project.id}/files`, f, { onProgress: (pct) => setProgress({ name: f.name, pct }) });
      }
      q.refetch();
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="space-y-4">
      {project.can_comment && !project.archived ? (
        <label className="inline-flex cursor-pointer items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
          {t('files.upload')}
          <input ref={input} type="file" multiple className="sr-only" onChange={(e) => upload(e.target.files)} />
        </label>
      ) : null}
      <div aria-live="polite">
        {progress ? <p className="text-sm">{t('files.uploading', progress)}</p> : null}
        {error ? <Alert variant="destructive">{error}</Alert> : null}
      </div>
      {q.isPending ? (
        <LoadingState rows={3} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.data.length === 0 ? (
        <EmptyState body={t('files.empty')} />
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {q.data.data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <button type="button" className="font-medium hover:underline" onClick={() => openFile(f.id)}>
                {f.name}
              </button>
              {f.version_count > 1 ? <Badge variant="secondary">{t('files.version', { n: f.latest.version_no })}</Badge> : null}
              {f.latest?.scan_status === 'Pending' ? <Badge variant="secondary">{t('files.scan.Pending')}</Badge> : null}
              <span className="ml-auto text-xs text-muted-foreground">{formatBytes(f.latest?.size_bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PortalProjectPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'overview';
  const [taskId, openTask] = useParam('task');
  const [fileId, openFile] = useParam('file');
  const [requesting, setRequesting] = useState(false);
  const project = usePortalProject(id);
  const tasks = usePortalTasks(id);
  const df = me.workspace.date_format;

  if (project.isPending) return <LoadingState rows={5} />;
  if (project.error) return <ErrorState error={project.error} onRetry={() => project.refetch()} />;
  const p = project.data;
  const setTab = (next) => setParams((x) => { const c = new URLSearchParams(x); if (next === 'overview') c.delete('tab'); else c.set('tab', next); return c; }, { replace: true });

  return (
    <div className="space-y-6">
      <Link to="/portal" className="text-sm text-brand-text hover:underline">
        ← {t('portal.nav.home')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{p.code}</span>
            <ProjectStatusBadge status={p.status} />
            {p.pm ? <span>· {t('portal.pm', { name: p.pm.full_name })}</span> : null}
            {p.archived ? <Badge variant="outline">{t('projects.archived')}</Badge> : null}
          </div>
          <div className="mt-3 max-w-sm">
            <ProgressBar value={p.progress_pct} />
          </div>
        </div>
        {p.can_comment && !p.archived ? <Button onClick={() => setRequesting(true)}>{t('portal.request.open')}</Button> : null}
      </div>

      <Tabs tabs={TABS.map((x) => ({ id: x, label: t(`portal.tabs.${x}`) }))} value={tab} onChange={setTab} label={p.name} />
      <TabPanel label={t(`portal.tabs.${tab}`)}>
        {tab === 'overview' ? (
          <section aria-label={t('projects.overview.milestones')} className="space-y-3">
            <h2 className="text-sm font-semibold">{t('projects.overview.milestones')}</h2>
            {p.milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('milestones.empty')}</p>
            ) : (
              <ul className="divide-y rounded-lg border text-sm">
                {p.milestones.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="font-medium">{m.title}</span>
                    <MilestoneStatusBadge status={m.status} />
                    <span className="ml-auto text-xs text-muted-foreground">{formatDate(m.due_date, df)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
        {tab === 'tasks' ? (
          tasks.isPending ? (
            <LoadingState rows={4} />
          ) : tasks.error ? (
            <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
          ) : tasks.data.data.length === 0 ? (
            <EmptyState body={t('tasks.empty')} />
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {tasks.data.data.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`portal-task-${task.title}`}>
                  <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => openTask(task.id)}>
                    {task.title}
                  </button>
                  {task.is_client_request ? <Badge variant="secondary">{t('portal.yourRequest')}</Badge> : null}
                  <TaskStatusBadge status={task.status} />
                  <span className="w-20 text-right text-xs text-muted-foreground">{task.due_date ? formatDate(task.due_date, df) : ''}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {tab === 'files' ? <Files project={p} /> : null}
        {tab === 'messages' ? <CommentThread entityType="Project" entityId={p.id} project={p} targetVisibility="Client" canComment={p.can_comment && !p.archived} title={t('board.title')} /> : null}
      </TabPanel>

      {taskId ? <TaskDialog id={taskId} project={p} onOpen={openTask} onClose={() => openTask(null)} /> : null}
      {fileId ? <FileDialog id={fileId} project={p} onClose={() => openFile(null)} /> : null}
      {requesting ? <RequestDialog project={p} onOpenChange={setRequesting} /> : null}
    </div>
  );
}
