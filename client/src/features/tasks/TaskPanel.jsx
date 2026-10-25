// Task detail (FR-TSK-01…08, FR-TSK-13/14). Every control follows the `permissions` the
// server sends (D-24); the server checks again on save.
import { TASK_PRIORITY, allowedTaskTargets } from '@cpm/shared';
import { X } from 'lucide-react';
import { lazy, Suspense, useId, useState } from 'react';
import { useMe } from '@/api/auth';
import { useMembers, useMilestones, useProjects } from '@/api/projects';
import {
  useAddChecklistItem,
  useAddDependency,
  useCreateTask,
  useDeleteChecklistItem,
  useDeleteTask,
  useLabels,
  useMoveTask,
  useRemoveDependency,
  useTask,
  useTasks,
  useUpdateChecklistItem,
  useUpdateTask,
} from '@/api/tasks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';
import { Assignees, TaskStatusBadge } from './TaskBadges';
import { useStatusChange } from './useStatusChange';

const RichTextEditor = lazy(() => import('./RichTextEditor'));

function errorText(err) {
  if (!err) return null;
  return err.fields?.length ? `${err.message}: ${err.fields.map((f) => f.message).join(', ')}` : err.message;
}

function Section({ title, headingId, children }) {
  const fallbackId = useId();
  const id = headingId ?? fallbackId;
  return (
    <section className="space-y-2" aria-labelledby={id}>
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** One-line "type and press Enter" input. */
function AddLine({ label, placeholder, onAdd, pending }) {
  const [text, setText] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    onAdd(value, () => setText(''));
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} maxLength={255} />
      <Button type="submit" variant="outline" disabled={pending || !text.trim()}>
        {t('tasks.add')}
      </Button>
    </form>
  );
}

function AssigneesField({ task, me, members, save }) {
  const p = task.permissions;
  const ids = task.assignees.map((a) => a.id);
  const assignedToMe = ids.includes(me.principal.id);
  const canRemove = (a) => p.assign_others || (a.id === me.principal.id && (a.self_assigned || task.created_by === me.principal.id));
  const choices = members.filter((m) => m.kind === 'user' && m.status === 'Active' && !ids.includes(m.user_id));
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-2">
        {task.assignees.map((a) => (
          <li key={a.id} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm">
            <Assignees people={[a]} max={1} />
            {a.full_name}
            {canRemove(a) ? (
              <button type="button" aria-label={t('tasks.panel.removeAssignee', { name: a.full_name })} className="rounded p-0.5 hover:bg-accent" onClick={() => save({ assignee_ids: ids.filter((x) => x !== a.id) })}>
                <X aria-hidden="true" className="size-3" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {p.assign_others ? (
          <Select aria-label={t('tasks.panel.addAssignee')} value="" onChange={(e) => e.target.value && save({ assignee_ids: [...ids, e.target.value] })} className="w-auto">
            <option value="">{t('tasks.panel.addAssignee')}</option>
            {choices.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name}
              </option>
            ))}
          </Select>
        ) : null}
        {p.assign_self && !assignedToMe ? (
          <Button variant="outline" size="sm" onClick={() => save({ assignee_ids: [...ids, me.principal.id] })}>
            {t('tasks.panel.assignMe')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function LabelsField({ task, projectId, editable, save }) {
  const known = useLabels(projectId);
  const listId = useId();
  const [text, setText] = useState('');
  const add = (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || task.labels.includes(value)) return setText('');
    save({ labels: [...task.labels, value] });
    setText('');
  };
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1">
        {task.labels.map((l) => (
          <li key={l} className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
            {l}
            {editable ? (
              <button type="button" aria-label={t('tasks.panel.removeLabel', { label: l })} onClick={() => save({ labels: task.labels.filter((x) => x !== l) })}>
                <X aria-hidden="true" className="size-3" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {editable && task.labels.length < 10 ? (
        <form onSubmit={add}>
          <Input aria-label={t('tasks.panel.labels')} list={listId} value={text} onChange={(e) => setText(e.target.value)} maxLength={50} placeholder={t('tasks.panel.labelsHint')} />
          <datalist id={listId}>
            {(known.data?.data ?? []).filter((l) => !task.labels.includes(l)).map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </form>
      ) : null}
    </div>
  );
}

function Checklist({ task }) {
  const add = useAddChecklistItem();
  const update = useUpdateChecklistItem();
  const remove = useDeleteChecklistItem();
  const editable = task.permissions.edit_work;
  const err = add.error ?? update.error ?? remove.error;
  return (
    <Section title={t('tasks.panel.checklist')}>
      {err ? <Alert variant="destructive">{errorText(err)}</Alert> : null}
      <ul className="space-y-1">
        {task.checklist.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={item.is_done}
              disabled={!editable}
              aria-label={item.text}
              onChange={(e) => update.mutate({ taskId: task.id, itemId: item.id, is_done: e.target.checked, version: item.version })}
            />
            <span className={item.is_done ? 'flex-1 line-through text-muted-foreground' : 'flex-1'}>{item.text}</span>
            {editable ? (
              <button type="button" aria-label={t('tasks.panel.removeItem', { text: item.text })} className="rounded p-0.5 hover:bg-accent" onClick={() => remove.mutate({ taskId: task.id, itemId: item.id })}>
                <X aria-hidden="true" className="size-3" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {editable ? <AddLine label={t('tasks.panel.checklist')} placeholder={t('tasks.panel.addChecklist')} pending={add.isPending} onAdd={(text, done) => add.mutate({ taskId: task.id, text }, { onSuccess: done })} /> : null}
    </Section>
  );
}

function Subtasks({ task, project, onOpen }) {
  const create = useCreateTask();
  const status = useStatusChange();
  return (
    <Section title={t('tasks.panel.subtasks')}>
      {create.error || status.error ? <Alert variant="destructive">{errorText(create.error ?? status.error)}</Alert> : null}
      <ul className="divide-y rounded-md border">
        {task.subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              aria-label={s.title}
              checked={s.status === 'Done'}
              disabled={s.status === 'Cancelled'}
              onChange={(e) => status.run(s, e.target.checked ? 'Done' : 'ToDo')}
            />
            <button type="button" className="flex-1 truncate text-left hover:underline" onClick={() => onOpen(s.id)}>
              {s.title}
            </button>
            <TaskStatusBadge status={s.status} />
          </li>
        ))}
      </ul>
      {project.permissions.create_task ? (
        <AddLine
          label={t('tasks.panel.subtasks')}
          placeholder={t('tasks.panel.addSubtask')}
          pending={create.isPending}
          onAdd={(title, done) => create.mutate({ projectId: project.id, title, parent_task_id: task.id }, { onSuccess: done })}
        />
      ) : null}
    </Section>
  );
}

function Dependencies({ task, project, onOpen }) {
  const all = useTasks(project.id, { all_levels: true }, { enabled: task.permissions.manage_dependencies });
  const add = useAddDependency();
  const remove = useRemoveDependency();
  const taken = new Set([task.id, ...task.predecessors.map((p) => p.id)]);
  const err = add.error ?? remove.error;
  return (
    <Section title={t('tasks.panel.dependencies')}>
      {err ? <Alert variant="destructive">{errorText(err)}</Alert> : null}
      {task.predecessors.length === 0 ? <p className="text-sm text-muted-foreground">{t('tasks.panel.noDependencies')}</p> : null}
      <ul className="space-y-1">
        {task.predecessors.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <button type="button" className="flex-1 truncate text-left hover:underline" onClick={() => onOpen(p.id)}>
              {p.title}
            </button>
            <TaskStatusBadge status={p.status} />
            {task.permissions.manage_dependencies ? (
              <button type="button" aria-label={t('tasks.panel.removeItem', { text: p.title })} className="rounded p-0.5 hover:bg-accent" onClick={() => remove.mutate({ taskId: task.id, predecessorId: p.id })}>
                <X aria-hidden="true" className="size-3" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {task.permissions.manage_dependencies ? (
        <Select aria-label={t('tasks.panel.addDependency')} value="" onChange={(e) => e.target.value && add.mutate({ taskId: task.id, predecessor_id: e.target.value })}>
          <option value="">{t('tasks.panel.addDependency')}</option>
          {(all.data?.data ?? [])
            .filter((x) => !taken.has(x.id))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
        </Select>
      ) : null}
      {task.successors.length ? (
        <p className="text-xs text-muted-foreground">
          {t('tasks.panel.blocks')}: {task.successors.map((s) => s.title).join(', ')}
        </p>
      ) : null}
    </Section>
  );
}

function MoveTask({ task, project, onMoved }) {
  const projects = useProjects({ client_id: project.client.id, page_size: 100 });
  const move = useMoveTask();
  const targets = (projects.data?.data ?? []).filter((x) => x.id !== project.id && !['Completed', 'Cancelled'].includes(x.status));
  if (!targets.length) return null;
  return (
    <div className="space-y-1">
      <Label htmlFor={`move-${task.id}`}>{t('tasks.panel.move')}</Label>
      <Select
        id={`move-${task.id}`}
        value=""
        onChange={(e) =>
          e.target.value &&
          move.mutate(
            { id: task.id, project_id: e.target.value },
            {
              onSuccess: (res) =>
                onMoved(res.removed_assignees?.length ? t('tasks.panel.moved', { names: res.removed_assignees.map((a) => a.full_name).join(', ') }) : t('tasks.panel.movedNoRemoval')),
            },
          )
        }
      >
        <option value="">{t('tasks.panel.move')}…</option>
        {targets.map((x) => (
          <option key={x.id} value={x.id}>
            {x.code} · {x.name}
          </option>
        ))}
      </Select>
      <p className="text-xs text-muted-foreground">{t('tasks.panel.moveHint')}</p>
      {move.error ? <Alert variant="destructive">{errorText(move.error)}</Alert> : null}
    </div>
  );
}

function Details({ task, project, me, onOpen, onClose, onNotice }) {
  const update = useUpdateTask();
  const status = useStatusChange();
  const remove = useDeleteTask();
  const members = useMembers(project.id);
  const milestones = useMilestones(project.id);
  const [deleting, setDeleting] = useState(false);
  const [applyToSubtasks, setApplyToSubtasks] = useState(false);
  const descId = useId();
  const p = task.permissions;
  const df = me.workspace.date_format;
  const save = (patch) => update.mutate({ id: task.id, version: task.version, ...patch });
  const targets = ['Done', 'Cancelled'].includes(task.status) && !p.reopen ? [] : allowedTaskTargets(task.status);
  const parentScoped = (patch) => save(task.subtask_count && applyToSubtasks ? { ...patch, apply_to_subtasks: true } : patch);

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="space-y-2">
        {!p.edit_work && !p.assign_self ? <Alert>{t('tasks.panel.readOnly')}</Alert> : null}
        {update.error ? <Alert variant="destructive">{errorText(update.error)}</Alert> : null}
        {status.error ? <Alert variant="destructive">{errorText(status.error)}</Alert> : null}
      </div>

      {p.edit_details ? (
        <Input
          key={`title-${task.version}`}
          aria-label={t('tasks.panel.title')}
          defaultValue={task.title}
          maxLength={255}
          className="text-lg font-semibold"
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== task.title && save({ title: e.target.value.trim() })}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`status-${task.id}`}>{t('tasks.panel.status')}</Label>
          <div className="flex items-center gap-2">
            <TaskStatusBadge status={task.status} />
            {p.edit_work && targets.length ? (
              <Select id={`status-${task.id}`} value="" className="w-auto" onChange={(e) => e.target.value && status.run(task, e.target.value)}>
                <option value="">{t('tasks.moveTo', { title: '' }).trim()}…</option>
                {targets.map((s) => (
                  <option key={s} value={s}>
                    {t(`taskStatus.${s}`)}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`priority-${task.id}`}>{t('tasks.panel.priority')}</Label>
          <Select id={`priority-${task.id}`} value={task.priority} disabled={!p.edit_details} onChange={(e) => save({ priority: e.target.value })}>
            {Object.values(TASK_PRIORITY).map((x) => (
              <option key={x} value={x}>
                {t(`priority.${x}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <span className="text-sm font-medium">{t('tasks.panel.assignees')}</span>
          <AssigneesField task={task} me={me} members={members.data?.data ?? []} save={save} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`start-${task.id}`}>{t('tasks.panel.startDate')}</Label>
          <Input id={`start-${task.id}`} type="date" value={task.start_date ?? ''} disabled={!p.edit_details} onChange={(e) => save({ start_date: e.target.value || null })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`due-${task.id}`}>{t('tasks.panel.dueDate')}</Label>
          <Input id={`due-${task.id}`} type="date" value={task.due_date ?? ''} disabled={!p.edit_details} onChange={(e) => save({ due_date: e.target.value || null })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`estimate-${task.id}`}>{t('tasks.panel.estimate')}</Label>
          <Input
            key={`est-${task.version}`}
            id={`estimate-${task.id}`}
            type="number"
            min="0"
            step="0.25"
            inputMode="decimal"
            defaultValue={task.estimate_minutes === null ? '' : task.estimate_minutes / 60}
            disabled={!p.edit_work}
            onBlur={(e) => {
              const minutes = e.target.value === '' ? null : Math.round(Number(e.target.value) * 4) * 15;
              if (minutes !== task.estimate_minutes) save({ estimate_minutes: minutes });
            }}
          />
          <p className="text-xs text-muted-foreground">{t('tasks.panel.estimateHint')}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`milestone-${task.id}`}>{t('tasks.panel.milestone')}</Label>
          <Select id={`milestone-${task.id}`} value={task.milestone?.id ?? ''} disabled={!p.change_milestone} onChange={(e) => parentScoped({ milestone_id: e.target.value || null })}>
            <option value="">{t('tasks.noMilestone')}</option>
            {(milestones.data?.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`billable-${task.id}`}>{t('tasks.panel.billable')}</Label>
          <Select
            id={`billable-${task.id}`}
            value={task.is_billable === null ? '' : String(task.is_billable)}
            disabled={!p.change_billable}
            onChange={(e) => save({ is_billable: e.target.value === '' ? null : e.target.value === 'true' })}
          >
            <option value="">{t('tasks.panel.billableInherit')}</option>
            <option value="true">{t('common.yes')}</option>
            <option value="false">{t('common.no')}</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`visibility-${task.id}`}>{t('tasks.panel.visibility')}</Label>
          <Select id={`visibility-${task.id}`} value={task.visibility} disabled={!p.change_visibility} onChange={(e) => parentScoped({ visibility: e.target.value })}>
            <option value="Internal">{t('visibility.Internal')}</option>
            <option value="Client">{t('visibility.Client')}</option>
          </Select>
        </div>
        {task.subtask_count && (p.change_visibility || p.change_milestone) ? (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-primary" checked={applyToSubtasks} onChange={(e) => setApplyToSubtasks(e.target.checked)} />
            {t('tasks.panel.applyToSubtasks', { count: task.subtask_count })}
          </label>
        ) : null}
        <div className="space-y-1 sm:col-span-2">
          <span className="text-sm font-medium">{t('tasks.panel.labels')}</span>
          <LabelsField task={task} projectId={project.id} editable={p.edit_details} save={save} />
        </div>
      </div>

      <Section title={t('tasks.panel.description')} headingId={descId}>
        <Suspense fallback={<LoadingState rows={1} />}>
          <RichTextEditor key={`desc-${task.id}`} value={task.description} editable={p.edit_work} labelId={descId} pending={update.isPending} onSave={(html) => save({ description: html })} />
        </Suspense>
      </Section>

      {!task.parent_task_id ? <Subtasks task={task} project={project} onOpen={onOpen} /> : null}
      <Checklist task={task} />
      <Dependencies task={task} project={project} onOpen={onOpen} />

      <div className="space-y-4 border-t pt-4">
        {p.move && !task.parent_task_id ? <MoveTask task={task} project={project} onMoved={(msg) => { onNotice(msg); onClose(); }} /> : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{t('tasks.panel.created', { date: formatDate(task.created_at.slice(0, 10), df) })}</span>
          {p.delete ? (
            <Button variant="destructive" onClick={() => setDeleting(true)}>
              {t('tasks.panel.delete')}
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('tasks.panel.deleteTitle', { title: task.title })}
        description={task.subtask_count ? t('tasks.panel.deleteBody', { count: task.subtask_count }) : t('tasks.panel.deleteBodyNone')}
        confirmLabel={t('tasks.panel.delete')}
        destructive
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(task.id, { onSuccess: () => { setDeleting(false); onClose(); } })}
      />
      {status.dialog}
    </div>
  );
}

/** Opens one task in a dialog. `taskId` may point at a subtask; the dialog switches in place. */
export function TaskPanel({ taskId, project, onOpen, onClose, onNotice = () => {} }) {
  const { data: me } = useMe();
  const query = useTask(taskId);
  const task = query.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{task?.title ?? t('states.loading')}</DialogTitle>
          <DialogDescription>
            {project.code} · {project.name}
            {task?.parent_task_id ? (
              <>
                {' · '}
                <button type="button" className="text-primary hover:underline" onClick={() => onOpen(task.parent_task_id)}>
                  ↑ {t('tasks.panel.subtasks')}
                </button>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <LoadingState rows={6} />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : (
          <Details task={task} project={project} me={me} onOpen={onOpen} onClose={onClose} onNotice={onNotice} />
        )}
      </DialogContent>
    </Dialog>
  );
}
