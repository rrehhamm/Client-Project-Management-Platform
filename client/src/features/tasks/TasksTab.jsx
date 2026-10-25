// FR-TSK-09/10/11: project tasks with List, Board and Calendar views, filters,
// quick add and bulk actions. ?task=<id> opens a task, so tasks can be linked.
import { TASK_STATUS } from '@cpm/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '@/api/auth';
import { useMembers, useMilestones } from '@/api/projects';
import { useBulkTasks, useCreateTask, useLabels, useTasks } from '@/api/tasks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';
import { TaskBoardView } from './TaskBoardView';
import { TaskCalendarView } from './TaskCalendarView';
import { TaskListView } from './TaskListView';
import { TaskPanel } from './TaskPanel';

const VIEWS = ['list', 'board', 'calendar'];

function QuickAdd({ project }) {
  const create = useCreateTask();
  const [title, setTitle] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate({ projectId: project.id, title: title.trim() }, { onSuccess: () => setTitle('') });
  };
  return (
    <form onSubmit={submit} className="flex flex-1 gap-2">
      <Input aria-label={t('tasks.quickAddLabel')} placeholder={t('tasks.quickAdd')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
      <Button type="submit" disabled={create.isPending || !title.trim()}>
        {t('tasks.add')}
      </Button>
      {create.error ? <span className="sr-only" role="alert">{create.error.message}</span> : null}
    </form>
  );
}

function BulkBar({ ids, members, onDone }) {
  const bulk = useBulkTasks();
  const [action, setAction] = useState('status');
  const [value, setValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [result, setResult] = useState(null);
  const send = (body) =>
    bulk.mutate(
      { task_ids: ids, ...body },
      {
        onSuccess: (res) => {
          setResult(t('tasks.bulk.result', { succeeded: res.succeeded ?? 0, failed: res.failed ?? 0 }));
          setValue('');
          onDone();
        },
      },
    );
  const apply = () => {
    if (action === 'delete') return setConfirmDelete(true);
    if (action === 'status') return send({ action, status: value });
    if (action === 'assign') return send({ action, user_id: value });
    if (action === 'due_date') return send({ action, due_date: value || null });
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2 text-sm" role="region" aria-label={t('tasks.bulk.selected', { count: ids.length })}>
      <span className="font-medium">{t('tasks.bulk.selected', { count: ids.length })}</span>
      <Select aria-label={t('tasks.bulk.apply')} className="w-auto" value={action} onChange={(e) => { setAction(e.target.value); setValue(''); }}>
        <option value="status">{t('tasks.bulk.status')}</option>
        <option value="assign">{t('tasks.bulk.assign')}</option>
        <option value="due_date">{t('tasks.bulk.dueDate')}</option>
        <option value="delete">{t('tasks.bulk.delete')}</option>
      </Select>
      {action === 'status' ? (
        <Select aria-label={t('tasks.bulk.status')} className="w-auto" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">…</option>
          {Object.values(TASK_STATUS).map((s) => (
            <option key={s} value={s}>
              {t(`taskStatus.${s}`)}
            </option>
          ))}
        </Select>
      ) : null}
      {action === 'assign' ? (
        <Select aria-label={t('tasks.bulk.assign')} className="w-auto" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">…</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name}
            </option>
          ))}
        </Select>
      ) : null}
      {action === 'due_date' ? <Input aria-label={t('tasks.bulk.dueDate')} type="date" className="w-auto" value={value} onChange={(e) => setValue(e.target.value)} /> : null}
      <Button size="sm" disabled={bulk.isPending || (['status', 'assign'].includes(action) && !value)} onClick={apply}>
        {t('tasks.bulk.apply')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onDone(true)}>
        {t('tasks.bulk.clear')}
      </Button>
      <span aria-live="polite">{bulk.error ? <span className="text-destructive">{bulk.error.message}</span> : result}</span>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('tasks.bulk.delete')}
        description={t('tasks.bulk.selected', { count: ids.length })}
        confirmLabel={t('tasks.bulk.delete')}
        destructive
        pending={bulk.isPending}
        onConfirm={() => {
          setConfirmDelete(false);
          send({ action: 'delete' });
        }}
      />
    </div>
  );
}

export function TasksTab({ project }) {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const view = VIEWS.includes(params.get('view')) ? params.get('view') : 'list';
  const openId = params.get('task');
  const [groupBy, setGroupBy] = useState('milestone');
  const [filters, setFilters] = useState({ q: '', status: '', assignee: '', milestone: '', label: '', overdue: false });
  const [selected, setSelected] = useState(() => new Set());
  const [notice, setNotice] = useState(null);

  const query = { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== false)) };
  const tasks = useTasks(project.id, query, { enabled: view !== 'calendar' });
  const milestones = useMilestones(project.id);
  const members = useMembers(project.id);
  const labels = useLabels(project.id);
  const userMembers = (members.data?.data ?? []).filter((m) => m.kind === 'user' && m.status === 'Active');
  const editable = !project.archived_at && !['Completed', 'Cancelled'].includes(project.status);
  const perms = project.permissions;

  const setParam = (key, value) =>
    setParams(
      (p) => {
        const copy = new URLSearchParams(p);
        if (value) copy.set(key, value);
        else copy.delete(key);
        return copy;
      },
      { replace: key !== 'task' },
    );
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const onSelect = (id, on) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const filtered = Object.keys(query).length > 0;

  let body;
  if (view === 'calendar') {
    body = <TaskCalendarView projectId={project.id} filters={query} workspace={me.workspace} onOpen={(id) => setParam('task', id)} />;
  } else if (tasks.isPending) {
    body = <LoadingState rows={5} />;
  } else if (tasks.error) {
    body = <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />;
  } else if (tasks.data.data.length === 0) {
    body = <EmptyState title={filtered ? t('tasks.emptyFiltered') : t('tasks.empty')} />;
  } else {
    const list = tasks.data.data;
    body = (
      <>
        {tasks.data.total > list.length ? <Alert>{t('tasks.firstHundred', { count: list.length, total: tasks.data.total })}</Alert> : null}
        {view === 'list' ? (
          <TaskListView
            tasks={list}
            groupBy={groupBy}
            milestones={milestones.data?.data ?? []}
            dateFormat={me.workspace.date_format}
            selected={selected}
            onSelect={onSelect}
            onOpen={(id) => setParam('task', id)}
            canReorder={editable && perms.manage_tasks && !filtered}
          />
        ) : (
          <TaskBoardView tasks={list} dateFormat={me.workspace.date_format} onOpen={(id) => setParam('task', id)} />
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('tasks.viewLabel')} className="flex rounded-md border p-0.5">
          {VIEWS.map((v) => (
            <Button key={v} size="sm" variant={v === view ? 'secondary' : 'ghost'} aria-pressed={v === view} onClick={() => setParam('view', v === 'list' ? null : v)}>
              {t(`tasks.views.${v}`)}
            </Button>
          ))}
        </div>
        {view === 'list' ? (
          <Select aria-label={t('tasks.groupBy')} className="w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="milestone">
              {t('tasks.groupBy')}: {t('tasks.groupByMilestone')}
            </option>
            <option value="status">
              {t('tasks.groupBy')}: {t('tasks.groupByStatus')}
            </option>
          </Select>
        ) : null}
        {editable && perms.create_task ? <QuickAdd project={project} /> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input aria-label={t('tasks.search')} placeholder={t('tasks.search')} className="w-48" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
        {view !== 'board' ? (
          <Select aria-label={t('tasks.allStatuses')} className="w-auto" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">{t('tasks.allStatuses')}</option>
            {Object.values(TASK_STATUS).map((s) => (
              <option key={s} value={s}>
                {t(`taskStatus.${s}`)}
              </option>
            ))}
          </Select>
        ) : null}
        <Select aria-label={t('tasks.panel.assignees')} className="w-auto" value={filters.assignee} onChange={(e) => setFilter('assignee', e.target.value)}>
          <option value="">{t('tasks.anyone')}</option>
          <option value="me">{t('tasks.me')}</option>
          <option value="none">{t('tasks.unassigned')}</option>
          {userMembers.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name}
            </option>
          ))}
        </Select>
        <Select aria-label={t('tasks.allMilestones')} className="w-auto" value={filters.milestone} onChange={(e) => setFilter('milestone', e.target.value)}>
          <option value="">{t('tasks.allMilestones')}</option>
          <option value="none">{t('tasks.noMilestone')}</option>
          {(milestones.data?.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </Select>
        <Select aria-label={t('tasks.anyLabel')} className="w-auto" value={filters.label} onChange={(e) => setFilter('label', e.target.value)}>
          <option value="">{t('tasks.anyLabel')}</option>
          {(labels.data?.data ?? []).map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={filters.overdue} onChange={(e) => setFilter('overdue', e.target.checked)} />
          {t('tasks.overdueOnly')}
        </label>
      </div>

      <div aria-live="polite">{notice ? <Alert variant="success">{notice}</Alert> : null}</div>
      {view === 'list' && selected.size > 0 && editable ? (
        <BulkBar ids={[...selected]} members={userMembers} onDone={(clear) => clear && setSelected(new Set())} />
      ) : null}
      {body}

      {openId ? <TaskPanel taskId={openId} project={project} onOpen={(id) => setParam('task', id)} onClose={() => setParam('task', null)} onNotice={setNotice} /> : null}
    </div>
  );
}
